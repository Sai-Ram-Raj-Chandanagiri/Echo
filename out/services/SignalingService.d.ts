import { SignalingMessage, User } from '../types';
type MessageHandler = (message: SignalingMessage) => void;
export declare class SignalingService {
    private serverUrl;
    private socket;
    private messageHandlers;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private _isConnected;
    constructor(serverUrl: string);
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): void;
    joinRoom(roomId: string, user: User): void;
    leaveRoom(roomId: string, userId: string): void;
    sendOffer(roomId: string, targetId: string, offer: RTCSessionDescriptionInit): void;
    sendAnswer(roomId: string, targetId: string, answer: RTCSessionDescriptionInit): void;
    sendIceCandidate(roomId: string, targetId: string, candidate: RTCIceCandidateInit): void;
    sendUserUpdate(roomId: string, user: User): void;
    on(event: string, handler: MessageHandler): void;
    off(event: string, handler: MessageHandler): void;
    private emit;
    private handleMessage;
}
export declare function getSignalingService(): SignalingService;
export declare function resetSignalingService(): void;
export {};
//# sourceMappingURL=SignalingService.d.ts.map