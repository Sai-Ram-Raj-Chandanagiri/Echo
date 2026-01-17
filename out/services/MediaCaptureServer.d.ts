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
export declare class MediaCaptureServer {
    private server;
    private port;
    private pendingRecording;
    constructor();
    /**
     * Start the local server on a random available port
     */
    start(): Promise<number>;
    /**
     * Stop the server
     */
    stop(): void;
    /**
     * Handle incoming HTTP requests
     */
    private handleRequest;
    /**
     * Serve the voice recording HTML page
     */
    private serveRecordingPage;
    /**
     * Handle audio upload from recording page
     */
    private handleAudioUpload;
    /**
     * Handle cancel from recording page
     */
    private handleCancel;
    /**
     * Start a voice recording session
     * Opens the recording page in user's default browser
     */
    startRecording(lineNumber: number, fileName: string, onComplete: RecordingCallback, onError: RecordingErrorCallback, timeoutMs?: number): Promise<void>;
    /**
     * Check if server is running
     */
    isRunning(): boolean;
    /**
     * Get server port
     */
    getPort(): number;
}
export declare function getMediaCaptureServer(): MediaCaptureServer;
export declare function resetMediaCaptureServer(): void;
export {};
//# sourceMappingURL=MediaCaptureServer.d.ts.map