import * as http from 'http';
import * as vscode from 'vscode';

/**
 * MediaCaptureServer - Local HTTP server for capturing audio/video in browser
 *
 * VS Code webviews run in sandboxed iframes without getUserMedia permissions.
 * This server provides a workaround by:
 * 1. Serving an HTML page that opens in the user's default browser
 * 2. The browser page has full media permissions
 * 3. Recorded audio is sent back to the extension via HTTP POST
 */

type RecordingCallback = (audioData: string, duration: number) => void;
type RecordingErrorCallback = (error: string) => void;

interface PendingRecording {
  lineNumber: number;
  fileName: string;
  onComplete: RecordingCallback;
  onError: RecordingErrorCallback;
  timeout: NodeJS.Timeout;
}

export class MediaCaptureServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private pendingRecording: PendingRecording | null = null;

  constructor() {}

  /**
   * Start the local server on a random available port
   */
  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Listen on port 0 to get a random available port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          console.log(`[MediaCaptureServer] Started on port ${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server port'));
        }
      });

      this.server.on('error', (error) => {
        console.error('[MediaCaptureServer] Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
      console.log('[MediaCaptureServer] Stopped');
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || '/';

    if (req.method === 'GET' && url === '/record') {
      // Serve the recording page
      this.serveRecordingPage(res);
    } else if (req.method === 'POST' && url === '/upload') {
      // Handle audio upload
      this.handleAudioUpload(req, res);
    } else if (req.method === 'POST' && url === '/cancel') {
      // Handle cancel
      this.handleCancel(res);
    } else if (req.method === 'GET' && url === '/status') {
      // Return server status
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready', pending: !!this.pendingRecording }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  /**
   * Serve the voice recording HTML page
   */
  private serveRecordingPage(res: http.ServerResponse): void {
    const info = this.pendingRecording;
    const lineNumber = info ? info.lineNumber + 1 : 0;
    const fileName = info ? info.fileName.split(/[/\\]/).pop() || info.fileName : 'Unknown';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeCollab Voice Recording</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000000;
      color: #E6E6E6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: #0D1117;
      border: 2px solid #00FF41;
      padding: 40px;
      text-align: center;
      max-width: 400px;
      width: 90%;
    }
    h1 {
      color: #00FF41;
      font-size: 24px;
      margin-bottom: 8px;
    }
    .info {
      color: #8B949E;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .recording-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .recording-dot {
      width: 16px;
      height: 16px;
      background: #ff4444;
      border-radius: 50%;
      animation: pulse 1s infinite;
    }
    .recording-dot.inactive {
      background: #30363D;
      animation: none;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .timer {
      font-family: 'Courier New', monospace;
      font-size: 48px;
      color: #00FF41;
      margin: 24px 0;
    }
    .buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 24px;
    }
    button {
      padding: 12px 24px;
      font-size: 16px;
      cursor: pointer;
      border: 2px solid #00FF41;
      background: transparent;
      color: #00FF41;
      transition: all 0.2s;
    }
    button:hover {
      background: #00FF41;
      color: #000000;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button.primary {
      background: #00FF41;
      color: #000000;
    }
    button.primary:hover {
      background: transparent;
      color: #00FF41;
    }
    .status {
      margin-top: 24px;
      padding: 12px;
      background: #161B22;
      border: 1px solid #30363D;
      font-size: 14px;
    }
    .status.error {
      border-color: #ff4444;
      color: #ff4444;
    }
    .status.success {
      border-color: #00FF41;
      color: #00FF41;
    }
    .permissions-prompt {
      background: #161B22;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid #30363D;
    }
    .permissions-prompt p {
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎤 Voice Comment</h1>
    <div class="info">Line ${lineNumber} - ${fileName}</div>

    <div id="permissions-prompt" class="permissions-prompt" style="display: none;">
      <p>Click the button below to allow microphone access:</p>
      <button id="request-permission" class="primary">Allow Microphone</button>
    </div>

    <div id="recording-ui" style="display: none;">
      <div class="recording-indicator">
        <span class="recording-dot" id="recording-dot"></span>
        <span id="recording-status">Ready to record</span>
      </div>

      <div class="timer" id="timer">00:00</div>

      <div class="buttons">
        <button id="start-btn" class="primary">Start Recording</button>
        <button id="stop-btn" disabled>Stop & Save</button>
        <button id="cancel-btn">Cancel</button>
      </div>
    </div>

    <div class="status" id="status">Initializing...</div>
  </div>

  <script>
    let mediaRecorder = null;
    let audioChunks = [];
    let startTime = null;
    let timerInterval = null;
    let stream = null;

    const timerEl = document.getElementById('timer');
    const statusEl = document.getElementById('status');
    const recordingDot = document.getElementById('recording-dot');
    const recordingStatus = document.getElementById('recording-status');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const permissionsPrompt = document.getElementById('permissions-prompt');
    const recordingUI = document.getElementById('recording-ui');
    const requestPermissionBtn = document.getElementById('request-permission');

    // Check for MediaRecorder support
    if (!window.MediaRecorder) {
      statusEl.textContent = 'MediaRecorder not supported in this browser';
      statusEl.className = 'status error';
    } else {
      init();
    }

    async function init() {
      try {
        // Check if we already have permission
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

        if (permissionStatus.state === 'granted') {
          await initMicrophone();
        } else if (permissionStatus.state === 'prompt') {
          // Show permission prompt UI
          permissionsPrompt.style.display = 'block';
          statusEl.textContent = 'Click "Allow Microphone" to grant access';
        } else {
          statusEl.textContent = 'Microphone access denied. Please enable in browser settings.';
          statusEl.className = 'status error';
        }

        // Listen for permission changes
        permissionStatus.onchange = async () => {
          if (permissionStatus.state === 'granted') {
            permissionsPrompt.style.display = 'none';
            await initMicrophone();
          }
        };
      } catch (e) {
        // permissions.query might not be supported
        permissionsPrompt.style.display = 'block';
        statusEl.textContent = 'Click "Allow Microphone" to grant access';
      }
    }

    requestPermissionBtn.addEventListener('click', async () => {
      await initMicrophone();
    });

    async function initMicrophone() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        permissionsPrompt.style.display = 'none';
        recordingUI.style.display = 'block';
        statusEl.textContent = 'Ready! Click "Start Recording" to begin.';
        statusEl.className = 'status';

      } catch (error) {
        console.error('Microphone error:', error);

        if (error.name === 'NotAllowedError') {
          statusEl.textContent = 'Microphone permission denied. Please allow access and refresh.';
        } else if (error.name === 'NotFoundError') {
          statusEl.textContent = 'No microphone found. Please connect one and refresh.';
        } else {
          statusEl.textContent = 'Error: ' + error.message;
        }
        statusEl.className = 'status error';
      }
    }

    startBtn.addEventListener('click', () => {
      if (!stream) return;

      // Determine best MIME type
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      mediaRecorder = new MediaRecorder(stream, { mimeType });
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: mimeType });
        const duration = Date.now() - startTime;

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result.split(',')[1];
          await uploadAudio(base64, duration);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start(1000);
      startTime = Date.now();

      // Update UI
      startBtn.disabled = true;
      stopBtn.disabled = false;
      recordingDot.classList.remove('inactive');
      recordingStatus.textContent = 'Recording...';
      statusEl.textContent = 'Recording in progress...';

      // Start timer
      timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        timerEl.textContent = mins + ':' + secs;
      }, 1000);
    });

    stopBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        clearInterval(timerInterval);

        recordingDot.classList.add('inactive');
        recordingStatus.textContent = 'Processing...';
        statusEl.textContent = 'Saving recording...';

        startBtn.disabled = true;
        stopBtn.disabled = true;
        cancelBtn.disabled = true;
      }
    });

    cancelBtn.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      clearInterval(timerInterval);

      // Notify extension
      await fetch('/cancel', { method: 'POST' });

      statusEl.textContent = 'Cancelled. You can close this window.';
      statusEl.className = 'status';

      // Close window after brief delay
      setTimeout(() => window.close(), 1000);
    });

    async function uploadAudio(base64, duration) {
      try {
        const response = await fetch('/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioData: base64, duration })
        });

        if (response.ok) {
          statusEl.textContent = 'Recording saved! You can close this window.';
          statusEl.className = 'status success';

          // Close window after brief delay
          setTimeout(() => window.close(), 1500);
        } else {
          throw new Error('Upload failed');
        }
      } catch (error) {
        statusEl.textContent = 'Failed to save recording: ' + error.message;
        statusEl.className = 'status error';

        // Re-enable buttons
        startBtn.disabled = false;
        stopBtn.disabled = true;
        cancelBtn.disabled = false;
      }
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    });
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Handle audio upload from recording page
   */
  private handleAudioUpload(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        if (this.pendingRecording) {
          clearTimeout(this.pendingRecording.timeout);
          this.pendingRecording.onComplete(data.audioData, data.duration);
          this.pendingRecording = null;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  /**
   * Handle cancel from recording page
   */
  private handleCancel(res: http.ServerResponse): void {
    if (this.pendingRecording) {
      clearTimeout(this.pendingRecording.timeout);
      this.pendingRecording.onError('Recording cancelled');
      this.pendingRecording = null;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }

  /**
   * Start a voice recording session
   * Opens the recording page in user's default browser
   */
  async startRecording(
    lineNumber: number,
    fileName: string,
    onComplete: RecordingCallback,
    onError: RecordingErrorCallback,
    timeoutMs: number = 300000 // 5 minute timeout
  ): Promise<void> {
    // Ensure server is running
    if (!this.server) {
      await this.start();
    }

    // Set up pending recording
    this.pendingRecording = {
      lineNumber,
      fileName,
      onComplete,
      onError,
      timeout: setTimeout(() => {
        if (this.pendingRecording) {
          this.pendingRecording.onError('Recording timeout');
          this.pendingRecording = null;
        }
      }, timeoutMs),
    };

    // Open recording page in browser
    const url = vscode.Uri.parse(`http://127.0.0.1:${this.port}/record`);
    await vscode.env.openExternal(url);
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.port;
  }
}

// Singleton instance
let mediaCaptureServerInstance: MediaCaptureServer | null = null;

export function getMediaCaptureServer(): MediaCaptureServer {
  if (!mediaCaptureServerInstance) {
    mediaCaptureServerInstance = new MediaCaptureServer();
  }
  return mediaCaptureServerInstance;
}

export function resetMediaCaptureServer(): void {
  if (mediaCaptureServerInstance) {
    mediaCaptureServerInstance.stop();
    mediaCaptureServerInstance = null;
  }
}
