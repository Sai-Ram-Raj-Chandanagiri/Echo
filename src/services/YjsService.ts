import * as Y from 'yjs';
import * as vscode from 'vscode';
import { WebRTCService, getWebRTCService } from './WebRTCService';
import { User, CursorPosition, SelectionRange, generateId } from '../types';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';

interface AwarenessState {
  user: User;
  cursor?: CursorPosition;
  selection?: SelectionRange;
}

type CursorHandler = (userId: string, cursor: CursorPosition | null) => void;
type SelectionHandler = (userId: string, selection: SelectionRange | null) => void;

export class YjsService {
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private texts: Map<string, Y.Text> = new Map();
  private webRTCService: WebRTCService;
  private localUser: User | null = null;
  private isApplyingRemoteChanges = false;
  private pendingChanges: Map<string, vscode.TextDocumentContentChangeEvent[]> = new Map();

  private cursorHandlers: Set<CursorHandler> = new Set();
  private selectionHandlers: Set<SelectionHandler> = new Set();

  constructor() {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.webRTCService = getWebRTCService();

    this.setupWebRTCHandlers();
    this.setupAwarenessHandlers();
  }

  private setupWebRTCHandlers(): void {
    // Handle incoming Yjs updates from peers
    this.webRTCService.onData((peerId, data: unknown) => {
      const message = data as { type: string; payload: unknown };

      if (message.type === 'yjs-sync') {
        this.handleSyncMessage(message.payload as Uint8Array);
      } else if (message.type === 'yjs-update') {
        this.handleUpdateMessage(message.payload as Uint8Array);
      } else if (message.type === 'awareness') {
        this.handleAwarenessMessage(message.payload as Uint8Array);
      }
    });

    // When new peer connects, send current state
    this.webRTCService.onConnection((peerId, connected) => {
      if (connected) {
        this.sendSyncState(peerId);
      }
    });
  }

  private setupAwarenessHandlers(): void {
    this.awareness.on('change', (changes: { added: number[]; updated: number[]; removed: number[] }) => {
      // Broadcast awareness changes to peers
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        [...changes.added, ...changes.updated, ...changes.removed]
      );

      this.webRTCService.broadcast({
        type: 'awareness',
        payload: Array.from(awarenessUpdate),
      });

      // Notify cursor/selection handlers
      for (const clientId of [...changes.added, ...changes.updated]) {
        const state = this.awareness.getStates().get(clientId) as AwarenessState | undefined;
        if (state && state.user) {
          if (state.cursor) {
            this.cursorHandlers.forEach((handler) => handler(state.user.id, state.cursor!));
          }
          if (state.selection) {
            this.selectionHandlers.forEach((handler) => handler(state.user.id, state.selection!));
          }
        }
      }

      for (const clientId of changes.removed) {
        // Get the user ID from removed awareness state if possible
        // For now, we'll need to track this separately
      }
    });
  }

  setLocalUser(user: User): void {
    this.localUser = user;
    this.awareness.setLocalStateField('user', user);
  }

  getOrCreateText(fileName: string): Y.Text {
    if (!this.texts.has(fileName)) {
      const ytext = this.doc.getText(fileName);
      this.texts.set(fileName, ytext);

      // Observe changes for this text
      ytext.observe((event) => {
        if (!this.isApplyingRemoteChanges) {
          // This is a local change, broadcast it
          const update = Y.encodeStateAsUpdate(this.doc);
          this.webRTCService.broadcast({
            type: 'yjs-update',
            payload: Array.from(update),
          });
        }
      });
    }
    return this.texts.get(fileName)!;
  }

  applyDocumentChange(
    fileName: string,
    changes: readonly vscode.TextDocumentContentChangeEvent[],
    document: vscode.TextDocument
  ): void {
    if (this.isApplyingRemoteChanges) {
      return;
    }

    const ytext = this.getOrCreateText(fileName);

    this.doc.transact(() => {
      for (const change of changes) {
        const offset = change.rangeOffset;
        const deleteLength = change.rangeLength;
        const insertText = change.text;

        if (deleteLength > 0) {
          ytext.delete(offset, deleteLength);
        }
        if (insertText.length > 0) {
          ytext.insert(offset, insertText);
        }
      }
    });
  }

  getRemoteChanges(fileName: string): string | null {
    const ytext = this.texts.get(fileName);
    if (ytext) {
      return ytext.toString();
    }
    return null;
  }

  initializeDocument(fileName: string, content: string): void {
    const ytext = this.getOrCreateText(fileName);

    this.doc.transact(() => {
      // Clear existing content
      if (ytext.length > 0) {
        ytext.delete(0, ytext.length);
      }
      // Insert new content
      ytext.insert(0, content);
    });
  }

  updateCursor(cursor: CursorPosition): void {
    this.awareness.setLocalStateField('cursor', cursor);
  }

  updateSelection(selection: SelectionRange): void {
    this.awareness.setLocalStateField('selection', selection);
  }

  onCursorChange(handler: CursorHandler): void {
    this.cursorHandlers.add(handler);
  }

  offCursorChange(handler: CursorHandler): void {
    this.cursorHandlers.delete(handler);
  }

  onSelectionChange(handler: SelectionHandler): void {
    this.selectionHandlers.add(handler);
  }

  offSelectionChange(handler: SelectionHandler): void {
    this.selectionHandlers.delete(handler);
  }

  getAwarenessStates(): Map<number, AwarenessState> {
    return this.awareness.getStates() as Map<number, AwarenessState>;
  }

  getUsers(): User[] {
    const users: User[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      const awarenessState = state as AwarenessState;
      if (awarenessState.user && awarenessState.user.id !== this.localUser?.id) {
        users.push(awarenessState.user);
      }
    }
    return users;
  }

  private sendSyncState(peerId: string): void {
    // Send sync step 1 (state vector)
    const stateVector = Y.encodeStateVector(this.doc);
    this.webRTCService.sendToPeer(peerId, {
      type: 'yjs-sync',
      payload: Array.from(stateVector),
    });

    // Send full state
    const fullState = Y.encodeStateAsUpdate(this.doc);
    this.webRTCService.sendToPeer(peerId, {
      type: 'yjs-update',
      payload: Array.from(fullState),
    });

    // Send awareness state
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      Array.from(this.awareness.getStates().keys())
    );
    this.webRTCService.sendToPeer(peerId, {
      type: 'awareness',
      payload: Array.from(awarenessUpdate),
    });
  }

  private handleSyncMessage(payload: Uint8Array | number[]): void {
    const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

    // This is a state vector from a peer, send them updates they're missing
    const update = Y.encodeStateAsUpdate(this.doc, data);
    this.webRTCService.broadcast({
      type: 'yjs-update',
      payload: Array.from(update),
    });
  }

  private handleUpdateMessage(payload: Uint8Array | number[]): void {
    const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

    this.isApplyingRemoteChanges = true;
    try {
      Y.applyUpdate(this.doc, data);
    } finally {
      this.isApplyingRemoteChanges = false;
    }
  }

  private handleAwarenessMessage(payload: Uint8Array | number[]): void {
    const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    awarenessProtocol.applyAwarenessUpdate(this.awareness, data, null);
  }

  destroy(): void {
    this.awareness.destroy();
    this.doc.destroy();
    this.texts.clear();
    this.cursorHandlers.clear();
    this.selectionHandlers.clear();
  }
}

// Singleton instance
let yjsServiceInstance: YjsService | null = null;

export function getYjsService(): YjsService {
  if (!yjsServiceInstance) {
    yjsServiceInstance = new YjsService();
  }
  return yjsServiceInstance;
}

export function resetYjsService(): void {
  if (yjsServiceInstance) {
    yjsServiceInstance.destroy();
    yjsServiceInstance = null;
  }
}
