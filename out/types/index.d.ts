export interface User {
    id: string;
    name: string;
    color: string;
    colorLight: string;
    permission: Permission;
    status: UserStatus;
    cursor?: CursorPosition;
    selection?: SelectionRange;
}
export type Permission = 'read' | 'edit' | 'admin';
export type UserStatus = 'available' | 'focused' | 'away';
export interface CursorPosition {
    line: number;
    character: number;
    fileName?: string;
}
export interface SelectionRange {
    start: CursorPosition;
    end: CursorPosition;
}
export interface Session {
    id: string;
    name: string;
    hostId: string;
    createdAt: number;
    participants: Map<string, User>;
    sharedFiles: string[];
    settings: SessionSettings;
}
export interface SessionSettings {
    allowVideo: boolean;
    allowAudio: boolean;
    allowTerminal: boolean;
    requireApproval: boolean;
    maxParticipants: number;
}
export interface SessionState {
    isActive: boolean;
    isHost: boolean;
    currentSession: Session | null;
    localUser: User | null;
    connectionStatus: ConnectionStatus;
}
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export interface PeerConnection {
    peerId: string;
    peer: RTCPeerConnection;
    dataChannel: RTCDataChannel | null;
    mediaStream: MediaStream | null;
    connected: boolean;
}
export interface SignalingMessage {
    type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'user-update';
    roomId: string;
    fromId: string;
    targetId?: string;
    payload: unknown;
}
export interface WebRTCConfig {
    iceServers: RTCIceServer[];
    signalingUrl: string;
}
export interface VoiceComment {
    id: string;
    lineNumber: number;
    fileName: string;
    audioData: string;
    author: User;
    timestamp: number;
    duration: number;
}
export interface AIMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    codeContext?: string;
    fileReferences?: FileReference[];
    editProposal?: EditProposal;
}
export interface AIRequest {
    prompt: string;
    codeContext?: string;
    action?: AIAction;
    fileReferences?: FileReference[];
    model?: AIModelProvider;
}
export type AIAction = 'explain' | 'fix' | 'refactor' | 'document' | 'review' | 'chat';
export type AIModelProvider = 'gemma_3' | 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'codellama';
export interface AIModelConfig {
    provider: AIModelProvider;
    name: string;
    description: string;
    isOnline: boolean;
    maxTokens: number;
    apiModel?: string;
}
export declare const AI_MODELS: Record<AIModelProvider, AIModelConfig>;
export interface FileReference {
    path: string;
    relativePath: string;
    fileName: string;
    content?: string;
    language?: string;
    startLine?: number;
    endLine?: number;
}
export interface AgenticContext {
    workspaceRoot: string;
    openFiles: string[];
    currentFile?: string;
    selectedText?: string;
    fileReferences: FileReference[];
}
export interface AgenticCapability {
    name: string;
    description: string;
    execute: (context: AgenticContext, params: unknown) => Promise<string>;
}
export type FileEditType = 'create' | 'modify' | 'delete' | 'rename';
export interface FileEdit {
    id: string;
    type: FileEditType;
    filePath: string;
    originalContent?: string;
    newContent?: string;
    newFilePath?: string;
    startLine?: number;
    endLine?: number;
    description?: string;
}
export interface EditProposal {
    id: string;
    edits: FileEdit[];
    summary: string;
    timestamp: number;
    status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
    error?: string;
}
export interface EditResult {
    success: boolean;
    editId: string;
    filePath: string;
    error?: string;
    backupPath?: string;
}
export interface EditApplyResult {
    proposalId: string;
    results: EditResult[];
    allSuccessful: boolean;
    appliedCount: number;
    failedCount: number;
}
export interface OllamaResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
}
export interface GeminiRequest {
    contents: GeminiContent[];
    generationConfig?: GeminiGenerationConfig;
}
export interface GeminiContent {
    parts: GeminiPart[];
    role?: 'user' | 'model';
}
export interface GeminiPart {
    text: string;
}
export interface GeminiGenerationConfig {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
}
export interface GeminiResponse {
    candidates: GeminiCandidate[];
}
export interface GeminiCandidate {
    content: GeminiContent;
    finishReason: string;
}
export interface TerminalMessage {
    type: 'input' | 'output' | 'resize';
    data: string;
    timestamp: number;
    userId: string;
}
export interface SharedTerminalState {
    isSharing: boolean;
    canExecute: boolean;
    history: TerminalMessage[];
}
export interface CollabEventMap {
    'session:created': Session;
    'session:joined': Session;
    'session:left': void;
    'user:joined': User;
    'user:left': User;
    'user:updated': User;
    'cursor:moved': {
        userId: string;
        cursor: CursorPosition;
    };
    'selection:changed': {
        userId: string;
        selection: SelectionRange;
    };
    'document:changed': {
        fileName: string;
        changes: unknown;
    };
    'voice-comment:added': VoiceComment;
    'voice-comment:removed': string;
    'terminal:data': TerminalMessage;
    'connection:status': ConnectionStatus;
    'error': Error;
}
export type EventCallback<T> = (data: T) => void;
export interface Disposable {
    dispose(): void;
}
export declare function generateId(): string;
export declare function generateRoomId(): string;
export declare function generateUserColor(): {
    color: string;
    colorLight: string;
};
//# sourceMappingURL=index.d.ts.map