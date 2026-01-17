# Echo CodeCollab - Real-Time Collaborative Coding for VS Code

Real-time collaborative coding with video, voice comments, and AI assistance - all within VS Code.

## Features

### Real-Time Collaborative Editing
- **Multi-cursor support**: See where collaborators are typing in real-time
- **Live presence indicators**: Know who's online and what they're editing
- **Follow mode**: Jump to a collaborator's cursor position
- **Conflict-free editing**: Yjs CRDT ensures no merge conflicts

### Video & Audio Communication
- **Built-in video conferencing**: WebRTC-based peer-to-peer communication
- **Toggle controls**: Mute/unmute audio, enable/disable video
- **Support for 2-8 participants**: Mesh topology for small team collaboration

### Voice Comments on Code ⭐ NEW
- **Line-level audio annotations**: Record voice notes on any line of code
- **Persistent storage**: Voice comments saved to disk and survive VS Code restarts
- **Workspace-scoped**: Each workspace has its own voice comment storage
- **Right-click playback**: Easy discovery and playback via context menu
- **Visual indicators**: Speaker icons (🔊) in the gutter show commented lines
- **Multiple comments per line**: Support for multiple recordings on the same line with quick selection
- **Auto-load on startup**: Comments automatically load from storage when you open a workspace

### AI-Powered Assistance
- **Local LLM via Ollama**: Free, privacy-preserving AI (CodeLlama, DeepSeek Coder, Mistral)
- **Code actions**: Explain, Fix, Refactor, Document, Review
- **Chat interface**: Ask coding questions in the sidebar

### Shared Terminal
- **Synchronized terminal view**: See command output together
- **Permission control**: Only admin can execute commands
- **Read-only mode**: Non-admin users can view but not execute

## Requirements

- VS Code 1.85.0 or higher
- Node.js 18+ (for signaling server)
- [Ollama](https://ollama.com/) (optional, for AI features)

## Quick Start

### 1. Install the Extension

From VS Code Marketplace (coming soon), or build from source:

```bash
cd codecollab-extension
npm install
npm run compile
```

Press F5 to launch Extension Development Host.

### 2. Start the Signaling Server

```bash
cd server
npm install
npm run dev
```

Server runs on `http://localhost:3001`.

### 3. Start a Session

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run "CodeCollab: Start Collaboration Session"
3. Copy the session ID and share with collaborators

### 4. Join a Session

1. Open Command Palette
2. Run "CodeCollab: Join Collaboration Session"
3. Enter the session ID

## Using Voice Comments

### Recording a Voice Comment

1. **Place cursor on any line** of code
2. **Press `Ctrl+Shift+V`** (Windows/Linux) or `Cmd+Shift+V` (Mac)
3. **Confirmation dialog appears** - Click OK
4. **Your default browser opens** with a recording interface
5. **Click "Start Recording"** and speak your comment
6. **Click "Stop & Save"** when done
7. **Browser auto-closes** and comment is saved
8. **Speaker icon 🔊 appears** in the gutter at that line

### Playing a Voice Comment

**Method 1: Right-Click Context Menu (Recommended)** ⭐

1. **Right-click on a line** with a speaker icon (or anywhere on that line)
2. **Click "Play Voice Comment"** from the context menu
3. **Audio player opens** in a side panel:
   - If one comment: plays automatically
   - If multiple comments: quick pick dropdown to select which one to play
   - If no comments: shows message "No voice comments on this line"
4. **Use player controls** to play, pause, seek, and adjust volume

**Method 2: Hover Over Speaker Icon**

1. **Hover over the speaker icon 🔊** in the gutter
2. **Hover popup appears** showing:
   - Comment author name
   - Recording timestamp
   - Duration in seconds
   - Play and Delete buttons
3. **Click "Play"** to open the audio player

### Deleting a Voice Comment

1. **Right-click on line** with the comment
2. **Click "Play Voice Comment"** (or hover over the speaker icon)
3. **In the audio player or hover popup, click "Delete"**
4. **Confirm deletion** in the dialog

### Storage Location

Voice comments are stored persistently in your VS Code user data directory:

```
~/.vscode/extensions/codecollab/voice-comments/
  └── {workspace-hash}/           # Unique per workspace
      ├── index.json              # Metadata for all comments
      └── audio/
          ├── {comment-id}.webm   # Individual audio files
          └── ...
```

Each workspace has its own isolated storage, so switching workspaces won't mix up your comments.

## Keyboard Shortcuts

| Command | Windows/Linux | Mac |
|---------|--------------|-----|
| Start Session | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Join Session | `Ctrl+Shift+J` | `Cmd+Shift+J` |
| Leave Session | `Ctrl+Shift+L` | `Cmd+Shift+L` |
| Record Voice Comment | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Open AI Assistant | `Ctrl+Shift+A` | `Cmd+Shift+A` |

## Configuration

Configure CodeCollab in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `codecollab.signalingServer` | `ws://localhost:3001` | Signaling server URL |
| `codecollab.ollamaUrl` | `http://localhost:11434` | Ollama API URL |
| `codecollab.defaultModel` | `codellama:7b` | Default AI model |
| `codecollab.enableVideo` | `true` | Enable video by default |
| `codecollab.enableAudio` | `true` | Enable audio by default |
| `codecollab.userName` | `` | Your display name |
| `codecollab.showCursorNames` | `true` | Show names next to cursors |

## AI Setup (Optional)

For AI features, install Ollama:

```bash
# Linux/Mac
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull codellama:7b

# Start Ollama
ollama serve
```

## Architecture

```
┌─────────────────────────────────────┐
│           VS Code Extension          │
│  ┌─────────────────────────────────┐│
│  │  Collaborative Editing (Yjs)    ││
│  ├─────────────────────────────────┤│
│  │  Video/Audio (WebRTC)           ││
│  ├─────────────────────────────────┤│
│  │  Voice Comments (File Storage)  ││
│  ├─────────────────────────────────┤│
│  │  AI Assistant (Ollama)          ││
│  └─────────────────────────────────┘│
└───────────────┬─────────────────────┘
                │ WebSocket
       ┌────────┴────────┐
       │ Signaling Server │
       └────────┬────────┘
                │
    ┌───────────┴───────────┐
    │   WebRTC P2P Mesh     │
    │  (Data + Media)       │
    └───────────────────────┘
```

### Voice Comments Storage Architecture

- **Local File Storage**: WebM audio files stored in VS Code's global storage
- **Per-Workspace Index**: `index.json` maintains metadata (author, timestamp, duration, line number)
- **Persistent**: Comments survive VS Code restarts and sessions
- **Workspace-Isolated**: Each workspace has independent comment storage

## Technology Stack

- **VS Code Extension API** - Editor integration
- **Yjs** - CRDT for collaborative editing
- **WebRTC** - Peer-to-peer communication
- **Socket.io** - WebSocket signaling
- **Ollama** - Local LLM inference
- **File System API** - Persistent voice comment storage

## Security Considerations

- All communication is peer-to-peer (no data passes through server)
- Terminal execution restricted to admin only
- Session IDs are randomly generated
- WebRTC uses DTLS-SRTP encryption
- Voice comments stored locally on your machine only
- No cloud services or external APIs for voice storage

## Limitations

- Maximum 8 participants (mesh topology)
- May not work on restrictive networks (no TURN server)
- Ollama required for AI features (runs locally)
- Voice comments are workspace-specific (not shared between workspaces)

## Troubleshooting

### Voice Comment Recording

**Browser doesn't open when recording:**
- Ensure your default browser is configured in OS settings
- Try recording again
- Check VS Code logs: View → Output → CodeCollab

**"Permission denied" when recording:**
- Grant microphone permission in your browser settings
- Allow `localhost` to access your microphone
- On Mac: Check System Preferences → Security & Privacy → Microphone

**Recording saves but no speaker icon appears:**
- Make sure you're in an active session
- Verify the file is saved (and wasn't auto-reverted)
- Close and reopen the file
- Reload VS Code

### Voice Comment Playback

**"Voice comment not found" error:**
- The audio file may have been deleted manually
- Try closing and reopening the workspace
- Check storage folder exists at: `~/.vscode/extensions/codecollab/voice-comments/`

**Audio player shows but no sound plays:**
- Check your system volume is not muted
- Check VS Code volume is not muted
- Try a different browser if you need to re-record
- Verify microphone/speakers are working with another app

## Development

```bash
# Extension
cd codecollab-extension
npm install
npm run watch  # Watch mode
# Press F5 to debug

# Server
cd server
npm install
npm run dev
```

## Useful Commands for Development

```bash
# Compile extension
npm run compile

# Clean build
npm run clean && npm run compile

# Package as .vsix
vsce package

# Clear voice comment storage (for testing)
# On Mac/Linux: rm -rf ~/.vscode/extensions/codecollab/voice-comments/
# On Windows: rmdir /s "%USERPROFILE%\.vscode\extensions\codecollab\voice-comments\"
```

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines first.

## Roadmap

- [ ] Cloud storage for voice comments (optional sync)
- [ ] Voice comment search/filtering
- [ ] Export voice comments as audio files
- [ ] Transcription of voice comments to text
- [ ] Voice comment reply threads
- [ ] SFU mode for 10+ participants
- [ ] TURN server support for restrictive networks
