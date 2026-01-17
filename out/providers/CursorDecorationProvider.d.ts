import * as vscode from 'vscode';
export declare class CursorDecorationProvider implements vscode.Disposable {
    private yjsService;
    private sessionService;
    private decorations;
    private cursorPositions;
    private selections;
    private users;
    private disposables;
    private updateTimeout;
    constructor(context: vscode.ExtensionContext);
    private setupListeners;
    private createDecorationsForUser;
    private removeDecorationsForUser;
    private scheduleUpdate;
    private updateDecorations;
    private getAwarenessUser;
    refreshDecorations(): void;
    clearAllDecorations(): void;
    dispose(): void;
}
//# sourceMappingURL=CursorDecorationProvider.d.ts.map