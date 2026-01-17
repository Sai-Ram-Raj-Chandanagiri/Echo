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
    constructor(context: vscode.ExtensionContext);
    private setupWebRTCHandlers;
    startSharing(): Promise<vscode.Terminal | null>;
    stopSharing(): void;
    private handleLocalInput;
    private currentCommand;
    private executeCommand;
    private handleRemoteTerminalOutput;
    private handleRemoteTerminalInput;
    getHistory(): TerminalMessage[];
    clearHistory(): void;
    isTerminalSharing(): boolean;
    createReadOnlyTerminal(): vscode.Terminal;
    dispose(): void;
}
//# sourceMappingURL=SharedTerminalProvider.d.ts.map