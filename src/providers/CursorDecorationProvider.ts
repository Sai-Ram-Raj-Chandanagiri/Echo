import * as vscode from 'vscode';
import { getYjsService, YjsService } from '../services/YjsService';
import { getSessionService, SessionService } from '../services/SessionService';
import { CursorPosition, SelectionRange, User } from '../types';

interface UserDecoration {
  cursorDecoration: vscode.TextEditorDecorationType;
  selectionDecoration: vscode.TextEditorDecorationType;
  nameDecoration: vscode.TextEditorDecorationType;
}

export class CursorDecorationProvider implements vscode.Disposable {
  private yjsService: YjsService;
  private sessionService: SessionService;
  private decorations: Map<string, UserDecoration> = new Map();
  private cursorPositions: Map<string, CursorPosition> = new Map();
  private selections: Map<string, SelectionRange> = new Map();
  private users: Map<string, User> = new Map();
  private disposables: vscode.Disposable[] = [];
  private updateTimeout: NodeJS.Timeout | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.yjsService = getYjsService();
    this.sessionService = getSessionService(context);

    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen to cursor changes from Yjs
    this.yjsService.onCursorChange((userId, cursor) => {
      if (cursor) {
        this.cursorPositions.set(userId, cursor);
      } else {
        this.cursorPositions.delete(userId);
      }
      this.scheduleUpdate();
    });

    // Listen to selection changes from Yjs
    this.yjsService.onSelectionChange((userId, selection) => {
      if (selection) {
        this.selections.set(userId, selection);
      } else {
        this.selections.delete(userId);
      }
      this.scheduleUpdate();
    });

    // Listen to user join/leave
    this.sessionService.onUserJoined((user) => {
      this.users.set(user.id, user);
      this.createDecorationsForUser(user);
    });

    this.sessionService.onUserLeft((user) => {
      this.users.delete(user.id);
      this.cursorPositions.delete(user.id);
      this.selections.delete(user.id);
      this.removeDecorationsForUser(user.id);
    });

    // Update on editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateDecorations();
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.updateDecorations();
      })
    );
  }

  private createDecorationsForUser(user: User): void {
    const config = vscode.workspace.getConfiguration('codecollab');
    const showNames = config.get<boolean>('showCursorNames', true);
    const cursorStyle = config.get<string>('cursorStyle', 'line');

    // Cursor decoration
    const cursorDecoration = vscode.window.createTextEditorDecorationType({
      borderWidth: cursorStyle === 'line' ? '0 0 0 2px' : '2px',
      borderStyle: 'solid',
      borderColor: user.color,
      ...(cursorStyle === 'block' && { backgroundColor: `${user.color}40` }),
    });

    // Selection decoration
    const selectionDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: user.colorLight,
      borderRadius: '2px',
    });

    // Name decoration (shown above cursor)
    const nameDecoration = vscode.window.createTextEditorDecorationType({
      after: showNames
        ? {
            contentText: ` ${user.name}`,
            color: user.color,
            fontWeight: 'bold',
            // fontSize: '11px',
            margin: '0 0 0 4px',
            textDecoration: 'none; position: relative; top: -1.2em; background-color: var(--vscode-editor-background); padding: 1px 4px; border-radius: 3px;',
          }
        : undefined,
    });

    this.decorations.set(user.id, {
      cursorDecoration,
      selectionDecoration,
      nameDecoration,
    });
  }

  private removeDecorationsForUser(userId: string): void {
    const decorations = this.decorations.get(userId);
    if (decorations) {
      decorations.cursorDecoration.dispose();
      decorations.selectionDecoration.dispose();
      decorations.nameDecoration.dispose();
      this.decorations.delete(userId);
    }
    this.updateDecorations();
  }

  private scheduleUpdate(): void {
    // Debounce updates for performance
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = setTimeout(() => {
      this.updateDecorations();
      this.updateTimeout = null;
    }, 50);
  }

  private updateDecorations(): void {
    const editors = vscode.window.visibleTextEditors;

    for (const editor of editors) {
      const documentUri = editor.document.uri.toString();

      for (const [userId, cursor] of this.cursorPositions) {
        if (cursor.fileName !== documentUri) {
          continue;
        }

        const user = this.users.get(userId);
        const decorations = this.decorations.get(userId);

        if (!user || !decorations) {
          // Create decorations if user exists but decorations don't
          const awarenessUser = this.getAwarenessUser(userId);
          if (awarenessUser && !decorations) {
            this.users.set(userId, awarenessUser);
            this.createDecorationsForUser(awarenessUser);
          }
          continue;
        }

        // Apply cursor decoration
        const cursorPosition = new vscode.Position(cursor.line, cursor.character);
        const cursorRange = new vscode.Range(cursorPosition, cursorPosition);
        editor.setDecorations(decorations.cursorDecoration, [cursorRange]);
        editor.setDecorations(decorations.nameDecoration, [cursorRange]);

        // Apply selection decoration if exists
        const selection = this.selections.get(userId);
        if (selection) {
          const selectionRange = new vscode.Range(
            new vscode.Position(selection.start.line, selection.start.character),
            new vscode.Position(selection.end.line, selection.end.character)
          );
          editor.setDecorations(decorations.selectionDecoration, [selectionRange]);
        } else {
          editor.setDecorations(decorations.selectionDecoration, []);
        }
      }
    }
  }

  private getAwarenessUser(userId: string): User | null {
    const states = this.yjsService.getAwarenessStates();
    for (const [clientId, state] of states) {
      if (state.user && state.user.id === userId) {
        return state.user;
      }
    }
    return null;
  }

  refreshDecorations(): void {
    // Re-create decorations for all users
    for (const [userId, user] of this.users) {
      this.removeDecorationsForUser(userId);
      this.createDecorationsForUser(user);
    }
    this.updateDecorations();
  }

  clearAllDecorations(): void {
    for (const [userId, decorations] of this.decorations) {
      decorations.cursorDecoration.dispose();
      decorations.selectionDecoration.dispose();
      decorations.nameDecoration.dispose();
    }
    this.decorations.clear();
    this.cursorPositions.clear();
    this.selections.clear();
    this.users.clear();
  }

  dispose(): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.clearAllDecorations();
    this.disposables.forEach((d) => d.dispose());
  }
}
