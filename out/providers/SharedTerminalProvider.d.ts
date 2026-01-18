import * as vscode from 'vscode';
import { TerminalMessage } from '../types';
export declare class SharedTerminalProvider implements vscode.Disposable {
    private webRTCService;
    private sessionService;
    private sharedTerminal;
    private terminalHistory;
    private isSharing;
    private writeEmitter;
    private disposables;
    private currentCommand;
    private workingDirectory;
    private isExecuting;
    private commandHistory;
    private historyIndex;
    constructor(context: vscode.ExtensionContext);
    private setupWebRTCHandlers;
    startSharing(): Promise<vscode.Terminal | null>;
    stopSharing(): void;
    private handleLocalInput;
    private executeCommand;
    private executeShellCommand;
    private handleCdCommand;
    private showHelpMessage;
    private showPrompt;
    private broadcastOutput;
    private showPreviousCommand;
    private showNextCommand;
    private replaceCurrentCommand;
    private handleRemoteTerminalOutput;
    private handleRemoteTerminalInput;
    getHistory(): TerminalMessage[];
    clearHistory(): void;
    isTerminalSharing(): boolean;
    createReadOnlyTerminal(): vscode.Terminal;
    dispose(): void;
}
//# sourceMappingURL=SharedTerminalProvider.d.ts.map