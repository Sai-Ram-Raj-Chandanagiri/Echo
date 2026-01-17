import * as vscode from 'vscode';
import { getYjsService, YjsService } from '../services/YjsService';
import { getSessionService, SessionService } from '../services/SessionService';
import { CursorPosition, SelectionRange, User } from '../types';

export class CollaborativeEditingProvider implements vscode.Disposable {
  private yjsService: YjsService;
  private sessionService: SessionService;
  private disposables: vscode.Disposable[] = [];
  private isApplyingRemoteChanges = false;
  private syncedDocuments: Set<string> = new Set();

  constructor(context: vscode.ExtensionContext) {
    this.yjsService = getYjsService();
    this.sessionService = getSessionService(context);

    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen to document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.isApplyingRemoteChanges) {
          return;
        }

        const session = this.sessionService.getSession();
        if (!session) {
          return;
        }

        const fileName = event.document.uri.toString();
        if (event.contentChanges.length > 0) {
          this.yjsService.applyDocumentChange(fileName, event.contentChanges, event.document);
        }
      })
    );

    // Listen to cursor/selection changes
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        const session = this.sessionService.getSession();
        if (!session) {
          return;
        }

        const editor = event.textEditor;
        const selection = event.selections[0];

        if (selection) {
          const cursor: CursorPosition = {
            line: selection.active.line,
            character: selection.active.character,
            fileName: editor.document.uri.toString(),
          };
          this.yjsService.updateCursor(cursor);

          if (!selection.isEmpty) {
            const selectionRange: SelectionRange = {
              start: {
                line: selection.start.line,
                character: selection.start.character,
              },
              end: {
                line: selection.end.line,
                character: selection.end.character,
              },
            };
            this.yjsService.updateSelection(selectionRange);
          }
        }
      })
    );

    // Listen to active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.initializeDocument(editor.document);
        }
      })
    );

    // Listen to document open
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        const session = this.sessionService.getSession();
        if (session) {
          this.initializeDocument(document);
        }
      })
    );
  }

  initializeDocument(document: vscode.TextDocument): void {
    const fileName = document.uri.toString();

    if (this.syncedDocuments.has(fileName)) {
      return;
    }

    // Initialize Yjs text with current document content
    const content = document.getText();
    this.yjsService.initializeDocument(fileName, content);
    this.syncedDocuments.add(fileName);

    // Watch for remote changes
    this.watchRemoteChanges(document);
  }

  private watchRemoteChanges(document: vscode.TextDocument): void {
    const fileName = document.uri.toString();
    const ytext = this.yjsService.getOrCreateText(fileName);

    ytext.observe((event) => {
      if (event.transaction.local) {
        return; // Ignore local changes
      }

      this.applyRemoteChanges(document, fileName);
    });
  }

  private async applyRemoteChanges(document: vscode.TextDocument, fileName: string): Promise<void> {
    const remoteContent = this.yjsService.getRemoteChanges(fileName);
    if (remoteContent === null) {
      return;
    }

    const currentContent = document.getText();
    if (currentContent === remoteContent) {
      return;
    }

    this.isApplyingRemoteChanges = true;

    try {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(currentContent.length)
      );
      edit.replace(document.uri, fullRange, remoteContent);
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.isApplyingRemoteChanges = false;
    }
  }

  syncAllOpenDocuments(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.initializeDocument(editor.document);
    }
  }

  clearSyncedDocuments(): void {
    this.syncedDocuments.clear();
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.syncedDocuments.clear();
  }
}
