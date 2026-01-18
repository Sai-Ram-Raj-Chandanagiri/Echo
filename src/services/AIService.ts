import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  AIMessage,
  AIRequest,
  AIAction,
  AIModelProvider,
  AI_MODELS,
  OllamaResponse,
  GeminiRequest,
  GeminiResponse,
  FileReference,
  AgenticContext,
  FileEdit,
  EditProposal,
  EditResult,
  EditApplyResult,
  generateId,
} from '../types';

type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;
type ErrorCallback = (error: Error) => void;

// ============================================
// GEMINI MODEL CONFIGURATION
// Official API Docs: https://ai.google.dev/gemini-api/docs/api-overview
// Update model names when new versions are released
// ============================================

// Gemini API Configuration
const GEMINI_API_CONFIG = {
  // Official Google Gemini API endpoint
  // Format: https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:{ACTION}
  apiVersion: 'v1beta',
  action: 'generateContent', // Can be: generateContent, streamGenerateContent, embedContent, batchGenerateContent
} as const;

// Available Gemini models - update as new models become available
// See: https://ai.google.dev/gemini-api/docs/models/gemini
const GEMINI_MODELS = {
  GEMMA_3: 'gemma-3-27b-it',
  FLASH_3: 'gemini-3-flash',
  PRO_3: 'gemini-3-pro',
  FLASH_2_5: 'gemini-2.5-flash',
  PRO_2_5: 'gemini-2.5-pro',
} as const;

// Default to Gemini 3 Flash
const DEFAULT_GEMINI_MODEL = GEMINI_MODELS.FLASH_3;

export class AIService {
  private ollamaUrl: string;
  private geminiApiKey: string;
  private geminiModel: string;
  private currentModel: AIModelProvider;
  private abortController: AbortController | null = null;

  constructor() {
    const config = vscode.workspace.getConfiguration('codecollab');
    this.ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
    this.geminiApiKey = config.get<string>('geminiApiKey', '');
    this.geminiModel = DEFAULT_GEMINI_MODEL;  // Default to Gemini 3 Flash
    this.currentModel = config.get<AIModelProvider>('defaultAIModel', 'gemini-3-flash');
  }

  // Build the complete Gemini API endpoint following official documentation
  // Pattern: https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:{ACTION}
  private getGeminiEndpoint(): string {
    return `https://generativelanguage.googleapis.com/${GEMINI_API_CONFIG.apiVersion}/models/${this.geminiModel}:${GEMINI_API_CONFIG.action}`;
  }

  // Get current Gemini model name
  getGeminiModel(): string {
    return this.geminiModel;
  }

  // Change Gemini model at runtime
  setGeminiModel(model: string): void {
    this.geminiModel = model;
    console.log(`[AIService] Gemini model switched to: ${model}`);
  }

  // Get list of available Gemini models
  getAvailableGeminiModels(): Record<string, string> {
    return { ...GEMINI_MODELS };
  }

  // Model management
  getCurrentModel(): AIModelProvider {
    return this.currentModel;
  }

  setCurrentModel(model: AIModelProvider): void {
    this.currentModel = model;

    // If it's a Gemini model, also update the geminiModel property
    if (model !== 'codellama' && AI_MODELS[model]?.apiModel) {
      this.geminiModel = AI_MODELS[model].apiModel!;
      console.log(`[AIService] Gemini model switched to: ${this.geminiModel}`);
    }
    console.log(`[AIService] Model switched to: ${model}`);
  }

  getAvailableModels(): AIModelProvider[] {
    return Object.keys(AI_MODELS) as AIModelProvider[];
  }

  getModelConfig(model: AIModelProvider) {
    return AI_MODELS[model];
  }

  // Connection checks
  async checkOllamaConnection(): Promise<boolean> {
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

  async checkGeminiConnection(): Promise<boolean> {
    if (!this.geminiApiKey) {
      return false;
    }
    try {
      // Simple validation - just check if API key format looks valid
      return this.geminiApiKey.length > 10;
    } catch (error) {
      console.error('[AIService] Gemini API key validation failed:', error);
      return false;
    }
  }

  async checkConnection(): Promise<boolean> {
    if (this.currentModel === 'codellama') {
      return this.checkOllamaConnection();
    }
    // All other models are Gemini variants
    return this.checkGeminiConnection();
  }

  // File system access for agentic capabilities
  async getWorkspaceFiles(pattern?: string): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const globPattern = pattern || '**/*.{ts,tsx,js,jsx,py,java,cpp,c,h,go,rs,rb,php,css,html,json,md}';
    const files = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 1000);
    return files.map(f => f.fsPath);
  }

  async readFileContent(filePath: string): Promise<string | null> {
    try {
      // First try to read from VS Code's open documents
      const uri = vscode.Uri.file(filePath);
      const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);

      if (openDoc) {
        return openDoc.getText();
      }

      // Otherwise read from disk
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return null;
    } catch (error) {
      console.error(`[AIService] Failed to read file: ${filePath}`, error);
      return null;
    }
  }

  async searchFilesForContent(searchTerm: string): Promise<FileReference[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const results: FileReference[] = [];
    const files = await this.getWorkspaceFiles();

    for (const filePath of files.slice(0, 100)) { // Limit to 100 files for performance
      try {
        const content = await this.readFileContent(filePath);
        if (content && content.toLowerCase().includes(searchTerm.toLowerCase())) {
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          results.push({
            path: filePath,
            relativePath: path.relative(workspaceRoot, filePath),
            fileName: path.basename(filePath),
            language: this.getLanguageFromPath(filePath),
          });
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return results.slice(0, 20); // Return top 20 matches
  }

  // Parse '@' file references from user input
  parseFileReferences(input: string): { cleanedInput: string; filePatterns: string[] } {
    const filePatterns: string[] = [];
    // Match @filename.ext or @path/to/file.ext patterns
    const regex = /@([\w\-./]+\.\w+)/g;
    let match;

    while ((match = regex.exec(input)) !== null) {
      filePatterns.push(match[1]);
    }

    // Remove the @ references from the input for cleaner prompt
    const cleanedInput = input.replace(regex, '').replace(/\s+/g, ' ').trim();

    return { cleanedInput, filePatterns };
  }

  async resolveFileReferences(filePatterns: string[]): Promise<FileReference[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || filePatterns.length === 0) {
      return [];
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const references: FileReference[] = [];

    for (const pattern of filePatterns) {
      // Try to find the file in workspace
      const files = await vscode.workspace.findFiles(`**/${pattern}`, '**/node_modules/**', 5);

      for (const file of files) {
        const content = await this.readFileContent(file.fsPath);
        if (content) {
          references.push({
            path: file.fsPath,
            relativePath: path.relative(workspaceRoot, file.fsPath),
            fileName: path.basename(file.fsPath),
            content: content,
            language: this.getLanguageFromPath(file.fsPath),
          });
        }
      }
    }

    return references;
  }

  // Get file suggestions for autocomplete
  async getFileSuggestions(partialPath: string): Promise<FileReference[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const pattern = partialPath ? `**/*${partialPath}*` : '**/*';
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);

    return files.map(file => ({
      path: file.fsPath,
      relativePath: path.relative(workspaceRoot, file.fsPath),
      fileName: path.basename(file.fsPath),
      language: this.getLanguageFromPath(file.fsPath),
    }));
  }

  private getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.css': 'css',
      '.html': 'html',
      '.json': 'json',
      '.md': 'markdown',
    };
    return languageMap[ext] || 'plaintext';
  }

  // Build context for agentic AI
  async buildAgenticContext(): Promise<AgenticContext> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const editor = vscode.window.activeTextEditor;

    return {
      workspaceRoot: workspaceFolders?.[0]?.uri.fsPath || '',
      openFiles: vscode.workspace.textDocuments
        .filter(doc => doc.uri.scheme === 'file')
        .map(doc => doc.uri.fsPath),
      currentFile: editor?.document.uri.fsPath,
      selectedText: editor?.selection.isEmpty
        ? undefined
        : editor?.document.getText(editor.selection),
      fileReferences: [],
    };
  }

  // Main query method with model switching
  async query(
    request: AIRequest,
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<string> {
    const modelToUse = request.model || this.currentModel;

    // Parse and resolve file references if present
    let fileContext = '';
    if (request.fileReferences && request.fileReferences.length > 0) {
      fileContext = this.buildFileContextString(request.fileReferences);
    }

    const enhancedRequest = {
      ...request,
      prompt: fileContext ? `${request.prompt}\n\nReferenced Files:\n${fileContext}` : request.prompt,
    };

    // Check if it's a Gemini model (any of the Gemini variants) or CodeLlama
    if (modelToUse === 'codellama') {
      return this.queryOllama(enhancedRequest, onStream, onComplete, onError);
    } else {
      // All other models are Gemini variants
      return this.queryGemini(enhancedRequest, onStream, onComplete, onError);
    }
  }

  private buildFileContextString(fileReferences: FileReference[]): string {
    return fileReferences
      .map(ref => {
        const header = `--- ${ref.relativePath} (${ref.language || 'unknown'}) ---`;
        const content = ref.content || '[Content not loaded]';
        return `${header}\n${content}\n`;
      })
      .join('\n');
  }

  // Gemini API query
  private async queryGemini(
    request: AIRequest,
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<string> {
    if (!this.geminiApiKey) {
      const error = new Error('Gemini API key not configured. Go to Settings > CodeCollab > Gemini API Key');
      onError?.(error);
      throw error;
    }

    const prompt = this.buildPrompt(request);

    try {
      this.abortController = new AbortController();

      const geminiRequest: GeminiRequest = {
        contents: [
          {
            parts: [{ text: prompt }],
            role: 'user',
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: AI_MODELS[this.currentModel]?.maxTokens || 8192,
        },
      };

      // Use header-based authentication as per Google API documentation
      const response = await fetch(this.getGeminiEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.geminiApiKey,
        },
        body: JSON.stringify(geminiRequest),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400) {
          throw new Error(`Gemini API error: Invalid request. ${errorText}`);
        } else if (response.status === 403) {
          throw new Error('Gemini API key is invalid or expired. Please check your API key in settings.');
        } else if (response.status === 429) {
          throw new Error('Gemini API rate limit exceeded. Please wait and try again.');
        }
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as GeminiResponse;

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response from Gemini');
      }

      const fullResponse = data.candidates[0].content.parts
        .map(part => part.text)
        .join('');

      // Simulate streaming for consistent UX
      if (onStream) {
        const words = fullResponse.split(' ');
        for (let i = 0; i < words.length; i++) {
          onStream(words[i] + (i < words.length - 1 ? ' ' : ''));
          await new Promise(resolve => setTimeout(resolve, 20)); // Small delay for streaming effect
        }
      }

      onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.log('[AIService] Gemini request aborted');
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

  // Ollama API query (existing implementation enhanced)
  private async queryOllama(
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
          model: 'codellama:7b',
          prompt: prompt,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Model 'codellama:7b' not found. Run: ollama pull codellama:7b`);
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
          console.log('[AIService] Ollama request aborted');
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
        systemPrompt = `You are a helpful coding assistant with access to the user's codebase. You can analyze files, understand code structure, and provide detailed assistance. Answer the following question or request about code.`;
    }

    if (codeContext) {
      return `${systemPrompt}\n\n${prompt}\n\nCode:\n\`\`\`\n${codeContext}\n\`\`\``;
    }
    return `${systemPrompt}\n\n${prompt}`;
  }

  // Convenience methods
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

  // Agentic chat with file references
  async agenticChat(
    message: string,
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<string> {
    // Parse file references from message
    const { cleanedInput, filePatterns } = this.parseFileReferences(message);

    // Resolve file references
    const fileReferences = await this.resolveFileReferences(filePatterns);

    // Get current context
    const context = await this.buildAgenticContext();

    // Build enhanced prompt with context
    let enhancedPrompt = cleanedInput;

    if (context.selectedText) {
      enhancedPrompt += `\n\nCurrently selected code:\n\`\`\`\n${context.selectedText}\n\`\`\``;
    }

    if (context.currentFile) {
      enhancedPrompt += `\n\nCurrent file: ${path.basename(context.currentFile)}`;
    }

    return this.query(
      {
        prompt: enhancedPrompt,
        fileReferences,
        action: 'chat',
      },
      onStream,
      onComplete,
      onError
    );
  }

  async generateSessionSummary(events: string[]): Promise<string> {
    const eventsText = events.join('\n');
    return this.query({
      prompt: `Generate a brief summary of this coding session based on the following events:\n\n${eventsText}\n\nProvide a concise summary including: what was worked on, key decisions made, and any notable changes.`,
      action: 'chat',
    });
  }

  // Update Gemini API key
  setGeminiApiKey(apiKey: string): void {
    this.geminiApiKey = apiKey;
  }

  // ============================================
  // FILE EDITING CAPABILITIES
  // ============================================

  // Store for pending edit proposals
  private pendingProposals: Map<string, EditProposal> = new Map();

  // Parse AI response for file edit blocks
  // Expected format:
  // ```edit:path/to/file.ts
  // <new file content>
  // ```
  // Or for creating new files:
  // ```create:path/to/new-file.ts
  // <file content>
  // ```
  parseEditBlocks(response: string): FileEdit[] {
    const edits: FileEdit[] = [];

    // Match edit blocks: ```edit:filepath or ```create:filepath or ```delete:filepath
    const editBlockRegex = /```(edit|create|delete|rename):([^\n]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = editBlockRegex.exec(response)) !== null) {
      const [, action, filePath, content] = match;
      const normalizedPath = filePath.trim();

      const edit: FileEdit = {
        id: generateId(),
        type: action as 'create' | 'modify' | 'delete' | 'rename',
        filePath: normalizedPath,
        description: `${action} ${normalizedPath}`,
      };

      if (action === 'edit') {
        edit.type = 'modify';
        edit.newContent = content.trim();
      } else if (action === 'create') {
        edit.type = 'create';
        edit.newContent = content.trim();
      } else if (action === 'delete') {
        edit.type = 'delete';
      } else if (action === 'rename') {
        edit.type = 'rename';
        edit.newFilePath = content.trim();
      }

      edits.push(edit);
    }

    return edits;
  }

  // Create an edit proposal from parsed edits
  createEditProposal(edits: FileEdit[], summary: string): EditProposal {
    const proposal: EditProposal = {
      id: generateId(),
      edits,
      summary,
      timestamp: Date.now(),
      status: 'pending',
    };
    this.pendingProposals.set(proposal.id, proposal);
    return proposal;
  }

  // Get a pending proposal by ID
  getProposal(proposalId: string): EditProposal | undefined {
    return this.pendingProposals.get(proposalId);
  }

  // Get all pending proposals
  getPendingProposals(): EditProposal[] {
    return Array.from(this.pendingProposals.values()).filter(p => p.status === 'pending');
  }

  // Apply a single file edit
  async applyFileEdit(edit: FileEdit): Promise<EditResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return {
        success: false,
        editId: edit.id,
        filePath: edit.filePath,
        error: 'No workspace folder open',
      };
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const fullPath = path.isAbsolute(edit.filePath)
      ? edit.filePath
      : path.join(workspaceRoot, edit.filePath);
    const uri = vscode.Uri.file(fullPath);

    try {
      switch (edit.type) {
        case 'create': {
          if (!edit.newContent) {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'No content provided for create' };
          }
          // Ensure directory exists
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          // Create the file
          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(uri, encoder.encode(edit.newContent));
          // Open the newly created file
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
          return { success: true, editId: edit.id, filePath: edit.filePath };
        }

        case 'modify': {
          if (!edit.newContent) {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'No content provided for modify' };
          }
          // Check if file exists
          if (!fs.existsSync(fullPath)) {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'File does not exist' };
          }
          // Store original content for backup
          const originalContent = fs.readFileSync(fullPath, 'utf-8');
          edit.originalContent = originalContent;

          // Apply the edit using VS Code's WorkspaceEdit API
          const document = await vscode.workspace.openTextDocument(uri);
          const workspaceEdit = new vscode.WorkspaceEdit();

          // Replace entire content or specific lines
          if (edit.startLine !== undefined && edit.endLine !== undefined) {
            const startPos = new vscode.Position(edit.startLine - 1, 0);
            const endPos = new vscode.Position(edit.endLine, 0);
            workspaceEdit.replace(uri, new vscode.Range(startPos, endPos), edit.newContent + '\n');
          } else {
            const fullRange = new vscode.Range(
              document.lineAt(0).range.start,
              document.lineAt(document.lineCount - 1).range.end
            );
            workspaceEdit.replace(uri, fullRange, edit.newContent);
          }

          const applied = await vscode.workspace.applyEdit(workspaceEdit);
          if (applied) {
            await document.save();
            await vscode.window.showTextDocument(document, { preview: false });
            return { success: true, editId: edit.id, filePath: edit.filePath };
          } else {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'Failed to apply edit' };
          }
        }

        case 'delete': {
          if (!fs.existsSync(fullPath)) {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'File does not exist' };
          }
          // Store original content before deletion
          edit.originalContent = fs.readFileSync(fullPath, 'utf-8');
          await vscode.workspace.fs.delete(uri);
          return { success: true, editId: edit.id, filePath: edit.filePath };
        }

        case 'rename': {
          if (!edit.newFilePath) {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'No new file path provided for rename' };
          }
          if (!fs.existsSync(fullPath)) {
            return { success: false, editId: edit.id, filePath: edit.filePath, error: 'File does not exist' };
          }
          const newFullPath = path.isAbsolute(edit.newFilePath)
            ? edit.newFilePath
            : path.join(workspaceRoot, edit.newFilePath);
          const newUri = vscode.Uri.file(newFullPath);

          // Ensure target directory exists
          const newDir = path.dirname(newFullPath);
          if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
          }

          await vscode.workspace.fs.rename(uri, newUri);
          // Open the renamed file
          const doc = await vscode.workspace.openTextDocument(newUri);
          await vscode.window.showTextDocument(doc, { preview: false });
          return { success: true, editId: edit.id, filePath: edit.filePath };
        }

        default:
          return { success: false, editId: edit.id, filePath: edit.filePath, error: `Unknown edit type: ${edit.type}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AIService] Failed to apply edit to ${edit.filePath}:`, error);
      return { success: false, editId: edit.id, filePath: edit.filePath, error: errorMessage };
    }
  }

  // Apply all edits in a proposal
  async applyEditProposal(proposalId: string): Promise<EditApplyResult> {
    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) {
      return {
        proposalId,
        results: [],
        allSuccessful: false,
        appliedCount: 0,
        failedCount: 0,
      };
    }

    const results: EditResult[] = [];
    let appliedCount = 0;
    let failedCount = 0;

    for (const edit of proposal.edits) {
      const result = await this.applyFileEdit(edit);
      results.push(result);
      if (result.success) {
        appliedCount++;
      } else {
        failedCount++;
      }
    }

    // Update proposal status
    proposal.status = failedCount === 0 ? 'applied' : 'failed';
    if (failedCount > 0) {
      proposal.error = `${failedCount} edit(s) failed to apply`;
    }

    return {
      proposalId,
      results,
      allSuccessful: failedCount === 0,
      appliedCount,
      failedCount,
    };
  }

  // Reject an edit proposal
  rejectEditProposal(proposalId: string): boolean {
    const proposal = this.pendingProposals.get(proposalId);
    if (!proposal) {
      return false;
    }
    proposal.status = 'rejected';
    return true;
  }

  // Clear all pending proposals
  clearProposals(): void {
    this.pendingProposals.clear();
  }

  // Build prompt for edit mode - instructs AI to format responses with edit blocks
  private buildEditModePrompt(request: AIRequest): string {
    const { prompt, codeContext, fileReferences } = request;

    const editInstructions = `You are an AI coding assistant that can edit files directly. When you need to modify, create, or delete files, use the following format:

To MODIFY an existing file (replace entire content):
\`\`\`edit:path/to/file.ts
<complete new file content here>
\`\`\`

To CREATE a new file:
\`\`\`create:path/to/new-file.ts
<file content here>
\`\`\`

To DELETE a file:
\`\`\`delete:path/to/file.ts
\`\`\`

To RENAME a file:
\`\`\`rename:path/to/old-file.ts
path/to/new-file.ts
\`\`\`

Important guidelines:
- Always provide the COMPLETE file content when editing, not just the changes
- Use relative paths from the workspace root
- Explain what changes you're making before providing the edit blocks
- You can include multiple edit blocks in a single response
- Only suggest edits when the user asks for changes or fixes

`;

    let fullPrompt = editInstructions;

    // Add file references context
    if (fileReferences && fileReferences.length > 0) {
      fullPrompt += '\nReferenced Files:\n';
      fullPrompt += this.buildFileContextString(fileReferences);
      fullPrompt += '\n';
    }

    // Add code context if provided
    if (codeContext) {
      fullPrompt += `\nCode Context:\n\`\`\`\n${codeContext}\n\`\`\`\n`;
    }

    fullPrompt += `\nUser Request: ${prompt}`;

    return fullPrompt;
  }

  // Agentic chat with file editing capabilities
  async agenticEditChat(
    message: string,
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<{ response: string; proposal: EditProposal | null }> {
    // Parse file references from message
    const { cleanedInput, filePatterns } = this.parseFileReferences(message);
    const fileReferences = await this.resolveFileReferences(filePatterns);

    // Get current context
    const context = await this.buildAgenticContext();

    // Build enhanced prompt with edit mode instructions
    let enhancedPrompt = cleanedInput;

    if (context.selectedText) {
      enhancedPrompt += `\n\nCurrently selected code:\n\`\`\`\n${context.selectedText}\n\`\`\``;
    }

    if (context.currentFile) {
      enhancedPrompt += `\n\nCurrent file: ${context.currentFile}`;
      // Include current file content if not already in references
      if (!fileReferences.find(f => f.path === context.currentFile)) {
        const content = await this.readFileContent(context.currentFile);
        if (content) {
          fileReferences.push({
            path: context.currentFile,
            relativePath: path.basename(context.currentFile),
            fileName: path.basename(context.currentFile),
            content,
            language: this.getLanguageFromPath(context.currentFile),
          });
        }
      }
    }

    // Use edit mode prompt builder
    const fullPrompt = this.buildEditModePrompt({
      prompt: enhancedPrompt,
      fileReferences,
      action: 'chat',
    });

    let fullResponse = '';

    try {
      // Query the AI model
      fullResponse = await this.query(
        {
          prompt: fullPrompt,
          action: 'chat',
        },
        onStream,
        (response) => {
          fullResponse = response;
        },
        onError
      );

      // Parse edit blocks from response
      const edits = this.parseEditBlocks(fullResponse);
      let proposal: EditProposal | null = null;

      if (edits.length > 0) {
        // Create a proposal for the edits
        const summary = `${edits.length} file edit(s) proposed`;
        proposal = this.createEditProposal(edits, summary);
      }

      onComplete?.(fullResponse);

      return { response: fullResponse, proposal };
    } catch (error) {
      if (error instanceof Error) {
        onError?.(error);
      }
      throw error;
    }
  }

  // Preview what an edit would look like (diff view)
  async previewEdit(edit: FileEdit): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || !edit.newContent) {
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const fullPath = path.isAbsolute(edit.filePath)
      ? edit.filePath
      : path.join(workspaceRoot, edit.filePath);

    if (edit.type === 'create') {
      // For new files, just show the content in a new untitled document
      const doc = await vscode.workspace.openTextDocument({
        content: edit.newContent,
        language: this.getLanguageFromPath(edit.filePath),
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } else if (edit.type === 'modify') {
      // For modifications, use VS Code's diff editor
      const originalUri = vscode.Uri.file(fullPath);

      // Create a virtual document with the new content
      const doc = await vscode.workspace.openTextDocument({
        content: edit.newContent,
        language: this.getLanguageFromPath(edit.filePath),
      });

      // Show diff between original and proposed changes
      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        doc.uri,
        `${path.basename(edit.filePath)} ↔ Proposed Changes`
      );
    }
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
