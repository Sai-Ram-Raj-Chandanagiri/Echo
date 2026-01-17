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
}
export interface AIRequest {
    prompt: string;
    codeContext?: string;
    action?: AIAction;
}
export type AIAction = 'explain' | 'fix' | 'refactor' | 'document' | 'review' | 'chat';
export interface OllamaResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
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