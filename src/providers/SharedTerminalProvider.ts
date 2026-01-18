import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
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
  private currentCommand: string = '';
  private workingDirectory: string;
  private isExecuting: boolean = false;
  private commandHistory: string[] = [];
  private historyIndex: number = -1;

  constructor(context: vscode.ExtensionContext) {
    this.webRTCService = getWebRTCService();
    this.sessionService = getSessionService(context);
    this.writeEmitter = new vscode.EventEmitter<string>();

    // Initialize working directory to the first workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    this.workingDirectory = workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri.fsPath
      : process.cwd();

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
        const userName = localUser?.name || 'Unknown User';
        this.writeEmitter.fire('\x1b[32mCodeCollab Shared Terminal\x1b[0m\r\n');
        this.writeEmitter.fire(`\x1b[33mUser: ${userName}\x1b[0m\r\n`);
        this.writeEmitter.fire('Commands executed here are visible to all participants.\r\n');
        this.writeEmitter.fire(`\x1b[36mWorking Directory: ${this.workingDirectory}\x1b[0m\r\n`);
        this.writeEmitter.fire('Type "help" for available commands or start typing shell commands.\r\n');
        this.writeEmitter.fire('---\r\n');
        this.showPrompt();
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
      payload: {
        userId: localUser.id,
        userName: localUser.name,
        workingDirectory: this.workingDirectory,
        timestamp: Date.now(),
      },
    });

    vscode.window.showInformationMessage(`Terminal sharing started by ${localUser.name}`);
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
    if (!this.isSharing || this.isExecuting) {
      return;
    }

    const localUser = this.sessionService.getLocalUser();
    if (!localUser) {
      return;
    }

    // Handle different input types
    if (data === '\r') {
      // Enter key - execute command
      this.writeEmitter.fire('\r\n');

      // Add to history if not empty and different from last command
      if (this.currentCommand.trim() &&
          this.commandHistory[this.commandHistory.length - 1] !== this.currentCommand) {
        this.commandHistory.push(this.currentCommand);
      }
      this.historyIndex = -1;

      // Create terminal message for input with username
      const inputPrefix = `\x1b[33m[${localUser.name}]\x1b[0m `;
      const message: TerminalMessage = {
        type: 'input',
        data: inputPrefix + this.currentCommand + '\r\n',
        timestamp: Date.now(),
        userId: localUser.id,
      };
      this.terminalHistory.push(message);

      // Broadcast the command to peers with username
      this.webRTCService.broadcast({
        type: 'terminal-input',
        payload: message,
      });

      this.executeCommand();
    } else if (data === '\x7f' || data === '\x08') {
      // Backspace or delete
      if (this.currentCommand.length > 0) {
        this.currentCommand = this.currentCommand.slice(0, -1);
        this.writeEmitter.fire('\b \b');
      }
    } else if (data === '\x03') {
      // Ctrl+C - terminate current process (if any)
      this.writeEmitter.fire('^C\r\n');
      this.showPrompt();
      this.currentCommand = '';
    } else if (data === '\x1b[A' || data.includes('\x1b[A')) {
      // Arrow up - show previous command
      this.showPreviousCommand();
    } else if (data === '\x1b[B' || data.includes('\x1b[B')) {
      // Arrow down - show next command
      this.showNextCommand();
    } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      // Regular printable character
      this.currentCommand += data;
      this.writeEmitter.fire(data);
      this.historyIndex = -1; // Reset history when typing new command
    } else if (data === '\t') {
      // Tab key - simple tab completion or just insert spaces
      const spaces = '  ';
      this.currentCommand += spaces;
      this.writeEmitter.fire(spaces);
    }
  }

  private executeCommand(): void {
    const command = this.currentCommand.trim();

    if (!command) {
      this.showPrompt();
      return;
    }

    // Handle built-in commands
    if (command === 'help') {
      this.showHelpMessage();
      this.showPrompt();
      this.currentCommand = '';
      return;
    }

    if (command.startsWith('cd ')) {
      this.handleCdCommand(command);
      this.showPrompt();
      this.currentCommand = '';
      return;
    }

    if (command === 'pwd') {
      const pwdOutput = `${this.workingDirectory}\r\n`;
      this.writeEmitter.fire(pwdOutput);
      this.broadcastOutput(pwdOutput);
      this.showPrompt();
      this.currentCommand = '';
      return;
    }

    if (command === 'clear') {
      this.writeEmitter.fire('\x1b[2J\x1b[0f');
      this.showPrompt();
      this.currentCommand = '';
      return;
    }

    // Execute real shell command
    this.isExecuting = true;
    this.executeShellCommand(command);
  }

  private executeShellCommand(command: string): void {
    const localUser = this.sessionService.getLocalUser();
    if (!localUser) {
      return;
    }

    // Determine shell based on platform
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    try {
      const process = spawn(shell, shellArgs, {
        cwd: this.workingDirectory,
        shell: true,
      });

      // Collect output
      let output = '';

      process.stdout?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        this.writeEmitter.fire(chunk);
      });

      process.stderr?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        // Display stderr in red
        this.writeEmitter.fire(`\x1b[31m${chunk}\x1b[0m`);
      });

      process.on('close', (code) => {
        this.isExecuting = false;

        // Broadcast the output to peers
        if (output) {
          this.broadcastOutput(output);
        }

        // Show exit code if non-zero
        if (code !== 0) {
          const exitMsg = `\x1b[33mProcess exited with code ${code}\x1b[0m\r\n`;
          this.writeEmitter.fire(exitMsg);
          this.broadcastOutput(exitMsg);
        }

        this.showPrompt();
        this.currentCommand = '';
      });

      process.on('error', (err) => {
        this.isExecuting = false;
        const errorMsg = `\x1b[31mError executing command: ${err.message}\x1b[0m\r\n`;
        this.writeEmitter.fire(errorMsg);
        this.broadcastOutput(errorMsg);
        this.showPrompt();
        this.currentCommand = '';
      });
    } catch (err) {
      this.isExecuting = false;
      const errorMsg = `\x1b[31mFailed to execute command: ${err instanceof Error ? err.message : 'Unknown error'}\x1b[0m\r\n`;
      this.writeEmitter.fire(errorMsg);
      this.broadcastOutput(errorMsg);
      this.showPrompt();
      this.currentCommand = '';
    }
  }

  private handleCdCommand(command: string): void {
    const targetDir = command.substring(3).trim();

    if (!targetDir) {
      // cd without arguments goes to home directory
      this.workingDirectory = process.env.HOME || process.cwd();
      return;
    }

    // Handle absolute and relative paths
    const resolvedPath = path.isAbsolute(targetDir)
      ? targetDir
      : path.join(this.workingDirectory, targetDir);

    try {
      // Validate directory exists by checking if it's accessible
      const fs = require('fs');
      const stats = fs.statSync(resolvedPath);
      if (stats.isDirectory()) {
        this.workingDirectory = resolvedPath;
        const cdOutput = `\x1b[36mChanged directory to: ${this.workingDirectory}\x1b[0m\r\n`;
        this.writeEmitter.fire(cdOutput);
        this.broadcastOutput(cdOutput);
      } else {
        const errorMsg = `\x1b[31mNot a directory: ${targetDir}\x1b[0m\r\n`;
        this.writeEmitter.fire(errorMsg);
        this.broadcastOutput(errorMsg);
      }
    } catch (err) {
      const errorMsg = `\x1b[31mNo such directory: ${targetDir}\x1b[0m\r\n`;
      this.writeEmitter.fire(errorMsg);
      this.broadcastOutput(errorMsg);
    }
  }

  private showHelpMessage(): void {
    const localUser = this.sessionService.getLocalUser();
    const userName = localUser?.name || 'user';
    const help = `
\x1b[32mCodeCollab Terminal Commands (${userName}):\x1b[0m
  pwd                - Print working directory
  cd <path>          - Change directory
  clear              - Clear terminal screen
  help               - Show this help message

Any other command will be executed in the shell.
Examples: npm install, node script.js, python app.py, npm test, etc.
\r\n`;
    this.writeEmitter.fire(help);
    this.broadcastOutput(help);
  }

  private showPrompt(): void {
    const localUser = this.sessionService.getLocalUser();
    const userName = localUser?.name || 'user';
    const prompt = `\x1b[36m${userName}@${this.workingDirectory}$\x1b[0m `;
    this.writeEmitter.fire(prompt);
  }

  private broadcastOutput(output: string): void {
    const localUser = this.sessionService.getLocalUser();
    if (!localUser) {
      return;
    }

    // Add username prefix to output for clarity in multi-user scenario
    const userPrefix = `\x1b[33m[${localUser.name}]\x1b[0m `;
    const enrichedOutput = userPrefix + output;

    const message: TerminalMessage = {
      type: 'output',
      data: enrichedOutput,
      timestamp: Date.now(),
      userId: localUser.id,
    };

    this.terminalHistory.push(message);
    this.webRTCService.broadcast({
      type: 'terminal-output',
      payload: message,
    });
  }

  private showPreviousCommand(): void {
    if (this.commandHistory.length === 0) {
      return;
    }

    if (this.historyIndex === -1) {
      this.historyIndex = this.commandHistory.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      return; // Already at the beginning
    }

    this.replaceCurrentCommand(this.commandHistory[this.historyIndex]);
  }

  private showNextCommand(): void {
    if (this.commandHistory.length === 0) {
      return;
    }

    if (this.historyIndex === -1) {
      return; // Nothing to go forward to
    }

    if (this.historyIndex < this.commandHistory.length - 1) {
      this.historyIndex++;
      this.replaceCurrentCommand(this.commandHistory[this.historyIndex]);
    } else {
      this.historyIndex = -1;
      this.replaceCurrentCommand('');
    }
  }

  private replaceCurrentCommand(newCommand: string): void {
    // Clear the current command from display
    for (let i = 0; i < this.currentCommand.length; i++) {
      this.writeEmitter.fire('\b \b');
    }

    // Set new command
    this.currentCommand = newCommand;

    // Display new command
    this.writeEmitter.fire(newCommand);
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
