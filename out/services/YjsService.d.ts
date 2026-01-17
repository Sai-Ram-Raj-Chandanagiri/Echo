import * as Y from 'yjs';
import * as vscode from 'vscode';
import { User, CursorPosition, SelectionRange } from '../types';
interface AwarenessState {
    user: User;
    cursor?: CursorPosition;
    selection?: SelectionRange;
}
type CursorHandler = (userId: string, cursor: CursorPosition | null) => void;
type SelectionHandler = (userId: string, selection: SelectionRange | null) => void;
export declare class YjsService {
    private doc;
    private awareness;
    private texts;
    private webRTCService;
    private localUser;
    private isApplyingRemoteChanges;
    private pendingChanges;
    private cursorHandlers;
    private selectionHandlers;
    constructor();
    private setupWebRTCHandlers;
    private setupAwarenessHandlers;
    setLocalUser(user: User): void;
    getOrCreateText(fileName: string): Y.Text;
    applyDocumentChange(fileName: string, changes: readonly vscode.TextDocumentContentChangeEvent[], document: vscode.TextDocument): void;
    getRemoteChanges(fileName: string): string | null;
    initializeDocument(fileName: string, content: string): void;
    updateCursor(cursor: CursorPosition): void;
    updateSelection(selection: SelectionRange): void;
    onCursorChange(handler: CursorHandler): void;
    offCursorChange(handler: CursorHandler): void;
    onSelectionChange(handler: SelectionHandler): void;
    offSelectionChange(handler: SelectionHandler): void;
    getAwarenessStates(): Map<number, AwarenessState>;
    getUsers(): User[];
    private sendSyncState;
    private handleSyncMessage;
    private handleUpdateMessage;
    private handleAwarenessMessage;
    destroy(): void;
}
export declare function getYjsService(): YjsService;
export declare function resetYjsService(): void;
export {};
//# sourceMappingURL=YjsService.d.ts.map