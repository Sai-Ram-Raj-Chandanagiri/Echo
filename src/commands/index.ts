import * as vscode from 'vscode';
import { getSessionService, SessionService } from '../services/SessionService';
import { getAIService, AIService } from '../services/AIService';
import { getWebRTCService, WebRTCService } from '../services/WebRTCService';
import { VoiceCommentProvider } from '../providers/VoiceCommentProvider';

export function registerCommands(
  context: vscode.ExtensionContext,
  voiceCommentProvider: VoiceCommentProvider
): vscode.Disposable[] {
  const sessionService = getSessionService(context);
  const aiService = getAIService();
  const webRTCService = getWebRTCService();

  const disposables: vscode.Disposable[] = [];

  // Start Session
  disposables.push(
    vscode.commands.registerCommand('codecollab.startSession', async () => {
      try {
        const name = await vscode.window.showInputBox({
          prompt: 'Enter session name (optional)',
          placeHolder: 'My Collaboration Session',
        });

        const session = await sessionService.createSession(name || undefined);

        const action = await vscode.window.showInformationMessage(
          `Session started! ID: ${session.id}`,
          'Copy ID'
        );

        if (action === 'Copy ID') {
          await vscode.env.clipboard.writeText(session.id);
          vscode.window.showInformationMessage('Session ID copied to clipboard!');
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to start session: ${error}`);
      }
    })
  );

  // Join Session
  disposables.push(
    vscode.commands.registerCommand('codecollab.joinSession', async () => {
      try {
        const roomId = await vscode.window.showInputBox({
          prompt: 'Enter session ID to join',
          placeHolder: 'abc-def-ghi',
          validateInput: (value) => {
            if (!value || value.trim().length < 3) {
              return 'Please enter a valid session ID';
            }
            return null;
          },
        });

        if (roomId) {
          await sessionService.joinSession(roomId.trim());
          vscode.window.showInformationMessage(`Joined session: ${roomId}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to join session: ${error}`);
      }
    })
  );

  // Leave Session
  disposables.push(
    vscode.commands.registerCommand('codecollab.leaveSession', async () => {
      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to leave the session?',
        'Leave',
        'Cancel'
      );

      if (confirm === 'Leave') {
        await sessionService.leaveSession();
        vscode.window.showInformationMessage('Left session');
      }
    })
  );

  // Copy Session ID
  disposables.push(
    vscode.commands.registerCommand('codecollab.copySessionId', async () => {
      const session = sessionService.getSession();
      if (session) {
        await vscode.env.clipboard.writeText(session.id);
        vscode.window.showInformationMessage('Session ID copied to clipboard!');
      } else {
        vscode.window.showWarningMessage('Not in a session');
      }
    })
  );

  // Follow User
  disposables.push(
    vscode.commands.registerCommand('codecollab.followUser', async () => {
      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      const participants = sessionService.getParticipants();
      const localUser = sessionService.getLocalUser();
      const otherUsers = participants.filter((p) => p.id !== localUser?.id);

      if (otherUsers.length === 0) {
        vscode.window.showInformationMessage('No other participants to follow');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        otherUsers.map((u) => ({
          label: u.name,
          description: u.permission,
          userId: u.id,
        })),
        { placeHolder: 'Select user to follow' }
      );

      if (selected) {
        vscode.window.showInformationMessage(`Following ${selected.label}`);
        // TODO: Implement actual follow functionality
      }
    })
  );

  // Unfollow User
  disposables.push(
    vscode.commands.registerCommand('codecollab.unfollowUser', async () => {
      vscode.window.showInformationMessage('Stopped following');
    })
  );

  // Record Voice Comment
  disposables.push(
    vscode.commands.registerCommand('codecollab.recordVoiceComment', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      const line = editor.selection.active.line;
      const fileName = editor.document.uri.toString();

      await voiceCommentProvider.recordVoiceComment(line, fileName);
    })
  );

  // Toggle Video
  disposables.push(
    vscode.commands.registerCommand('codecollab.toggleVideo', async (enabled?: boolean) => {
      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      if (typeof enabled === 'boolean') {
        webRTCService.toggleVideo(enabled);
      } else {
        // Toggle current state
        const config = vscode.workspace.getConfiguration('codecollab');
        const currentEnabled = config.get<boolean>('enableVideo', true);
        webRTCService.toggleVideo(!currentEnabled);
        await config.update('enableVideo', !currentEnabled, true);
      }
    })
  );

  // Toggle Audio
  disposables.push(
    vscode.commands.registerCommand('codecollab.toggleAudio', async (enabled?: boolean) => {
      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      if (typeof enabled === 'boolean') {
        webRTCService.toggleAudio(enabled);
      } else {
        // Toggle current state
        const config = vscode.workspace.getConfiguration('codecollab');
        const currentEnabled = config.get<boolean>('enableAudio', true);
        webRTCService.toggleAudio(!currentEnabled);
        await config.update('enableAudio', !currentEnabled, true);
      }
    })
  );

  // Open AI Assistant
  disposables.push(
    vscode.commands.registerCommand('codecollab.openAI', async () => {
      // Focus the CodeCollab sidebar
      await vscode.commands.executeCommand('codecollab.mainView.focus');
    })
  );

  // Share Terminal
  disposables.push(
    vscode.commands.registerCommand('codecollab.shareTerminal', async () => {
      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      vscode.window.showInformationMessage('Terminal sharing is available in the CodeCollab panel');
    })
  );

  // AI Actions (called from webview or context menu)
  disposables.push(
    vscode.commands.registerCommand('codecollab.aiExplain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Please select some code first');
        return;
      }

      const code = editor.document.getText(editor.selection);
      await showAIResponse('explain', code);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('codecollab.aiFix', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Please select some code first');
        return;
      }

      const code = editor.document.getText(editor.selection);
      await showAIResponse('fix', code);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('codecollab.aiRefactor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Please select some code first');
        return;
      }

      const code = editor.document.getText(editor.selection);
      await showAIResponse('refactor', code);
    })
  );

  // Play Voice Comment (called from hover)
  disposables.push(
    vscode.commands.registerCommand('codecollab.playVoiceComment', async (commentId: string) => {
      const comment = voiceCommentProvider.getCommentById(commentId);

      if (!comment) {
        vscode.window.showErrorMessage('Voice comment not found');
        return;
      }

      // Get audio data (may come from file storage)
      const audioData = await voiceCommentProvider.getAudioData(commentId);
      if (!audioData) {
        vscode.window.showErrorMessage('Audio data not found');
        return;
      }

      const duration = Math.ceil(comment.duration / 1000);
      const author = comment.author.name;
      const timestamp = new Date(comment.timestamp).toLocaleString();
      const audioDataUrl = `data:audio/webm;base64,${audioData}`;

      // Create a simple webview panel for playback
      const panel = vscode.window.createWebviewPanel(
        'voiceCommentPlayer',
        `🔊 Voice Comment - ${author}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
        }
      );

      panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src blob: data: mediastream: *;">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #1e1e1e;
      color: #e6e6e6;
    }
    .container {
      text-align: center;
      padding: 20px;
      max-width: 400px;
    }
    .metadata {
      margin-bottom: 30px;
      font-size: 14px;
      color: #858585;
    }
    .author {
      font-weight: bold;
      color: #00ff41;
      font-size: 16px;
      margin-bottom: 8px;
    }
    audio {
      width: 100%;
      margin: 20px 0;
      accent-color: #00ff41;
    }
    .info {
      font-size: 12px;
      margin-top: 20px;
      padding: 15px;
      background: #252526;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="metadata">
      <div class="author">🎤 ${author}</div>
      <div>${timestamp}</div>
      <div>Duration: ${duration}s</div>
    </div>

    <audio controls autoplay>
      <source src="${audioDataUrl}" type="audio/webm">
      Your browser does not support the audio element.
    </audio>

    <div class="info">
      💡 Use the player controls to play, pause, or seek through the recording.
    </div>
  </div>
</body>
</html>`;
    })
  );

  // Play Voice Comment on Current Line (right-click context menu)
  disposables.push(
    vscode.commands.registerCommand('codecollab.playVoiceCommentOnLine', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const session = sessionService.getSession();
      if (!session) {
        vscode.window.showWarningMessage('Not in a session');
        return;
      }

      const lineNumber = editor.selection.active.line;
      const fileName = editor.document.uri.toString();

      // Get all voice comments on this line
      const comments = voiceCommentProvider.getCommentsForLine(fileName, lineNumber);

      if (comments.length === 0) {
        vscode.window.showInformationMessage('No voice comments on this line');
        return;
      }

      // If only one comment, play it directly
      if (comments.length === 1) {
        await vscode.commands.executeCommand('codecollab.playVoiceComment', comments[0].id);
        return;
      }

      // If multiple comments, let user select which one to play
      const selected = await vscode.window.showQuickPick(
        comments.map((comment, index) => ({
          label: `🎤 ${comment.author.name} - ${Math.ceil(comment.duration / 1000)}s`,
          description: new Date(comment.timestamp).toLocaleString(),
          commentId: comment.id,
          index: index,
        })),
        { placeHolder: `${comments.length} voice comments on this line` }
      );

      if (selected) {
        await vscode.commands.executeCommand('codecollab.playVoiceComment', selected.commentId);
      }
    })
  );

  // Delete Voice Comment (called from hover)
  disposables.push(
    vscode.commands.registerCommand('codecollab.deleteVoiceComment', async (commentId: string) => {
      const confirm = await vscode.window.showWarningMessage(
        'Delete this voice comment?',
        'Delete',
        'Cancel'
      );

      if (confirm === 'Delete') {
        await voiceCommentProvider.removeVoiceComment(commentId);
        vscode.window.showInformationMessage('Voice comment deleted from storage');
      }
    })
  );

  return disposables;
}

async function showAIResponse(action: string, code: string): Promise<void> {
  const aiService = getAIService();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `AI ${action}ing code...`,
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        aiService.abort();
      });

      try {
        let response = '';

        await aiService.query(
          {
            prompt: '',
            codeContext: code,
            action: action as 'explain' | 'fix' | 'refactor' | 'document' | 'review',
          },
          (chunk) => {
            response += chunk;
          }
        );

        // Show response in output channel
        const outputChannel = vscode.window.createOutputChannel('CodeCollab AI');
        outputChannel.clear();
        outputChannel.appendLine(`=== AI ${action.toUpperCase()} ===\n`);
        outputChannel.appendLine(response);
        outputChannel.show();
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          vscode.window.showErrorMessage(`AI error: ${error}`);
        }
      }
    }
  );
}
