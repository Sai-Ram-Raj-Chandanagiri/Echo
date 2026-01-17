import * as vscode from 'vscode';
export declare class CollaborativeEditingProvider implements vscode.Disposable {
    private yjsService;
    private sessionService;
    private disposables;
    private isApplyingRemoteChanges;
    private syncedDocuments;
    constructor(context: vscode.ExtensionContext);
    private setupListeners;
    initializeDocument(document: vscode.TextDocument): void;
    private watchRemoteChanges;
    private applyRemoteChanges;
    syncAllOpenDocuments(): void;
    clearSyncedDocuments(): void;
    dispose(): void;
}
//# sourceMappingURL=CollaborativeEditingProvider.d.ts.map