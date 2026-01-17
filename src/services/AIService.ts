import * as vscode from 'vscode';
import { AIMessage, AIRequest, AIAction, OllamaResponse, generateId } from '../types';

type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;
type ErrorCallback = (error: Error) => void;

export class AIService {
  private ollamaUrl: string;
  private defaultModel: string;
  private abortController: AbortController | null = null;

  constructor() {
    const config = vscode.workspace.getConfiguration('codecollab');
    this.ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
    this.defaultModel = config.get<string>('defaultModel', 'codellama:7b');
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      console.error('[AIService] Failed to connect to Ollama:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }
      const data = await response.json();
      return data.models?.map((m: { name: string }) => m.name) ?? [];
    } catch (error) {
      console.error('[AIService] Failed to get models:', error);
      return [];
    }
  }

  async query(
    request: AIRequest,
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<string> {
    const prompt = this.buildPrompt(request);

    try {
      this.abortController = new AbortController();

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.defaultModel,
          prompt: prompt,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Model '${this.defaultModel}' not found. Run: ollama pull ${this.defaultModel}`);
        }
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}. Is Ollama running? (ollama serve)`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let fullResponse = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const text = decoder.decode(value);
        const lines = text.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line) as OllamaResponse;
            if (json.response) {
              fullResponse += json.response;
              onStream?.(json.response);
            }
            if (json.done) {
              break;
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON
          }
        }
      }

      onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.log('[AIService] Request aborted');
          return '';
        }
        onError?.(error);
        throw error;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildPrompt(request: AIRequest): string {
    const { prompt, codeContext, action } = request;

    let systemPrompt = '';
    switch (action) {
      case 'explain':
        systemPrompt = `You are a helpful coding assistant. Explain the following code clearly and concisely. Focus on what the code does, not line-by-line details.`;
        break;
      case 'fix':
        systemPrompt = `You are a helpful coding assistant. Analyze the following code for bugs or issues and provide a corrected version with explanations of what was wrong.`;
        break;
      case 'refactor':
        systemPrompt = `You are a helpful coding assistant. Refactor the following code to improve readability, performance, or maintainability. Explain your changes.`;
        break;
      case 'document':
        systemPrompt = `You are a helpful coding assistant. Add comprehensive documentation comments to the following code. Use appropriate doc comment format for the language.`;
        break;
      case 'review':
        systemPrompt = `You are a helpful coding assistant. Review the following code for potential issues, security vulnerabilities, or improvements. Be specific and constructive.`;
        break;
      default:
        systemPrompt = `You are a helpful coding assistant. Answer the following question or request about code.`;
    }

    if (codeContext) {
      return `${systemPrompt}\n\n${prompt}\n\nCode:\n\`\`\`\n${codeContext}\n\`\`\``;
    }
    return `${systemPrompt}\n\n${prompt}`;
  }

  async explainCode(code: string): Promise<string> {
    return this.query({
      prompt: 'Explain this code:',
      codeContext: code,
      action: 'explain',
    });
  }

  async fixCode(code: string, issue?: string): Promise<string> {
    const prompt = issue ? `Fix this issue: ${issue}` : 'Find and fix any bugs in this code:';
    return this.query({
      prompt,
      codeContext: code,
      action: 'fix',
    });
  }

  async refactorCode(code: string): Promise<string> {
    return this.query({
      prompt: 'Refactor this code to improve it:',
      codeContext: code,
      action: 'refactor',
    });
  }

  async documentCode(code: string): Promise<string> {
    return this.query({
      prompt: 'Add documentation to this code:',
      codeContext: code,
      action: 'document',
    });
  }

  async reviewCode(code: string): Promise<string> {
    return this.query({
      prompt: 'Review this code:',
      codeContext: code,
      action: 'review',
    });
  }

  async chat(message: string, codeContext?: string): Promise<string> {
    return this.query({
      prompt: message,
      codeContext,
      action: 'chat',
    });
  }

  async generateSessionSummary(events: string[]): Promise<string> {
    const eventsText = events.join('\n');
    return this.query({
      prompt: `Generate a brief summary of this coding session based on the following events:\n\n${eventsText}\n\nProvide a concise summary including: what was worked on, key decisions made, and any notable changes.`,
      action: 'chat',
    });
  }
}

// Singleton instance
let aiServiceInstance: AIService | null = null;

export function getAIService(): AIService {
  if (!aiServiceInstance) {
    aiServiceInstance = new AIService();
  }
  return aiServiceInstance;
}

export function resetAIService(): void {
  if (aiServiceInstance) {
    aiServiceInstance.abort();
    aiServiceInstance = null;
  }
}
