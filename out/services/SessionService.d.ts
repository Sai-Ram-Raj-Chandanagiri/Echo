import * as vscode from 'vscode';
import { Session, SessionState, User, Permission } from '../types';
type SessionEventHandler = (session: Session | null) => void;
type UserEventHandler = (user: User) => void;
export declare class SessionService {
    private currentSession;
    private localUser;
    private sessionState;
    private context;
    private signalingService;
    private webRTCService;
    private yjsService;
    private sessionHandlers;
    private userJoinedHandlers;
    private userLeftHandlers;
    constructor(context: vscode.ExtensionContext);
    private setupWebRTCHandlers;
    createSession(name?: string): Promise<Session>;
    joinSession(roomId: string): Promise<Session>;
    leaveSession(): Promise<void>;
    private createLocalUser;
    private getGitUserName;
    private saveSession;
    getSavedSessions(): {
        id: string;
        name: string;
        createdAt: number;
    }[];
    deleteSavedSession(sessionId: string): Promise<void>;
    getSession(): Session | null;
    getLocalUser(): User | null;
    getState(): SessionState;
    getParticipants(): User[];
    updateUserStatus(status: 'available' | 'focused' | 'away'): void;
    setUserPermission(userId: string, permission: Permission): void;
    onSessionChange(handler: SessionEventHandler): void;
    offSessionChange(handler: SessionEventHandler): void;
    onUserJoined(handler: UserEventHandler): void;
    offUserJoined(handler: UserEventHandler): void;
    onUserLeft(handler: UserEventHandler): void;
    offUserLeft(handler: UserEventHandler): void;
}
export declare function getSessionService(context?: vscode.ExtensionContext): SessionService;
export declare function resetSessionService(): void;
export {};
//# sourceMappingURL=SessionService.d.ts.map