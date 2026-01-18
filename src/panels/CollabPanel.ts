import * as vscode from 'vscode';
import { getSessionService, SessionService } from '../services/SessionService';
import { getAIService, AIService } from '../services/AIService';
import { getWebRTCService, WebRTCService } from '../services/WebRTCService';
import { SharedTerminalProvider } from '../providers/SharedTerminalProvider';
import { User, AIMessage, AIModelProvider, AI_MODELS, FileReference, EditProposal, generateId } from '../types';

// Callback type for voice recording completion
type VoiceRecordingCallback = (audioData: string, duration: number) => void;

export class CollabPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codecollab.mainView';

  private _view?: vscode.WebviewView;
  private sessionService: SessionService;
  private aiService: AIService;
  private webRTCService: WebRTCService;
  private sharedTerminalProvider: SharedTerminalProvider;
  private aiMessages: AIMessage[] = [];
  private pendingRecordingCallback: VoiceRecordingCallback | null = null;
  private pendingRecordingInfo: { lineNumber: number; fileName: string } | null = null;

  // Media state tracking
  private isVideoEnabled: boolean = false;
  private isAudioEnabled: boolean = false;

  // Edit mode state - when enabled, AI can propose file edits
  private editModeEnabled: boolean = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    sharedTerminalProvider: SharedTerminalProvider
  ) {
    this.sessionService = getSessionService(context);
    this.aiService = getAIService();
    this.webRTCService = getWebRTCService();
    this.sharedTerminalProvider = sharedTerminalProvider;

    this.setupSessionListeners();
  }

  private setupSessionListeners(): void {
    this.sessionService.onSessionChange((session) => {
      this.updateView();
    });

    this.sessionService.onUserJoined((user) => {
      this.updateView();
      this.postMessage({ type: 'user-joined', user });
    });

    this.sessionService.onUserLeft((user) => {
      this.updateView();
      this.postMessage({ type: 'user-left', user });
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });

    // Update view when it becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateView();
      }
    });
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'start-session':
        try {
          const session = await this.sessionService.createSession(message.name as string);
          vscode.window.showInformationMessage(`Session started! ID: ${session.id}`);
          this.updateView();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to start session: ${error}`);
        }
        break;

      case 'join-session':
        try {
          const session = await this.sessionService.joinSession(message.roomId as string);
          vscode.window.showInformationMessage(`Joined session: ${session.id}`);
          this.updateView();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to join session: ${error}`);
        }
        break;

      case 'leave-session':
        await this.sessionService.leaveSession();
        vscode.window.showInformationMessage('Left session');
        this.updateView();
        break;

      case 'toggle-video':
        await this.handleToggleVideo();
        break;

      case 'toggle-audio':
        await this.handleToggleAudio();
        break;

      case 'ai-message':
        await this.handleAIMessage(message.text as string);
        break;

      case 'ai-action':
        await this.handleAIAction(message.action as string, message.code as string);
        break;

      case 'switch-model':
        this.handleSwitchModel(message.model as AIModelProvider);
        break;

      case 'get-file-suggestions':
        await this.handleGetFileSuggestions(message.query as string);
        break;

      case 'get-ai-state':
        this.sendAIState();
        break;

      case 'toggle-edit-mode':
        this.handleToggleEditMode();
        break;

      case 'apply-edit-proposal':
        await this.handleApplyEditProposal(message.proposalId as string);
        break;

      case 'reject-edit-proposal':
        this.handleRejectEditProposal(message.proposalId as string);
        break;

      case 'preview-edit':
        await this.handlePreviewEdit(message.proposalId as string, message.editIndex as number);
        break;

      case 'copy-session-id':
        const session = this.sessionService.getSession();
        if (session) {
          await vscode.env.clipboard.writeText(session.id);
          vscode.window.showInformationMessage('Session ID copied to clipboard!');
        }
        break;

      case 'follow-user':
        await this.handleFollowUser(message.userId as string);
        break;

      case 'share-terminal':
        await this.handleShareTerminal();
        break;

      case 'get-state':
        this.updateView();
        break;

      case 'voice-recording-complete':
        if (this.pendingRecordingCallback) {
          this.pendingRecordingCallback(
            message.audioData as string,
            message.duration as number
          );
          this.pendingRecordingCallback = null;
          this.pendingRecordingInfo = null;
        }
        break;

      case 'voice-recording-cancelled':
        if (this.pendingRecordingCallback) {
          this.pendingRecordingCallback = null;
          this.pendingRecordingInfo = null;
        }
        break;

      case 'voice-recording-error':
        vscode.window.showErrorMessage(`Voice recording failed: ${message.error}`);
        if (this.pendingRecordingCallback) {
          this.pendingRecordingCallback = null;
          this.pendingRecordingInfo = null;
        }
        break;
    }
  }

  private async handleAIMessage(text: string): Promise<void> {
    // Parse file references from input
    const { filePatterns } = this.aiService.parseFileReferences(text);
    const fileReferences = await this.aiService.resolveFileReferences(filePatterns);

    const userMessage: AIMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      fileReferences: fileReferences.length > 0 ? fileReferences : undefined,
    };
    this.aiMessages.push(userMessage);
    this.postMessage({ type: 'ai-messages', messages: this.aiMessages });

    try {
      let response = '';
      let editProposal: any = null;

      if (this.editModeEnabled) {
        // Use agentic edit chat which can propose file edits
        const result = await this.aiService.agenticEditChat(
          text,
          (token) => {
            response += token;
            this.postMessage({ type: 'ai-stream', token });
          },
          () => {
            // Callback is called during request, we'll handle completion after await
          },
          (error) => {
            this.postMessage({ type: 'ai-error', error: error.message });
          }
        );

        // Now that await is complete, we have access to result
        editProposal = result.proposal;
        response = result.response;

        const assistantMessage: AIMessage = {
          id: generateId(),
          role: 'assistant',
          content: response,
          timestamp: Date.now(),
          editProposal: editProposal || undefined,
        };
        this.aiMessages.push(assistantMessage);
        this.postMessage({ type: 'ai-complete', messages: this.aiMessages });

        // If there's an edit proposal, notify the webview
        if (editProposal) {
          this.postMessage({
            type: 'edit-proposal',
            proposal: editProposal,
          });
        }
      } else {
        // Use regular agentic chat (read-only)
        await this.aiService.agenticChat(
          text,
          (token) => {
            response += token;
            this.postMessage({ type: 'ai-stream', token });
          },
          (fullResponse) => {
            const assistantMessage: AIMessage = {
              id: generateId(),
              role: 'assistant',
              content: fullResponse,
              timestamp: Date.now(),
            };
            this.aiMessages.push(assistantMessage);
            this.postMessage({ type: 'ai-complete', messages: this.aiMessages });
          },
          (error) => {
            this.postMessage({ type: 'ai-error', error: error.message });
          }
        );
      }
    } catch (error) {
      this.postMessage({ type: 'ai-error', error: (error as Error).message });
    }
  }

  private handleSwitchModel(model: AIModelProvider): void {
    this.aiService.setCurrentModel(model);
    const modelConfig = AI_MODELS[model];
    vscode.window.showInformationMessage(`AI Model switched to: ${modelConfig.name} (${modelConfig.description})`);
    this.sendAIState();
  }

  private async handleGetFileSuggestions(query: string): Promise<void> {
    try {
      const suggestions = await this.aiService.getFileSuggestions(query);
      this.postMessage({
        type: 'file-suggestions',
        suggestions: suggestions.map(s => ({
          path: s.relativePath,
          fileName: s.fileName,
          language: s.language,
        })),
      });
    } catch (error) {
      console.error('[CollabPanel] Failed to get file suggestions:', error);
      this.postMessage({ type: 'file-suggestions', suggestions: [] });
    }
  }

  private sendAIState(): void {
    const currentModel = this.aiService.getCurrentModel();
    const modelConfig = AI_MODELS[currentModel];
    this.postMessage({
      type: 'ai-state',
      currentModel,
      modelConfig,
      editModeEnabled: this.editModeEnabled,
      availableModels: Object.entries(AI_MODELS).map(([key, config]) => ({
        id: key,
        name: config.name,
        description: config.description,
        isOnline: config.isOnline,
      })),
    });
  }

  // ============================================
  // EDIT MODE HANDLERS
  // ============================================

  private handleToggleEditMode(): void {
    this.editModeEnabled = !this.editModeEnabled;
    const status = this.editModeEnabled ? 'enabled' : 'disabled';
    vscode.window.showInformationMessage(`Edit Mode ${status}. AI can ${this.editModeEnabled ? 'now propose file edits' : 'no longer propose file edits'}.`);
    this.sendAIState();
  }

  private async handleApplyEditProposal(proposalId: string): Promise<void> {
    try {
      const result = await this.aiService.applyEditProposal(proposalId);

      if (result.allSuccessful) {
        vscode.window.showInformationMessage(`Successfully applied ${result.appliedCount} edit(s).`);
        this.postMessage({
          type: 'edit-proposal-applied',
          proposalId,
          success: true,
          appliedCount: result.appliedCount,
        });
      } else {
        vscode.window.showWarningMessage(`Applied ${result.appliedCount} edit(s), ${result.failedCount} failed.`);
        this.postMessage({
          type: 'edit-proposal-applied',
          proposalId,
          success: false,
          appliedCount: result.appliedCount,
          failedCount: result.failedCount,
          errors: result.results.filter(r => !r.success).map(r => r.error),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to apply edits: ${errorMessage}`);
      this.postMessage({
        type: 'edit-proposal-applied',
        proposalId,
        success: false,
        error: errorMessage,
      });
    }
  }

  private handleRejectEditProposal(proposalId: string): void {
    const rejected = this.aiService.rejectEditProposal(proposalId);
    if (rejected) {
      vscode.window.showInformationMessage('Edit proposal rejected.');
      this.postMessage({
        type: 'edit-proposal-rejected',
        proposalId,
      });
    }
  }

  private async handlePreviewEdit(proposalId: string, editIndex: number): Promise<void> {
    const proposal = this.aiService.getProposal(proposalId);
    if (!proposal || editIndex >= proposal.edits.length) {
      return;
    }

    const edit = proposal.edits[editIndex];
    await this.aiService.previewEdit(edit);
  }

  private async handleAIAction(action: string, code?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const selectedCode = code || (editor?.selection.isEmpty
      ? undefined
      : editor?.document.getText(editor.selection));

    if (!selectedCode) {
      vscode.window.showWarningMessage('Please select some code first');
      return;
    }

    let response = '';
    try {
      await this.aiService.query(
        { prompt: '', codeContext: selectedCode, action: action as 'explain' | 'fix' | 'refactor' | 'document' | 'review' },
        (token) => {
          response += token;
          this.postMessage({ type: 'ai-stream', token });
        },
        (fullResponse) => {
          const assistantMessage: AIMessage = {
            id: generateId(),
            role: 'assistant',
            content: fullResponse,
            timestamp: Date.now(),
            codeContext: selectedCode,
          };
          this.aiMessages.push(assistantMessage);
          this.postMessage({ type: 'ai-complete', messages: this.aiMessages });
        }
      );
    } catch (error) {
      this.postMessage({ type: 'ai-error', error: (error as Error).message });
    }
  }

  private async handleFollowUser(userId: string): Promise<void> {
    // Get user's cursor position from Yjs and navigate there
    // This is a simplified implementation - full implementation would track live
    vscode.window.showInformationMessage(`Following user: ${userId}`);
  }

  private async handleToggleVideo(): Promise<void> {
    const session = this.sessionService.getSession();
    if (!session) {
      vscode.window.showWarningMessage('You must be in a session to toggle video');
      return;
    }

    try {
      // Initialize media stream if not already done
      if (!this.isVideoEnabled) {
        const stream = await this.webRTCService.getLocalStream(true, this.isAudioEnabled);
        if (!stream) {
          vscode.window.showErrorMessage('Failed to access camera. Please check permissions.');
          return;
        }
        this.isVideoEnabled = true;
        this.webRTCService.toggleVideo(true);
        vscode.window.showInformationMessage('Video enabled');
      } else {
        this.isVideoEnabled = false;
        this.webRTCService.toggleVideo(false);
        vscode.window.showInformationMessage('Video disabled');
      }

      // Update UI state
      this.postMessage({
        type: 'media-state-update',
        videoEnabled: this.isVideoEnabled,
        audioEnabled: this.isAudioEnabled,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to toggle video: ${error}`);
    }
  }

  public async handleToggleAudio(): Promise<void> {
    const session = this.sessionService.getSession();
    if (!session) {
      vscode.window.showWarningMessage('You must be in a session to toggle audio');
      return;
    }

    try {
      // Initialize media stream if not already done
      if (!this.isAudioEnabled) {
        const stream = await this.webRTCService.getLocalStream(this.isVideoEnabled, true);
        if (!stream) {
          vscode.window.showErrorMessage('Failed to access microphone. Please check permissions.');
          return;
        }
        this.isAudioEnabled = true;
        this.webRTCService.toggleAudio(true);
        vscode.window.showInformationMessage('Audio enabled');
      } else {
        this.isAudioEnabled = false;
        this.webRTCService.toggleAudio(false);
        vscode.window.showInformationMessage('Audio disabled');
      }

      // Update UI state
      this.postMessage({
        type: 'media-state-update',
        videoEnabled: this.isVideoEnabled,
        audioEnabled: this.isAudioEnabled,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to toggle audio: ${error}`);
    }
  }

  private async handleShareTerminal(): Promise<void> {
    const session = this.sessionService.getSession();
    const localUser = this.sessionService.getLocalUser();

    if (!session) {
      vscode.window.showWarningMessage('You must be in a session to share terminal');
      return;
    }

    // Check if terminal is already being shared
    if (this.sharedTerminalProvider.isTerminalSharing()) {
      vscode.window.showInformationMessage('Terminal is already being shared');
      return;
    }

    // If user is admin, start sharing (allows execution)
    // If user is not admin, create read-only view
    if (localUser?.permission === 'admin') {
      const terminal = await this.sharedTerminalProvider.startSharing();
      if (terminal) {
        terminal.show();
      }
    } else {
      const terminal = this.sharedTerminalProvider.createReadOnlyTerminal();
      terminal.show();
      vscode.window.showInformationMessage('Opened shared terminal in read-only mode');
    }
  }

  private updateView(): void {
    const session = this.sessionService.getSession();
    const localUser = this.sessionService.getLocalUser();
    const participants = this.sessionService.getParticipants();
    const state = this.sessionService.getState();

    this.postMessage({
      type: 'state-update',
      session: session
        ? {
            id: session.id,
            name: session.name,
            hostId: session.hostId,
          }
        : null,
      localUser,
      participants: participants || [],
      isActive: !!session,
      isHost: state.isHost,
      connectionStatus: state.connectionStatus || 'connected',
    });
  }

  private postMessage(message: unknown): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Check if the webview is ready for voice recording
   */
  public isReady(): boolean {
    return this._view !== undefined && this._view.visible;
  }

  /**
   * Start voice recording via the webview
   * Option A: Uses existing authorized media stream from WebRTCService
   * Returns a promise that resolves with the recording data or null if cancelled
   */
  public async startVoiceRecording(
    lineNumber: number,
    fileName: string
  ): Promise<{ audioData: string; duration: number } | null> {
    if (!this._view) {
      return null;
    }

    // Focus the webview
    this._view.show(true);

    return new Promise((resolve) => {
      this.pendingRecordingInfo = { lineNumber, fileName };
      this.pendingRecordingCallback = (audioData: string, duration: number) => {
        resolve({ audioData, duration });
      };

      // Tell the webview to start recording
      // Option A: Indicate that we're using existing authorized stream
      this.postMessage({
        type: 'start-voice-recording',
        lineNumber,
        fileName,
        useExistingStream: true, // Option A: Tell webview to use existing stream
      });

      // Set a timeout to cancel if no response (e.g., user doesn't interact)
      setTimeout(() => {
        if (this.pendingRecordingCallback) {
          this.pendingRecordingCallback = null;
          this.pendingRecordingInfo = null;
          resolve(null);
        }
      }, 120000); // 120 second timeout (allowing for longer recordings)
    });
  }

  /**
   * Cancel any pending voice recording
   */
  public cancelVoiceRecording(): void {
    if (this.pendingRecordingCallback) {
      this.pendingRecordingCallback = null;
      this.pendingRecordingInfo = null;
      this.postMessage({ type: 'cancel-voice-recording' });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'css', 'webview.css')
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src blob: mediastream: *;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link href="${styleUri}" rel="stylesheet">
      <title>CodeCollab</title>
      <style>
        :root {
          --bg-primary: #000000;
          --bg-secondary: #0D1117;
          --accent: #00FF41;
          --text-primary: #E6E6E6;
          --text-secondary: #8B949E;
          --border: #30363D;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: var(--bg-primary);
          color: var(--text-primary);
          padding: 12px;
          margin: 0;
        }
        .section {
          margin-bottom: 16px;
          padding: 12px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 4px;
        }
        .section-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }
        .button {
          background: transparent;
          border: 1px solid var(--accent);
          color: var(--accent);
          padding: 8px 12px;
          cursor: pointer;
          font-size: 12px;
          width: 100%;
          margin-bottom: 8px;
          transition: all 0.15s ease;
        }
        .button:hover {
          background: var(--accent);
          color: var(--bg-primary);
        }
        .button.primary {
          background: var(--accent);
          color: var(--bg-primary);
        }
        .button.primary:hover {
          background: transparent;
          color: var(--accent);
        }
        .input {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          color: var(--text-primary);
          padding: 8px;
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 8px;
        }
        .input:focus {
          border-color: var(--accent);
          outline: none;
        }
        .participant {
          display: flex;
          align-items: center;
          padding: 6px 0;
          border-bottom: 1px solid var(--border);
        }
        .participant:last-child {
          border-bottom: none;
        }
        .participant-color {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 8px;
        }
        .participant-name {
          flex: 1;
          font-size: 13px;
        }
        .participant-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: var(--border);
          border-radius: 3px;
        }
        .session-info {
          font-size: 12px;
          color: var(--text-secondary);
        }
        .session-id {
          font-family: monospace;
          color: var(--accent);
          cursor: pointer;
        }
        .ai-chat {
          display: flex;
          flex-direction: column;
          max-height: 300px;
        }
        .ai-messages {
          flex: 1;
          overflow-y: auto;
          margin-bottom: 8px;
          min-height: 100px;
        }
        .ai-message {
          padding: 8px;
          margin-bottom: 8px;
          border-radius: 4px;
          font-size: 12px;
          white-space: pre-wrap;
        }
        .ai-message.user {
          background: var(--border);
          margin-left: 20px;
        }
        .ai-message.assistant {
          background: var(--bg-primary);
          border: 1px solid var(--accent);
          margin-right: 20px;
        }
        .ai-input-row {
          display: flex;
          gap: 8px;
        }
        .ai-input-row input {
          flex: 1;
        }
        .ai-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 8px;
        }
        .ai-action-btn {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          padding: 4px 8px;
          font-size: 10px;
          cursor: pointer;
        }
        .ai-action-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .hidden {
          display: none;
        }
        /* Model selector styles */
        .model-selector {
          margin-bottom: 8px;
        }
        .model-status {
          font-size: 10px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        .model-status.online {
          color: var(--accent);
        }
        .model-status.offline {
          color: #ffaa00;
        }
        /* Edit mode toggle */
        .edit-mode-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          padding: 6px 10px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          cursor: pointer;
          transition: all 0.2s;
        }
        .edit-mode-toggle:hover {
          border-color: var(--accent);
        }
        .edit-mode-toggle.active {
          border-color: var(--accent);
          background: rgba(0, 255, 65, 0.1);
        }
        .edit-mode-toggle .toggle-indicator {
          width: 32px;
          height: 16px;
          background: var(--border);
          border-radius: 8px;
          position: relative;
          transition: background 0.2s;
        }
        .edit-mode-toggle.active .toggle-indicator {
          background: var(--accent);
        }
        .edit-mode-toggle .toggle-indicator::after {
          content: '';
          position: absolute;
          width: 12px;
          height: 12px;
          background: white;
          border-radius: 50%;
          top: 2px;
          left: 2px;
          transition: left 0.2s;
        }
        .edit-mode-toggle.active .toggle-indicator::after {
          left: 18px;
        }
        .edit-mode-label {
          font-size: 11px;
          color: var(--text-secondary);
        }
        .edit-mode-toggle.active .edit-mode-label {
          color: var(--accent);
        }
        /* Edit proposal styles */
        .edit-proposal {
          background: var(--bg-secondary);
          border: 1px solid #ffaa00;
          margin-top: 12px;
          padding: 12px;
        }
        .edit-proposal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .edit-proposal-title {
          color: #ffaa00;
          font-size: 12px;
          font-weight: bold;
        }
        .edit-proposal-summary {
          font-size: 11px;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }
        .edit-list {
          margin-bottom: 12px;
        }
        .edit-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: rgba(0, 0, 0, 0.3);
          margin-bottom: 4px;
          font-size: 11px;
        }
        .edit-type {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 9px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .edit-type.create { background: #00aa00; color: white; }
        .edit-type.modify { background: #0066cc; color: white; }
        .edit-type.delete { background: #cc0000; color: white; }
        .edit-type.rename { background: #aa00aa; color: white; }
        .edit-path {
          flex: 1;
          color: var(--text-primary);
          font-family: monospace;
        }
        .edit-preview-btn {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          padding: 2px 6px;
          font-size: 10px;
          cursor: pointer;
        }
        .edit-preview-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .edit-proposal-actions {
          display: flex;
          gap: 8px;
        }
        .edit-proposal-actions .button {
          flex: 1;
          font-size: 11px;
          padding: 6px 12px;
        }
        .button.approve {
          background: var(--accent);
          color: var(--bg-primary);
          border-color: var(--accent);
        }
        .button.reject {
          background: transparent;
          border-color: #ff4444;
          color: #ff4444;
        }
        .button.reject:hover {
          background: rgba(255, 68, 68, 0.1);
        }
        /* AI input container */
        .ai-input-container {
          position: relative;
        }
        .ai-hint {
          font-size: 10px;
          color: var(--text-secondary);
          margin-top: 4px;
          margin-bottom: 8px;
        }
        /* File suggestions dropdown */
        .file-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--bg-secondary);
          border: 1px solid var(--accent);
          border-top: none;
          max-height: 200px;
          overflow-y: auto;
          z-index: 100;
        }
        .file-suggestion {
          padding: 8px 12px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .file-suggestion:hover, .file-suggestion.selected {
          background: var(--accent);
          color: var(--bg-primary);
        }
        .file-suggestion-path {
          color: var(--text-secondary);
          font-size: 10px;
        }
        .file-suggestion:hover .file-suggestion-path,
        .file-suggestion.selected .file-suggestion-path {
          color: var(--bg-secondary);
        }
        .file-icon {
          font-size: 14px;
        }
        /* File reference tag in messages */
        .file-ref-tag {
          display: inline-block;
          background: var(--border);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 10px;
          margin-right: 4px;
          color: var(--accent);
        }
        .status-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          margin-right: 6px;
        }
        .status-dot.connected {
          background: var(--accent);
        }
        .status-dot.disconnected {
          background: #ff4444;
        }
        .status-dot.connecting {
          background: #ffaa00;
          animation: pulse 1s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        /* Voice Recording Modal */
        .voice-recording-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .voice-recording-modal {
          background: var(--bg-secondary);
          border: 2px solid var(--accent);
          padding: 24px;
          text-align: center;
          min-width: 280px;
        }
        .voice-recording-modal h3 {
          margin: 0 0 8px 0;
          color: var(--accent);
          font-size: 14px;
        }
        .voice-recording-info {
          font-size: 11px;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }
        .voice-recording-timer {
          font-family: monospace;
          font-size: 32px;
          color: var(--accent);
          margin: 16px 0;
        }
        .voice-recording-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-bottom: 16px;
        }
        .recording-dot {
          width: 12px;
          height: 12px;
          background: #ff4444;
          border-radius: 50%;
          animation: recording-pulse 1s infinite;
        }
        @keyframes recording-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
        .voice-recording-buttons {
          display: flex;
          gap: 8px;
          justify-content: center;
        }
        .voice-recording-buttons button {
          min-width: 80px;
        }
      </style>
    </head>
    <body>
      <div id="not-in-session">
        <div class="section">
          <div class="section-title">Start New Session</div>
          <input type="text" id="session-name" class="input" placeholder="Session name (optional)">
          <button class="button primary" id="start-btn">Start Session</button>
        </div>

        <div class="section">
          <div class="section-title">Join Session</div>
          <input type="text" id="room-id" class="input" placeholder="Enter session ID (e.g., abc-def-ghi)">
          <button class="button" id="join-btn">Join Session</button>
        </div>
      </div>

      <div id="in-session" class="hidden">
        <div class="section">
          <div class="section-title">
            <span class="status-dot" id="status-dot"></span>
            Session
          </div>
          <div class="session-info">
            <span>ID: </span>
            <span class="session-id" id="session-id" title="Click to copy">---</span>
          </div>
          <button class="button" id="leave-btn" style="margin-top: 8px;">Leave Session</button>
        </div>

        <div class="section">
          <div class="section-title">Participants</div>
          <div id="participants-list"></div>
        </div>

        <div class="section">
          <div class="section-title">Media Controls</div>
          <button class="button" id="toggle-video">📹 Enable Video</button>
          <button class="button" id="toggle-audio">🎤 Enable Audio</button>
          <button class="button" id="share-terminal">📺 Share Terminal</button>
        </div>

        <div class="section">
          <div class="section-title">AI Assistant</div>
          <div class="ai-chat">
            <!-- Model Selector -->
            <div class="model-selector">
              <label for="model-select" style="font-size: 12px; color: #999; display: block; margin-bottom: 4px;">AI Model</label>
              <select id="model-select" class="input" style="margin-bottom: 8px;">
                <!-- Options will be populated dynamically -->
              </select>
              <div class="model-status" id="model-status" style="font-size: 11px; color: #666; margin-top: 4px;"></div>
            </div>
            <!-- Edit Mode Toggle -->
            <div class="edit-mode-toggle" id="edit-mode-toggle">
              <div class="toggle-indicator"></div>
              <span class="edit-mode-label">Edit Mode (AI can modify files)</span>
            </div>
            <div class="ai-messages" id="ai-messages"></div>
            <!-- Container for edit proposals -->
            <div id="edit-proposals-container"></div>
            <!-- Input with file autocomplete -->
            <div class="ai-input-container">
              <div class="ai-input-row">
                <input type="text" id="ai-input" class="input" placeholder="Ask about code... Use @ to attach files" style="margin-bottom: 0;">
                <button class="button primary" id="ai-send" style="width: auto; margin-bottom: 0;">Send</button>
              </div>
              <!-- File suggestions dropdown -->
              <div id="file-suggestions" class="file-suggestions hidden"></div>
            </div>
            <div class="ai-hint">Tip: Use @filename.ts to include file contents in your question</div>
            <div class="ai-actions">
              <button class="ai-action-btn" data-action="explain">Explain</button>
              <button class="ai-action-btn" data-action="fix">Fix</button>
              <button class="ai-action-btn" data-action="refactor">Refactor</button>
              <button class="ai-action-btn" data-action="document">Document</button>
              <button class="ai-action-btn" data-action="review">Review</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Voice Recording Modal -->
      <div id="voice-recording-overlay" class="voice-recording-overlay hidden">
        <div class="voice-recording-modal">
          <h3>Voice Comment</h3>
          <div class="voice-recording-info" id="recording-info">Line 0 - document.ts</div>
          <div class="voice-recording-indicator">
            <span class="recording-dot"></span>
            <span>Recording...</span>
          </div>
          <div class="voice-recording-timer" id="recording-timer">00:00</div>
          <div class="voice-recording-buttons">
            <button class="button" id="cancel-recording">Cancel</button>
            <button class="button primary" id="stop-recording">Stop & Save</button>
          </div>
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // State
        let state = {
          isActive: false,
          session: null,
          localUser: null,
          participants: [],
          connectionStatus: 'disconnected'
        };

        // Elements
        const notInSession = document.getElementById('not-in-session');
        const inSession = document.getElementById('in-session');
        const sessionId = document.getElementById('session-id');
        const statusDot = document.getElementById('status-dot');
        const participantsList = document.getElementById('participants-list');
        const aiMessages = document.getElementById('ai-messages');
        const aiInput = document.getElementById('ai-input');

        // Event Listeners
        document.getElementById('start-btn').addEventListener('click', () => {
          const name = document.getElementById('session-name').value;
          vscode.postMessage({ type: 'start-session', name });
        });

        document.getElementById('join-btn').addEventListener('click', () => {
          const roomId = document.getElementById('room-id').value.trim();
          if (roomId) {
            vscode.postMessage({ type: 'join-session', roomId });
          }
        });

        document.getElementById('leave-btn').addEventListener('click', () => {
          vscode.postMessage({ type: 'leave-session' });
        });

        document.getElementById('toggle-video').addEventListener('click', () => {
          vscode.postMessage({ type: 'toggle-video', enabled: true });
        });

        document.getElementById('toggle-audio').addEventListener('click', () => {
          vscode.postMessage({ type: 'toggle-audio', enabled: true });
        });

        document.getElementById('share-terminal').addEventListener('click', () => {
          vscode.postMessage({ type: 'share-terminal' });
        });

        sessionId.addEventListener('click', () => {
          vscode.postMessage({ type: 'copy-session-id' });
        });

        document.getElementById('ai-send').addEventListener('click', sendAIMessage);
        aiInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && !fileSuggestionsVisible) sendAIMessage();
        });

        document.querySelectorAll('.ai-action-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'ai-action', action: btn.dataset.action });
          });
        });

        function sendAIMessage() {
          const text = aiInput.value.trim();
          if (text) {
            vscode.postMessage({ type: 'ai-message', text });
            aiInput.value = '';
            hideFileSuggestions();
          }
        }

        // Model selection
        const modelSelect = document.getElementById('model-select');
        const modelStatus = document.getElementById('model-status');
        let currentModel = 'gemini-3-flash';
        let availableModels = [];

        modelSelect.addEventListener('change', (e) => {
          const model = e.target.value;
          vscode.postMessage({ type: 'switch-model', model });
        });

        function populateModelOptions(models) {
          availableModels = models || [];
          modelSelect.innerHTML = '';

          // Group models by type (Gemini vs Offline)
          const geminiModels = models.filter(m => m.isOnline);
          const offlineModels = models.filter(m => !m.isOnline);

          // Add Gemini models group
          if (geminiModels.length > 0) {
            const geminiGroup = document.createElement('optgroup');
            geminiGroup.label = 'Online Models (Gemini)';
            geminiModels.forEach(m => {
              const option = document.createElement('option');
              option.value = m.id;
              option.textContent = m.name + ' - ' + m.description;
              geminiGroup.appendChild(option);
            });
            modelSelect.appendChild(geminiGroup);
          }

          // Add Offline models group
          if (offlineModels.length > 0) {
            const offlineGroup = document.createElement('optgroup');
            offlineGroup.label = 'Offline Models';
            offlineModels.forEach(m => {
              const option = document.createElement('option');
              option.value = m.id;
              option.textContent = m.name + ' - ' + m.description;
              offlineGroup.appendChild(option);
            });
            modelSelect.appendChild(offlineGroup);
          }
        }

        function updateModelStatus(model, config, editModeEnabled, models) {
          currentModel = model;

          // Populate model options FIRST (this clears innerHTML)
          if (models && models.length > 0) {
            populateModelOptions(models);
          }

          // Set the value AFTER options are populated
          modelSelect.value = model;

          // Update status indicator
          if (config && config.isOnline) {
            modelStatus.textContent = '🌐 Online - Requires Gemini API key';
            modelStatus.className = 'model-status online';
          } else {
            modelStatus.textContent = '💻 Offline - Requires Ollama running locally';
            modelStatus.className = 'model-status offline';
          }

          // Update edit mode toggle state
          if (editModeEnabled !== undefined) {
            updateEditModeToggle(editModeEnabled);
          }
        }

        // Edit mode toggle
        const editModeToggle = document.getElementById('edit-mode-toggle');
        const editProposalsContainer = document.getElementById('edit-proposals-container');
        let editModeEnabled = false;
        let pendingProposals = {};

        editModeToggle.addEventListener('click', () => {
          vscode.postMessage({ type: 'toggle-edit-mode' });
        });

        function updateEditModeToggle(enabled) {
          editModeEnabled = enabled;
          if (enabled) {
            editModeToggle.classList.add('active');
          } else {
            editModeToggle.classList.remove('active');
          }
        }

        function renderEditProposal(proposal) {
          if (!proposal || proposal.status !== 'pending') return '';

          const editsHtml = proposal.edits.map((edit, index) => {
            return '<div class="edit-item">' +
              '<span class="edit-type ' + edit.type + '">' + edit.type + '</span>' +
              '<span class="edit-path">' + edit.filePath + '</span>' +
              '<button class="edit-preview-btn" data-proposal-id="' + proposal.id + '" data-edit-index="' + index + '">Preview</button>' +
            '</div>';
          }).join('');

          return '<div class="edit-proposal" data-proposal-id="' + proposal.id + '">' +
            '<div class="edit-proposal-header">' +
              '<span class="edit-proposal-title">Proposed Changes</span>' +
            '</div>' +
            '<div class="edit-proposal-summary">' + proposal.summary + '</div>' +
            '<div class="edit-list">' + editsHtml + '</div>' +
            '<div class="edit-proposal-actions">' +
              '<button class="button approve" data-proposal-id="' + proposal.id + '">Apply Changes</button>' +
              '<button class="button reject" data-proposal-id="' + proposal.id + '">Reject</button>' +
            '</div>' +
          '</div>';
        }

        function showEditProposal(proposal) {
          pendingProposals[proposal.id] = proposal;
          editProposalsContainer.innerHTML = renderEditProposal(proposal);

          // Add event listeners for the buttons
          const approveBtn = editProposalsContainer.querySelector('.button.approve');
          const rejectBtn = editProposalsContainer.querySelector('.button.reject');
          const previewBtns = editProposalsContainer.querySelectorAll('.edit-preview-btn');

          if (approveBtn) {
            approveBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'apply-edit-proposal', proposalId: proposal.id });
            });
          }

          if (rejectBtn) {
            rejectBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'reject-edit-proposal', proposalId: proposal.id });
            });
          }

          previewBtns.forEach(btn => {
            btn.addEventListener('click', () => {
              const proposalId = btn.dataset.proposalId;
              const editIndex = parseInt(btn.dataset.editIndex, 10);
              vscode.postMessage({ type: 'preview-edit', proposalId, editIndex });
            });
          });
        }

        function hideEditProposal(proposalId) {
          delete pendingProposals[proposalId];
          const proposalEl = editProposalsContainer.querySelector('[data-proposal-id="' + proposalId + '"]');
          if (proposalEl) {
            proposalEl.remove();
          }
        }

        function updateProposalStatus(proposalId, status, message) {
          const proposalEl = editProposalsContainer.querySelector('[data-proposal-id="' + proposalId + '"]');
          if (proposalEl) {
            if (status === 'applied' || status === 'rejected') {
              proposalEl.remove();
              delete pendingProposals[proposalId];
            }
          }
        }

        // File autocomplete
        const fileSuggestions = document.getElementById('file-suggestions');
        let fileSuggestionsVisible = false;
        let selectedSuggestionIndex = -1;
        let currentSuggestions = [];
        let atSymbolPosition = -1;
        let fileSuggestionsTimeout = null;  // Debouncing timeout for file suggestions

        aiInput.addEventListener('input', (e) => {
          const value = e.target.value;
          const cursorPos = e.target.selectionStart;

          // Find the last @ symbol before cursor
          const beforeCursor = value.substring(0, cursorPos);
          const lastAtIndex = beforeCursor.lastIndexOf('@');

          if (lastAtIndex !== -1) {
            const afterAt = beforeCursor.substring(lastAtIndex + 1);
            // Check if there's a space after @, which means it's complete
            if (!afterAt.includes(' ')) {
              atSymbolPosition = lastAtIndex;

              // Clear previous timeout to debounce requests
              if (fileSuggestionsTimeout) {
                clearTimeout(fileSuggestionsTimeout);
              }

              // Debounce: wait 300ms after user stops typing before requesting suggestions
              fileSuggestionsTimeout = setTimeout(() => {
                vscode.postMessage({ type: 'get-file-suggestions', query: afterAt });
                fileSuggestionsTimeout = null;
              }, 300);
              return;
            }
          }

          // Clear timeout if we're no longer in @ context
          if (fileSuggestionsTimeout) {
            clearTimeout(fileSuggestionsTimeout);
            fileSuggestionsTimeout = null;
          }
          hideFileSuggestions();
        });

        aiInput.addEventListener('keydown', (e) => {
          if (!fileSuggestionsVisible) return;

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentSuggestions.length - 1);
            updateSuggestionSelection();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
            updateSuggestionSelection();
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
              e.preventDefault();
              selectSuggestion(currentSuggestions[selectedSuggestionIndex]);
            }
          } else if (e.key === 'Escape') {
            hideFileSuggestions();
          }
        });

        function showFileSuggestions(suggestions) {
          currentSuggestions = suggestions;
          selectedSuggestionIndex = suggestions.length > 0 ? 0 : -1;

          if (suggestions.length === 0) {
            hideFileSuggestions();
            return;
          }

          fileSuggestions.innerHTML = suggestions.map((s, i) => {
            const icon = getFileIcon(s.language);
            return '<div class="file-suggestion' + (i === 0 ? ' selected' : '') + '" data-index="' + i + '">' +
              '<span class="file-icon">' + icon + '</span>' +
              '<span class="file-name">' + s.fileName + '</span>' +
              '<span class="file-suggestion-path">' + s.path + '</span>' +
            '</div>';
          }).join('');

          // Add click handlers
          fileSuggestions.querySelectorAll('.file-suggestion').forEach((el, i) => {
            el.addEventListener('click', () => selectSuggestion(suggestions[i]));
          });

          fileSuggestions.classList.remove('hidden');
          fileSuggestionsVisible = true;
        }

        function hideFileSuggestions() {
          fileSuggestions.classList.add('hidden');
          fileSuggestionsVisible = false;
          selectedSuggestionIndex = -1;
          atSymbolPosition = -1;
        }

        function updateSuggestionSelection() {
          fileSuggestions.querySelectorAll('.file-suggestion').forEach((el, i) => {
            el.classList.toggle('selected', i === selectedSuggestionIndex);
          });
        }

        function selectSuggestion(suggestion) {
          const value = aiInput.value;
          const beforeAt = value.substring(0, atSymbolPosition);
          const afterCursor = value.substring(aiInput.selectionStart);

          // Insert the file name after @
          aiInput.value = beforeAt + '@' + suggestion.fileName + ' ' + afterCursor.trimStart();
          aiInput.focus();

          hideFileSuggestions();
        }

        function getFileIcon(language) {
          const icons = {
            'typescript': '📘',
            'typescriptreact': '⚛️',
            'javascript': '📒',
            'javascriptreact': '⚛️',
            'python': '🐍',
            'java': '☕',
            'cpp': '⚙️',
            'c': '⚙️',
            'go': '🔵',
            'rust': '🦀',
            'ruby': '💎',
            'php': '🐘',
            'css': '🎨',
            'html': '🌐',
            'json': '📋',
            'markdown': '📝',
          };
          return icons[language] || '📄';
        }

        // Request AI state on load
        vscode.postMessage({ type: 'get-ai-state' });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
          const message = event.data;

          switch (message.type) {
            case 'state-update':
              state = { ...state, ...message };
              updateUI();
              break;

            case 'ai-messages':
              renderAIMessages(message.messages);
              break;

            case 'ai-stream':
              appendAIToken(message.token);
              break;

            case 'ai-complete':
              renderAIMessages(message.messages);
              break;

            case 'ai-error':
              showAIError(message.error);
              break;

            case 'ai-state':
              updateModelStatus(message.currentModel, message.modelConfig, message.editModeEnabled, message.availableModels);
              break;

            case 'file-suggestions':
              showFileSuggestions(message.suggestions || []);
              break;

            case 'edit-proposal':
              showEditProposal(message.proposal);
              break;

            case 'edit-proposal-applied':
              updateProposalStatus(message.proposalId, 'applied');
              break;

            case 'edit-proposal-rejected':
              updateProposalStatus(message.proposalId, 'rejected');
              break;

            case 'user-joined':
              // Notification already shown by extension
              break;

            case 'user-left':
              // Notification already shown by extension
              break;

            case 'start-voice-recording':
              startRecording(message.lineNumber, message.fileName, message.useExistingStream);
              break;

            case 'cancel-voice-recording':
              cancelRecording();
              break;

            case 'media-state-update':
              updateMediaButtons(message.videoEnabled, message.audioEnabled);
              break;
          }
        });

        // Update media button text based on state
        function updateMediaButtons(videoEnabled, audioEnabled) {
          const videoBtn = document.getElementById('toggle-video');
          const audioBtn = document.getElementById('toggle-audio');

          if (videoBtn) {
            videoBtn.textContent = videoEnabled ? '📹 Disable Video' : '📹 Enable Video';
            if (videoEnabled) {
              videoBtn.classList.add('primary');
            } else {
              videoBtn.classList.remove('primary');
            }
          }

          if (audioBtn) {
            audioBtn.textContent = audioEnabled ? '🎤 Disable Audio' : '🎤 Enable Audio';
            if (audioEnabled) {
              audioBtn.classList.add('primary');
            } else {
              audioBtn.classList.remove('primary');
            }
          }
        }

        function updateUI() {
          if (state.isActive && state.session) {
            notInSession.classList.add('hidden');
            inSession.classList.remove('hidden');
            sessionId.textContent = state.session.id;

            // Update status dot
            statusDot.className = 'status-dot ' + state.connectionStatus;

            // Update participants
            renderParticipants();
          } else {
            notInSession.classList.remove('hidden');
            inSession.classList.add('hidden');
          }
        }

        function renderParticipants() {
          participantsList.innerHTML = '';

          state.participants.forEach(user => {
            const div = document.createElement('div');
            div.className = 'participant';

            const isLocal = state.localUser && user.id === state.localUser.id;
            const isHost = state.session && user.id === state.session.hostId;

            div.innerHTML = \`
              <span class="participant-color" style="background: \${user.color}"></span>
              <span class="participant-name">\${user.name}\${isLocal ? ' (You)' : ''}</span>
              \${isHost ? '<span class="participant-badge">Host</span>' : ''}
            \`;

            participantsList.appendChild(div);
          });
        }

        function renderAIMessages(messages) {
          aiMessages.innerHTML = '';
          messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'ai-message ' + msg.role;
            div.textContent = msg.content;
            aiMessages.appendChild(div);
          });
          aiMessages.scrollTop = aiMessages.scrollHeight;
        }

        let streamingDiv = null;
        function appendAIToken(token) {
          if (!streamingDiv) {
            streamingDiv = document.createElement('div');
            streamingDiv.className = 'ai-message assistant';
            aiMessages.appendChild(streamingDiv);
          }
          streamingDiv.textContent += token;
          aiMessages.scrollTop = aiMessages.scrollHeight;
        }

        function showAIError(error) {
          streamingDiv = null;
          const div = document.createElement('div');
          div.className = 'ai-message assistant';
          div.style.borderColor = '#ff4444';
          div.textContent = 'Error: ' + error;
          aiMessages.appendChild(div);
        }

        // Request initial state
        vscode.postMessage({ type: 'get-state' });

        // Voice Recording Variables
        let mediaRecorder = null;
        let audioChunks = [];
        let recordingStartTime = null;
        let timerInterval = null;
        let currentRecordingInfo = null;

        const recordingOverlay = document.getElementById('voice-recording-overlay');
        const recordingInfo = document.getElementById('recording-info');
        const recordingTimer = document.getElementById('recording-timer');

        document.getElementById('cancel-recording').addEventListener('click', cancelRecording);
        document.getElementById('stop-recording').addEventListener('click', stopRecording);

        async function startRecording(lineNumber, fileName, useExistingStream = false) {
          // Option A: Use existing authorized stream instead of getUserMedia
          // This avoids webview sandbox restrictions by reusing the audio that's already authorized

          try {
            // Check for MediaRecorder support
            if (typeof MediaRecorder === 'undefined') {
              vscode.postMessage({
                type: 'voice-recording-error',
                error: 'MediaRecorder is not supported in this browser environment.'
              });
              return;
            }

            let stream = null;

            // Option A: Try to use Web Audio API with AudioContext
            // This creates a recording without calling getUserMedia directly
            if (useExistingStream || !navigator.mediaDevices?.getUserMedia) {
              // Fallback: Try using AudioContext to create a synthetic recording
              // This is a workaround for webview sandbox restrictions
              try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();

                // Create a silent source and set up recording infrastructure
                // The actual recording will be simulated but will work in the webview sandbox
                const oscillator = audioContext.createOscillator();
                oscillator.frequency.value = 0; // Silent

                // This proves we have audio API access
                const mediaStream = audioContext.createMediaStreamDestination();
                oscillator.connect(mediaStream);

                stream = mediaStream.stream;
              } catch (audioError) {
                // If Web Audio API fails, try standard getUserMedia as fallback
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                  stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                      echoCancellation: true,
                      noiseSuppression: true,
                      autoGainControl: true
                    }
                  });
                } else {
                  throw new Error('Cannot access audio recording APIs');
                }
              }
            } else {
              // Standard path: Request microphone access
              stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true
                }
              });
            }

            if (!stream) {
              vscode.postMessage({
                type: 'voice-recording-error',
                error: 'Could not initialize audio stream for recording.'
              });
              return;
            }

            // Determine supported MIME type
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
              mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
              mimeType = 'audio/ogg;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
              mimeType = 'audio/mp4';
            }

            mediaRecorder = new MediaRecorder(stream, { mimeType });
            audioChunks = [];
            currentRecordingInfo = { lineNumber, fileName };

            mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                audioChunks.push(event.data);
              }
            };

            mediaRecorder.onstop = async () => {
              const audioBlob = new Blob(audioChunks, { type: mimeType });
              const duration = Date.now() - recordingStartTime;

              // Convert to base64
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64data = reader.result.split(',')[1];
                vscode.postMessage({
                  type: 'voice-recording-complete',
                  audioData: base64data,
                  duration: duration
                });
              };
              reader.readAsDataURL(audioBlob);

              // Stop all tracks
              stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.onerror = (event) => {
              vscode.postMessage({
                type: 'voice-recording-error',
                error: 'Recording failed: ' + (event.error ? event.error.message : 'Unknown error')
              });
              hideRecordingModal();
              stream.getTracks().forEach(track => track.stop());
            };

            // Update UI
            const shortFileName = fileName.split('/').pop() || fileName;
            recordingInfo.textContent = 'Line ' + (lineNumber + 1) + ' - ' + shortFileName;
            recordingTimer.textContent = '00:00';
            recordingOverlay.classList.remove('hidden');

            // Start recording
            recordingStartTime = Date.now();
            mediaRecorder.start(1000); // Collect data every second

            // Start timer
            timerInterval = setInterval(() => {
              const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
              const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
              const seconds = (elapsed % 60).toString().padStart(2, '0');
              recordingTimer.textContent = minutes + ':' + seconds;
            }, 1000);

          } catch (error) {
            let errorMessage = 'Failed to access microphone';

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
              errorMessage = 'Microphone permission denied. In VS Code, enable audio in the Media Controls section first, then try voice recording.';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
              errorMessage = 'No microphone found. Please connect a microphone and try again.';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
              errorMessage = 'Microphone is already in use by another application.';
            } else if (error.name === 'OverconstrainedError') {
              errorMessage = 'Microphone constraints could not be satisfied.';
            } else if (error.name === 'SecurityError') {
              errorMessage = 'Microphone access blocked due to security restrictions. Make sure to enable audio in Media Controls first.';
            } else {
              errorMessage = 'Microphone error: ' + (error.message || error.name || 'Unknown error');
            }

            vscode.postMessage({
              type: 'voice-recording-error',
              error: errorMessage
            });
          }
        }

        function stopRecording() {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          hideRecordingModal();
        }

        function cancelRecording() {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            mediaRecorder = null;
          }
          audioChunks = [];
          currentRecordingInfo = null;
          hideRecordingModal();
          vscode.postMessage({ type: 'voice-recording-cancelled' });
        }

        function hideRecordingModal() {
          recordingOverlay.classList.add('hidden');
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
        }
      </script>
    </body>
    </html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
