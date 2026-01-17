import * as vscode from 'vscode';
import { CollabPanel } from './panels/CollabPanel';
import { CollaborativeEditingProvider } from './providers/CollaborativeEditingProvider';
import { CursorDecorationProvider } from './providers/CursorDecorationProvider';
import { VoiceCommentProvider } from './providers/VoiceCommentProvider';
import { SharedTerminalProvider } from './providers/SharedTerminalProvider';
import { registerCommands } from './commands';
import {
  getSessionService,
  resetSessionService,
  resetSignalingService,
  resetWebRTCService,
  resetYjsService,
  resetAIService,
  resetMediaCaptureServer,
  getVoiceCommentStorage,
  resetVoiceCommentStorage,
} from './services';

let collaborativeEditingProvider: CollaborativeEditingProvider | undefined;
let cursorDecorationProvider: CursorDecorationProvider | undefined;
let voiceCommentProvider: VoiceCommentProvider | undefined;
let sharedTerminalProvider: SharedTerminalProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeCollab extension is now active!');

  // Initialize session service first (required by other services)
  getSessionService(context);

  // Initialize voice comment storage (for persistent voice comments)
  getVoiceCommentStorage(context);

  // Initialize providers
  collaborativeEditingProvider = new CollaborativeEditingProvider(context);
  cursorDecorationProvider = new CursorDecorationProvider(context);
  voiceCommentProvider = new VoiceCommentProvider(context);
  sharedTerminalProvider = new SharedTerminalProvider(context);

  // Register the webview provider for the sidebar
  const collabPanelProvider = new CollabPanel(context.extensionUri, context, sharedTerminalProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CollabPanel.viewType, collabPanelProvider)
  );

  // Connect VoiceCommentProvider to CollabPanel for voice recording via webview
  voiceCommentProvider.setCollabPanel(collabPanelProvider);

  // Register commands
  const commandDisposables = registerCommands(context, voiceCommentProvider);
  context.subscriptions.push(...commandDisposables);

  // Register providers
  context.subscriptions.push(collaborativeEditingProvider);
  context.subscriptions.push(cursorDecorationProvider);
  context.subscriptions.push(voiceCommentProvider);
  context.subscriptions.push(sharedTerminalProvider);

  // Set initial context values
  vscode.commands.executeCommand('setContext', 'codecollab.inSession', false);
  vscode.commands.executeCommand('setContext', 'codecollab.isHost', false);

  // Listen for session changes to sync documents
  const sessionService = getSessionService(context);
  sessionService.onSessionChange((session) => {
    if (session) {
      // Sync all open documents when joining a session
      collaborativeEditingProvider?.syncAllOpenDocuments();
    } else {
      // Clear synced documents when leaving
      collaborativeEditingProvider?.clearSyncedDocuments();
      cursorDecorationProvider?.clearAllDecorations();
      voiceCommentProvider?.clearAllComments();
    }
  });

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get<boolean>('hasShownWelcome', false);
  if (!hasShownWelcome) {
    showWelcomeMessage(context);
  }

  // Register status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codecollab.startSession';
  statusBarItem.text = '$(broadcast) CodeCollab';
  statusBarItem.tooltip = 'Start a collaboration session';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar based on session state
  sessionService.onSessionChange((session) => {
    if (session) {
      statusBarItem.text = `$(broadcast) ${session.id}`;
      statusBarItem.tooltip = `In session: ${session.name}\nClick to copy session ID`;
      statusBarItem.command = 'codecollab.copySessionId';
    } else {
      statusBarItem.text = '$(broadcast) CodeCollab';
      statusBarItem.tooltip = 'Start a collaboration session';
      statusBarItem.command = 'codecollab.startSession';
    }
  });

  console.log('CodeCollab extension activated successfully');
}

export function deactivate() {
  console.log('CodeCollab extension is being deactivated');

  // Clean up all services
  resetSessionService();
  resetWebRTCService();
  resetSignalingService();
  resetYjsService();
  resetAIService();
  resetMediaCaptureServer();
  resetVoiceCommentStorage();

  // Dispose providers
  collaborativeEditingProvider?.dispose();
  cursorDecorationProvider?.dispose();
  voiceCommentProvider?.dispose();
  sharedTerminalProvider?.dispose();

  console.log('CodeCollab extension deactivated');
}

async function showWelcomeMessage(context: vscode.ExtensionContext): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    'Welcome to CodeCollab! Real-time collaborative coding with video, voice comments, and AI assistance.',
    'Get Started',
    'Don\'t show again'
  );

  if (action === 'Get Started') {
    // Open the CodeCollab sidebar
    await vscode.commands.executeCommand('codecollab.mainView.focus');
  }

  if (action === 'Don\'t show again') {
    await context.globalState.update('hasShownWelcome', true);
  }
}
