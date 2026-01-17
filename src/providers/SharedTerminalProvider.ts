import * as vscode from 'vscode';
import { getWebRTCService, WebRTCService } from '../services/WebRTCService';
import { getSessionService, SessionService } from '../services/SessionService';
import { TerminalMessage, generateId } from '../types';

export class SharedTerminalProvider implements vscode.Disposable {
  private webRTCService: WebRTCService;
  private sessionService: SessionService;
  private sharedTerminal: vscode.Terminal | null = null;
  private terminalHistory: TerminalMessage[] = [];
  private isSharing: boolean = false;
  private writeEmitter: vscode.EventEmitter<string>;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.webRTCService = getWebRTCService();
    this.sessionService = getSessionService(context);
    this.writeEmitter = new vscode.EventEmitter<string>();

    this.setupWebRTCHandlers();
  }

  private setupWebRTCHandlers(): void {
    this.webRTCService.onData((peerId, data: unknown) => {
      const message = data as { type: string; payload: unknown };

      if (message.type === 'terminal-output') {
        const terminalMessage = message.payload as TerminalMessage;
        this.handleRemoteTerminalOutput(terminalMessage);
      } else if (message.type === 'terminal-input') {
        const terminalMessage = message.payload as TerminalMessage;
        this.handleRemoteTerminalInput(terminalMessage);
      }
    });
  }

  async startSharing(): Promise<vscode.Terminal | null> {
    const session = this.sessionService.getSession();
    const localUser = this.sessionService.getLocalUser();

    if (!session || !localUser) {
      vscode.window.showWarningMessage('You must be in a session to share terminal');
      return null;
    }

    // Only admin can share terminal for execution
    if (localUser.permission !== 'admin') {
      vscode.window.showWarningMessage('Only the session admin can share terminal for execution');
      return null;
    }

    // Create a pseudo-terminal for shared output
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.writeEmitter.event,
      open: () => {
        this.writeEmitter.fire('\x1b[32mCodeCollab Shared Terminal\x1b[0m\r\n');
        this.writeEmitter.fire('Commands executed here are visible to all participants.\r\n');
        this.writeEmitter.fire('---\r\n');
      },
      close: () => {
        this.stopSharing();
      },
      handleInput: (data: string) => {
        this.handleLocalInput(data);
      },
    };

    this.sharedTerminal = vscode.window.createTerminal({
      name: 'CodeCollab Shared',
      pty,
    });

    this.isSharing = true;
    this.sharedTerminal.show();

    // Notify peers that terminal sharing started
    this.webRTCService.broadcast({
      type: 'terminal-sharing-started',
      payload: { userId: localUser.id, userName: localUser.name },
    });

    vscode.window.showInformationMessage('Terminal sharing started');
    return this.sharedTerminal;
  }

  stopSharing(): void {
    if (this.sharedTerminal) {
      this.sharedTerminal.dispose();
      this.sharedTerminal = null;
    }
    this.isSharing = false;
    this.terminalHistory = [];

    const localUser = this.sessionService.getLocalUser();
    if (localUser) {
      this.webRTCService.broadcast({
        type: 'terminal-sharing-stopped',
        payload: { userId: localUser.id },
      });
    }
  }

  private handleLocalInput(data: string): void {
    if (!this.isSharing) {
      return;
    }

    const localUser = this.sessionService.getLocalUser();
    if (!localUser) {
      return;
    }

    // Echo input locally
    if (data === '\r') {
      this.writeEmitter.fire('\r\n');
    } else if (data === '\x7f') {
      // Backspace
      this.writeEmitter.fire('\b \b');
    } else {
      this.writeEmitter.fire(data);
    }

    // Create terminal message
    const message: TerminalMessage = {
      type: 'input',
      data,
      timestamp: Date.now(),
      userId: localUser.id,
    };

    this.terminalHistory.push(message);

    // Broadcast to peers
    this.webRTCService.broadcast({
      type: 'terminal-input',
      payload: message,
    });

    // Execute command when Enter is pressed
    if (data === '\r') {
      this.executeCommand();
    }
  }

  private currentCommand: string = '';

  private executeCommand(): void {
    // In a real implementation, you would execute the command
    // For security, this is simplified to just echo back
    // Full implementation would use node-pty or similar

    // Simulate command execution
    const output = `\x1b[33m[Executed by ${this.sessionService.getLocalUser()?.name}]\x1b[0m\r\n`;
    this.writeEmitter.fire(output);

    const message: TerminalMessage = {
      type: 'output',
      data: output,
      timestamp: Date.now(),
      userId: this.sessionService.getLocalUser()?.id || '',
    };

    this.terminalHistory.push(message);
    this.webRTCService.broadcast({
      type: 'terminal-output',
      payload: message,
    });

    // Show prompt
    this.writeEmitter.fire('$ ');
    this.currentCommand = '';
  }

  private handleRemoteTerminalOutput(message: TerminalMessage): void {
    this.terminalHistory.push(message);

    // If we have a shared terminal view, write to it
    if (this.sharedTerminal) {
      this.writeEmitter.fire(message.data);
    }
  }

  private handleRemoteTerminalInput(message: TerminalMessage): void {
    this.terminalHistory.push(message);

    // Display remote input in our terminal
    if (this.sharedTerminal) {
      if (message.data === '\r') {
        this.writeEmitter.fire('\r\n');
      } else if (message.data === '\x7f') {
        this.writeEmitter.fire('\b \b');
      } else {
        this.writeEmitter.fire(message.data);
      }
    }
  }

  getHistory(): TerminalMessage[] {
    return [...this.terminalHistory];
  }

  clearHistory(): void {
    this.terminalHistory = [];
  }

  isTerminalSharing(): boolean {
    return this.isSharing;
  }

  // Create a read-only terminal view for non-admin users
  createReadOnlyTerminal(): vscode.Terminal {
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.writeEmitter.event,
      open: () => {
        this.writeEmitter.fire('\x1b[32mCodeCollab Shared Terminal (Read-Only)\x1b[0m\r\n');
        this.writeEmitter.fire('You can view terminal output but cannot execute commands.\r\n');
        this.writeEmitter.fire('---\r\n');

        // Replay history
        for (const msg of this.terminalHistory) {
          this.writeEmitter.fire(msg.data);
        }
      },
      close: () => {},
      handleInput: () => {
        // Ignore input for read-only terminal
        this.writeEmitter.fire('\r\n\x1b[31mRead-only mode: Commands disabled\x1b[0m\r\n');
      },
    };

    const terminal = vscode.window.createTerminal({
      name: 'CodeCollab Terminal (View)',
      pty,
    });

    return terminal;
  }

  dispose(): void {
    this.stopSharing();
    this.writeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
