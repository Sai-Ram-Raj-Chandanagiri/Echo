import { AIRequest } from '../types';
type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;
type ErrorCallback = (error: Error) => void;
export declare class AIService {
    private ollamaUrl;
    private defaultModel;
    private abortController;
    constructor();
    checkConnection(): Promise<boolean>;
    getAvailableModels(): Promise<string[]>;
    query(request: AIRequest, onStream?: StreamCallback, onComplete?: CompleteCallback, onError?: ErrorCallback): Promise<string>;
    abort(): void;
    private buildPrompt;
    explainCode(code: string): Promise<string>;
    fixCode(code: string, issue?: string): Promise<string>;
    refactorCode(code: string): Promise<string>;
    documentCode(code: string): Promise<string>;
    reviewCode(code: string): Promise<string>;
    chat(message: string, codeContext?: string): Promise<string>;
    generateSessionSummary(events: string[]): Promise<string>;
}
export declare function getAIService(): AIService;
export declare function resetAIService(): void;
export {};
//# sourceMappingURL=AIService.d.ts.map