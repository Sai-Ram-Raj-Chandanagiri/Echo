import * as vscode from 'vscode';
import { VoiceComment, User, generateId } from '../types';
import { getYjsService, YjsService } from '../services/YjsService';
import { getWebRTCService, WebRTCService } from '../services/WebRTCService';
import { getSessionService, SessionService } from '../services/SessionService';
import { getMediaCaptureServer, MediaCaptureServer } from '../services/MediaCaptureServer';
import { getVoiceCommentStorage, VoiceCommentStorage } from '../services/VoiceCommentStorage';
import type { CollabPanel } from '../panels/CollabPanel';

export class VoiceCommentProvider implements vscode.Disposable {
  private yjsService: YjsService;
  private webRTCService: WebRTCService;
  private sessionService: SessionService;
  private mediaCaptureServer: MediaCaptureServer;
  private voiceCommentStorage: VoiceCommentStorage;
  private voiceComments: Map<string, VoiceComment[]> = new Map(); // fileName -> comments (in-memory cache)
  private decorations: Map<string, vscode.TextEditorDecorationType> = new Map();
  private disposables: vscode.Disposable[] = [];
  private speakerDecorationType: vscode.TextEditorDecorationType;
  private collabPanel: CollabPanel | null = null;
  private isInitialized: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.yjsService = getYjsService();
    this.webRTCService = getWebRTCService();
    this.sessionService = getSessionService(context);
    this.mediaCaptureServer = getMediaCaptureServer();
    this.voiceCommentStorage = getVoiceCommentStorage(context);

    // Create gutter decoration for voice comments
    this.speakerDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.getSpeakerIconPath(context),
      gutterIconSize: 'contain',
    });

    this.setupListeners();

    // Load comments from storage asynchronously
    this.loadCommentsFromStorage();
  }

  /**
   * Load all voice comments from persistent storage
   */
  private async loadCommentsFromStorage(): Promise<void> {
    try {
      const comments = await this.voiceCommentStorage.loadAllComments();

      // Group comments by fileName
      for (const comment of comments) {
        if (!this.voiceComments.has(comment.fileName)) {
          this.voiceComments.set(comment.fileName, []);
        }
        this.voiceComments.get(comment.fileName)!.push(comment);
      }

      this.isInitialized = true;
      console.log(`[VoiceCommentProvider] Loaded ${comments.length} comments from storage`);

      // Update decorations for current editor
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        this.updateDecorations(editor);
      }
    } catch (error) {
      console.error('[VoiceCommentProvider] Error loading comments from storage:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Set the CollabPanel reference for voice recording via webview
   */
  setCollabPanel(panel: CollabPanel): void {
    this.collabPanel = panel;
  }

  private getSpeakerIconPath(context: vscode.ExtensionContext): vscode.Uri {
    // Use built-in codicon
    return vscode.Uri.parse('data:image/svg+xml,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <path fill="#00FF41" d="M11.5 4.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5zm-3-2a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-1 0V3a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm-3 1a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5z"/>
      </svg>
    `));
  }

  private setupListeners(): void {
    // Listen for voice comments from peers
    this.webRTCService.onData((peerId, data: unknown) => {
      const message = data as { type: string; payload: unknown };

      if (message.type === 'voice-comment-add') {
        const comment = message.payload as VoiceComment;
        this.addVoiceComment(comment, false);
      } else if (message.type === 'voice-comment-remove') {
        const commentId = message.payload as string;
        this.removeVoiceComment(commentId, false);
      }
    });

    // Update decorations when editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor);
        }
      })
    );

    // Register hover provider for voice comments
    this.disposables.push(
      vscode.languages.registerHoverProvider({ pattern: '**/*' }, {
        provideHover: (document, position) => {
          return this.provideHover(document, position);
        },
      })
    );
  }

  /**
   * Add a voice comment (to memory and storage)
   */
  async addVoiceComment(comment: VoiceComment, broadcast: boolean = true): Promise<void> {
    const fileName = comment.fileName;
    if (!this.voiceComments.has(fileName)) {
      this.voiceComments.set(fileName, []);
    }

    const comments = this.voiceComments.get(fileName)!;
    comments.push(comment);

    // Save to persistent storage
    const saved = await this.voiceCommentStorage.saveComment(comment);
    if (saved) {
      console.log('[VoiceCommentProvider] Comment saved to storage:', comment.id);
    }

    // Broadcast to peers
    if (broadcast) {
      this.webRTCService.broadcast({
        type: 'voice-comment-add',
        payload: comment,
      });
    }

    // Update decorations
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.toString() === fileName) {
      this.updateDecorations(editor);
    }
  }

  /**
   * Remove a voice comment (from memory and storage)
   */
  async removeVoiceComment(commentId: string, broadcast: boolean = true): Promise<void> {
    for (const [fileName, comments] of this.voiceComments) {
      const index = comments.findIndex((c) => c.id === commentId);
      if (index !== -1) {
        comments.splice(index, 1);

        // Delete from persistent storage
        const deleted = await this.voiceCommentStorage.deleteComment(commentId);
        if (deleted) {
          console.log('[VoiceCommentProvider] Comment deleted from storage:', commentId);
        }

        if (broadcast) {
          this.webRTCService.broadcast({
            type: 'voice-comment-remove',
            payload: commentId,
          });
        }

        // Update decorations
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === fileName) {
          this.updateDecorations(editor);
        }
        break;
      }
    }
  }

  getCommentsForLine(fileName: string, lineNumber: number): VoiceComment[] {
    const comments = this.voiceComments.get(fileName) || [];
    return comments.filter((c) => c.lineNumber === lineNumber);
  }

  getCommentsForFile(fileName: string): VoiceComment[] {
    return this.voiceComments.get(fileName) || [];
  }

  /**
   * Get a voice comment by ID
   */
  getCommentById(commentId: string): VoiceComment | null {
    for (const comments of this.voiceComments.values()) {
      const comment = comments.find((c) => c.id === commentId);
      if (comment) {
        return comment;
      }
    }
    return null;
  }

  /**
   * Get audio data for a comment (from storage if not in memory)
   */
  async getAudioData(commentId: string): Promise<string | null> {
    // First check in-memory cache
    const comment = this.getCommentById(commentId);
    if (comment && comment.audioData) {
      return comment.audioData;
    }

    // Fall back to storage
    return await this.voiceCommentStorage.getAudioData(commentId);
  }

  private updateDecorations(editor: vscode.TextEditor): void {
    const fileName = editor.document.uri.toString();
    const comments = this.voiceComments.get(fileName) || [];

    // Get unique lines with comments
    const linesWithComments = new Set(comments.map((c) => c.lineNumber));
    const ranges: vscode.Range[] = [];

    for (const line of linesWithComments) {
      if (line < editor.document.lineCount) {
        ranges.push(new vscode.Range(line, 0, line, 0));
      }
    }

    editor.setDecorations(this.speakerDecorationType, ranges);
  }

  private provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
    const fileName = document.uri.toString();
    const comments = this.getCommentsForLine(fileName, position.line);

    if (comments.length === 0) {
      return null;
    }

    const markdownContent = new vscode.MarkdownString();
    markdownContent.isTrusted = true;
    markdownContent.supportHtml = true;

    for (const comment of comments) {
      const timestamp = new Date(comment.timestamp).toLocaleString();
      const duration = Math.ceil(comment.duration / 1000);

      markdownContent.appendMarkdown(`**Voice Comment** by ${comment.author.name}\n\n`);
      markdownContent.appendMarkdown(`*${timestamp}* (${duration}s)\n\n`);

      // Add play button (command link)
      markdownContent.appendMarkdown(
        `[$(play) Play](command:codecollab.playVoiceComment?${encodeURIComponent(JSON.stringify(comment.id))})`
      );
      markdownContent.appendMarkdown(' | ');
      markdownContent.appendMarkdown(
        `[$(trash) Delete](command:codecollab.deleteVoiceComment?${encodeURIComponent(JSON.stringify(comment.id))})`
      );
      markdownContent.appendMarkdown('\n\n---\n\n');
    }

    return new vscode.Hover(markdownContent, new vscode.Range(position, position));
  }

  /**
   * Record a voice comment using the MediaCaptureServer
   * Opens a browser window for recording (bypasses VS Code webview sandbox)
   */
  async recordVoiceComment(lineNumber: number, fileName: string): Promise<VoiceComment | null> {
    const user = this.sessionService.getLocalUser();
    if (!user) {
      vscode.window.showErrorMessage('You must be in a session to record voice comments');
      return null;
    }

    // Show info message about what will happen
    const proceed = await vscode.window.showInformationMessage(
      'A browser window will open to record your voice comment. Click OK to continue.',
      'OK',
      'Cancel'
    );

    if (proceed !== 'OK') {
      return null;
    }

    // Use MediaCaptureServer to record in browser (full permissions)
    return new Promise((resolve) => {
      this.mediaCaptureServer.startRecording(
        lineNumber,
        fileName,
        // onComplete callback
        async (audioData: string, duration: number) => {
          const comment: VoiceComment = {
            id: generateId(),
            lineNumber,
            fileName,
            audioData,
            author: user,
            timestamp: Date.now(),
            duration,
          };

          await this.addVoiceComment(comment);
          vscode.window.showInformationMessage('Voice comment recorded and saved!');
          resolve(comment);
        },
        // onError callback
        (error: string) => {
          if (error !== 'Recording cancelled') {
            vscode.window.showErrorMessage(`Voice recording failed: ${error}`);
          }
          resolve(null);
        },
        300000 // 5 minute timeout
      );
    });
  }

  // Called from webview when recording is complete
  async handleRecordingComplete(
    lineNumber: number,
    fileName: string,
    audioData: string,
    duration: number
  ): Promise<VoiceComment | null> {
    const user = this.sessionService.getLocalUser();
    if (!user) {
      return null;
    }

    const comment: VoiceComment = {
      id: generateId(),
      lineNumber,
      fileName,
      audioData,
      author: user,
      timestamp: Date.now(),
      duration,
    };

    await this.addVoiceComment(comment);
    return comment;
  }

  /**
   * Clear all comments from memory (storage is preserved)
   */
  clearAllComments(): void {
    this.voiceComments.clear();

    // Clear decorations on all visible editors
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.speakerDecorationType, []);
    }
  }

  /**
   * Clear all comments from memory AND storage
   */
  async clearAllCommentsAndStorage(): Promise<void> {
    this.voiceComments.clear();
    await this.voiceCommentStorage.clearAllComments();

    // Clear decorations on all visible editors
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.speakerDecorationType, []);
    }
  }

  /**
   * Get storage info for debugging
   */
  getStorageInfo(): { basePath: string; workspacePath: string; audioPath: string } {
    return this.voiceCommentStorage.getStorageInfo();
  }

  dispose(): void {
    this.speakerDecorationType.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.voiceComments.clear();
  }
}
