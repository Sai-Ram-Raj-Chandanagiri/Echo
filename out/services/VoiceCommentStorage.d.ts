import * as vscode from 'vscode';
import { VoiceComment } from '../types';
/**
 * VoiceCommentStorage - Persistent file storage for voice comments
 *
 * Stores voice comments in a dedicated folder structure similar to how
 * agentic mode chats are stored based on workspace path:
 *
 * Structure:
 * ~/.codecollab/voice-comments/
 *   └── {workspace-hash}/
 *       ├── index.json          # Metadata for all comments
 *       └── audio/
 *           ├── {comment-id}.webm
 *           └── ...
 */
export declare class VoiceCommentStorage {
    private context;
    private storageBasePath;
    private workspaceStoragePath;
    private audioFolderPath;
    private indexFilePath;
    private initialized;
    constructor(context: vscode.ExtensionContext);
    /**
     * Initialize storage paths based on current workspace
     */
    initialize(): Promise<void>;
    /**
     * Simple hash function for workspace path
     */
    private hashString;
    /**
     * Ensure all required directories exist
     */
    private ensureDirectoriesExist;
    /**
     * Load all voice comments from storage
     */
    loadAllComments(): Promise<VoiceComment[]>;
    /**
     * Save a voice comment to storage
     */
    saveComment(comment: VoiceComment): Promise<boolean>;
    /**
     * Delete a voice comment from storage
     */
    deleteComment(commentId: string): Promise<boolean>;
    /**
     * Get audio data for a specific comment
     */
    getAudioData(commentId: string): Promise<string | null>;
    /**
     * Load the index file
     */
    private loadIndex;
    /**
     * Save the index file
     */
    private saveIndex;
    /**
     * Get comments for a specific file
     */
    getCommentsForFile(fileName: string): Promise<VoiceComment[]>;
    /**
     * Get the storage path info (for debugging/display)
     */
    getStorageInfo(): {
        basePath: string;
        workspacePath: string;
        audioPath: string;
    };
    /**
     * Clear all comments for the current workspace
     */
    clearAllComments(): Promise<void>;
}
export declare function getVoiceCommentStorage(context?: vscode.ExtensionContext): VoiceCommentStorage;
export declare function resetVoiceCommentStorage(): void;
//# sourceMappingURL=VoiceCommentStorage.d.ts.map