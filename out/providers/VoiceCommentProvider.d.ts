import * as vscode from 'vscode';
import { VoiceComment } from '../types';
import type { CollabPanel } from '../panels/CollabPanel';
export declare class VoiceCommentProvider implements vscode.Disposable {
    private yjsService;
    private webRTCService;
    private sessionService;
    private mediaCaptureServer;
    private voiceCommentStorage;
    private voiceComments;
    private decorations;
    private disposables;
    private speakerDecorationType;
    private collabPanel;
    private isInitialized;
    constructor(context: vscode.ExtensionContext);
    /**
     * Load all voice comments from persistent storage
     */
    private loadCommentsFromStorage;
    /**
     * Set the CollabPanel reference for voice recording via webview
     */
    setCollabPanel(panel: CollabPanel): void;
    private getSpeakerIconPath;
    private setupListeners;
    /**
     * Add a voice comment (to memory and storage)
     */
    addVoiceComment(comment: VoiceComment, broadcast?: boolean): Promise<void>;
    /**
     * Remove a voice comment (from memory and storage)
     */
    removeVoiceComment(commentId: string, broadcast?: boolean): Promise<void>;
    getCommentsForLine(fileName: string, lineNumber: number): VoiceComment[];
    getCommentsForFile(fileName: string): VoiceComment[];
    /**
     * Get a voice comment by ID
     */
    getCommentById(commentId: string): VoiceComment | null;
    /**
     * Get audio data for a comment (from storage if not in memory)
     */
    getAudioData(commentId: string): Promise<string | null>;
    private updateDecorations;
    private provideHover;
    /**
     * Record a voice comment using the MediaCaptureServer
     * Opens a browser window for recording (bypasses VS Code webview sandbox)
     */
    recordVoiceComment(lineNumber: number, fileName: string): Promise<VoiceComment | null>;
    handleRecordingComplete(lineNumber: number, fileName: string, audioData: string, duration: number): Promise<VoiceComment | null>;
    /**
     * Clear all comments from memory (storage is preserved)
     */
    clearAllComments(): void;
    /**
     * Clear all comments from memory AND storage
     */
    clearAllCommentsAndStorage(): Promise<void>;
    /**
     * Get storage info for debugging
     */
    getStorageInfo(): {
        basePath: string;
        workspacePath: string;
        audioPath: string;
    };
    dispose(): void;
}
//# sourceMappingURL=VoiceCommentProvider.d.ts.map