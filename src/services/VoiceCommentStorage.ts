import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { VoiceComment, User } from '../types';

/**
 * Metadata stored in the index file for each voice comment
 */
interface VoiceCommentMetadata {
  id: string;
  lineNumber: number;
  fileName: string;
  audioFileName: string;
  author: User;
  timestamp: number;
  duration: number;
}

/**
 * Index file structure
 */
interface VoiceCommentIndex {
  version: number;
  comments: VoiceCommentMetadata[];
}

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
export class VoiceCommentStorage {
  private context: vscode.ExtensionContext;
  private storageBasePath: string = '';
  private workspaceStoragePath: string = '';
  private audioFolderPath: string = '';
  private indexFilePath: string = '';
  private initialized: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Initialize storage paths based on current workspace
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Use VS Code's global storage path for the extension
    const globalStorageUri = this.context.globalStorageUri;
    this.storageBasePath = path.join(globalStorageUri.fsPath, 'voice-comments');

    // Get workspace identifier
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceId = workspaceFolder
      ? this.hashString(workspaceFolder.uri.fsPath)
      : 'no-workspace';

    // Set up paths
    this.workspaceStoragePath = path.join(this.storageBasePath, workspaceId);
    this.audioFolderPath = path.join(this.workspaceStoragePath, 'audio');
    this.indexFilePath = path.join(this.workspaceStoragePath, 'index.json');

    // Create directories if they don't exist
    await this.ensureDirectoriesExist();

    this.initialized = true;
    console.log('[VoiceCommentStorage] Initialized at:', this.workspaceStoragePath);
  }

  /**
   * Simple hash function for workspace path
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to base36 and take absolute value
    return Math.abs(hash).toString(36);
  }

  /**
   * Ensure all required directories exist
   */
  private async ensureDirectoriesExist(): Promise<void> {
    const dirs = [this.storageBasePath, this.workspaceStoragePath, this.audioFolderPath];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('[VoiceCommentStorage] Created directory:', dir);
      }
    }
  }

  /**
   * Load all voice comments from storage
   */
  async loadAllComments(): Promise<VoiceComment[]> {
    await this.initialize();

    try {
      if (!fs.existsSync(this.indexFilePath)) {
        return [];
      }

      const indexContent = fs.readFileSync(this.indexFilePath, 'utf-8');
      const index: VoiceCommentIndex = JSON.parse(indexContent);

      const comments: VoiceComment[] = [];

      for (const metadata of index.comments) {
        const audioFilePath = path.join(this.audioFolderPath, metadata.audioFileName);

        if (fs.existsSync(audioFilePath)) {
          // Load audio data from file
          const audioBuffer = fs.readFileSync(audioFilePath);
          const audioData = audioBuffer.toString('base64');

          comments.push({
            id: metadata.id,
            lineNumber: metadata.lineNumber,
            fileName: metadata.fileName,
            audioData: audioData,
            author: metadata.author,
            timestamp: metadata.timestamp,
            duration: metadata.duration,
          });
        } else {
          console.warn('[VoiceCommentStorage] Audio file not found:', audioFilePath);
        }
      }

      console.log(`[VoiceCommentStorage] Loaded ${comments.length} voice comments`);
      return comments;

    } catch (error) {
      console.error('[VoiceCommentStorage] Error loading comments:', error);
      return [];
    }
  }

  /**
   * Save a voice comment to storage
   */
  async saveComment(comment: VoiceComment): Promise<boolean> {
    await this.initialize();

    try {
      // Generate audio filename based on comment ID
      const audioFileName = `${comment.id}.webm`;
      const audioFilePath = path.join(this.audioFolderPath, audioFileName);

      // Save audio data to file (decode base64)
      const audioBuffer = Buffer.from(comment.audioData, 'base64');
      fs.writeFileSync(audioFilePath, audioBuffer);
      console.log('[VoiceCommentStorage] Saved audio file:', audioFilePath);

      // Update index
      const index = await this.loadIndex();

      // Add new comment metadata
      const metadata: VoiceCommentMetadata = {
        id: comment.id,
        lineNumber: comment.lineNumber,
        fileName: comment.fileName,
        audioFileName: audioFileName,
        author: comment.author,
        timestamp: comment.timestamp,
        duration: comment.duration,
      };

      // Remove existing comment with same ID if exists
      index.comments = index.comments.filter(c => c.id !== comment.id);
      index.comments.push(metadata);

      // Save index
      await this.saveIndex(index);

      console.log('[VoiceCommentStorage] Comment saved successfully:', comment.id);
      return true;

    } catch (error) {
      console.error('[VoiceCommentStorage] Error saving comment:', error);
      return false;
    }
  }

  /**
   * Delete a voice comment from storage
   */
  async deleteComment(commentId: string): Promise<boolean> {
    await this.initialize();

    try {
      // Load index
      const index = await this.loadIndex();

      // Find comment
      const commentIndex = index.comments.findIndex(c => c.id === commentId);
      if (commentIndex === -1) {
        console.warn('[VoiceCommentStorage] Comment not found for deletion:', commentId);
        return false;
      }

      const metadata = index.comments[commentIndex];

      // Delete audio file
      const audioFilePath = path.join(this.audioFolderPath, metadata.audioFileName);
      if (fs.existsSync(audioFilePath)) {
        fs.unlinkSync(audioFilePath);
        console.log('[VoiceCommentStorage] Deleted audio file:', audioFilePath);
      }

      // Remove from index
      index.comments.splice(commentIndex, 1);

      // Save index
      await this.saveIndex(index);

      console.log('[VoiceCommentStorage] Comment deleted successfully:', commentId);
      return true;

    } catch (error) {
      console.error('[VoiceCommentStorage] Error deleting comment:', error);
      return false;
    }
  }

  /**
   * Get audio data for a specific comment
   */
  async getAudioData(commentId: string): Promise<string | null> {
    await this.initialize();

    try {
      const index = await this.loadIndex();
      const metadata = index.comments.find(c => c.id === commentId);

      if (!metadata) {
        console.warn('[VoiceCommentStorage] Comment not found:', commentId);
        return null;
      }

      const audioFilePath = path.join(this.audioFolderPath, metadata.audioFileName);

      if (!fs.existsSync(audioFilePath)) {
        console.warn('[VoiceCommentStorage] Audio file not found:', audioFilePath);
        return null;
      }

      const audioBuffer = fs.readFileSync(audioFilePath);
      return audioBuffer.toString('base64');

    } catch (error) {
      console.error('[VoiceCommentStorage] Error getting audio data:', error);
      return null;
    }
  }

  /**
   * Load the index file
   */
  private async loadIndex(): Promise<VoiceCommentIndex> {
    try {
      if (fs.existsSync(this.indexFilePath)) {
        const content = fs.readFileSync(this.indexFilePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[VoiceCommentStorage] Error loading index:', error);
    }

    // Return empty index
    return {
      version: 1,
      comments: [],
    };
  }

  /**
   * Save the index file
   */
  private async saveIndex(index: VoiceCommentIndex): Promise<void> {
    const content = JSON.stringify(index, null, 2);
    fs.writeFileSync(this.indexFilePath, content, 'utf-8');
  }

  /**
   * Get comments for a specific file
   */
  async getCommentsForFile(fileName: string): Promise<VoiceComment[]> {
    const allComments = await this.loadAllComments();
    return allComments.filter(c => c.fileName === fileName);
  }

  /**
   * Get the storage path info (for debugging/display)
   */
  getStorageInfo(): { basePath: string; workspacePath: string; audioPath: string } {
    return {
      basePath: this.storageBasePath,
      workspacePath: this.workspaceStoragePath,
      audioPath: this.audioFolderPath,
    };
  }

  /**
   * Clear all comments for the current workspace
   */
  async clearAllComments(): Promise<void> {
    await this.initialize();

    try {
      // Delete all audio files
      if (fs.existsSync(this.audioFolderPath)) {
        const files = fs.readdirSync(this.audioFolderPath);
        for (const file of files) {
          fs.unlinkSync(path.join(this.audioFolderPath, file));
        }
      }

      // Reset index
      await this.saveIndex({ version: 1, comments: [] });

      console.log('[VoiceCommentStorage] Cleared all comments');
    } catch (error) {
      console.error('[VoiceCommentStorage] Error clearing comments:', error);
    }
  }
}

// Singleton instance
let voiceCommentStorageInstance: VoiceCommentStorage | null = null;
let storageContext: vscode.ExtensionContext | null = null;

export function getVoiceCommentStorage(context?: vscode.ExtensionContext): VoiceCommentStorage {
  if (context) {
    storageContext = context;
  }

  if (!voiceCommentStorageInstance && storageContext) {
    voiceCommentStorageInstance = new VoiceCommentStorage(storageContext);
  }

  if (!voiceCommentStorageInstance) {
    throw new Error('VoiceCommentStorage not initialized. Call with context first.');
  }

  return voiceCommentStorageInstance;
}

export function resetVoiceCommentStorage(): void {
  voiceCommentStorageInstance = null;
  storageContext = null;
}
