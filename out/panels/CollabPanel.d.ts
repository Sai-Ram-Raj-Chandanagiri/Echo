import * as vscode from 'vscode';
import { SharedTerminalProvider } from '../providers/SharedTerminalProvider';
export declare class CollabPanel implements vscode.WebviewViewProvider {
    private readonly _extensionUri;
    private readonly context;
    static readonly viewType = "codecollab.mainView";
    private _view?;
    private sessionService;
    private aiService;
    private webRTCService;
    private sharedTerminalProvider;
    private aiMessages;
    private pendingRecordingCallback;
    private pendingRecordingInfo;
    private isVideoEnabled;
    private isAudioEnabled;
    constructor(_extensionUri: vscode.Uri, context: vscode.ExtensionContext, sharedTerminalProvider: SharedTerminalProvider);
    private setupSessionListeners;
    resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    private handleMessage;
    private handleAIMessage;
    private handleAIAction;
    private handleFollowUser;
    private handleToggleVideo;
    handleToggleAudio(): Promise<void>;
    private handleShareTerminal;
    private updateView;
    private postMessage;
    /**
     * Check if the webview is ready for voice recording
     */
    isReady(): boolean;
    /**
     * Start voice recording via the webview
     * Option A: Uses existing authorized media stream from WebRTCService
     * Returns a promise that resolves with the recording data or null if cancelled
     */
    startVoiceRecording(lineNumber: number, fileName: string): Promise<{
        audioData: string;
        duration: number;
    } | null>;
    /**
     * Cancel any pending voice recording
     */
    cancelVoiceRecording(): void;
    private _getHtmlForWebview;
    private getNonce;
}
//# sourceMappingURL=CollabPanel.d.ts.map