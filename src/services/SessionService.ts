import * as vscode from 'vscode';
import { Session, SessionSettings, SessionState, User, Permission, generateRoomId, generateUserColor, generateId } from '../types';
import { getSignalingService, SignalingService } from './SignalingService';
import { getWebRTCService, WebRTCService } from './WebRTCService';
import { getYjsService, YjsService } from './YjsService';

type SessionEventHandler = (session: Session | null) => void;
type UserEventHandler = (user: User) => void;

export class SessionService {
  private currentSession: Session | null = null;
  private localUser: User | null = null;
  private sessionState: SessionState;
  private context: vscode.ExtensionContext;

  private signalingService: SignalingService;
  private webRTCService: WebRTCService;
  private yjsService: YjsService;

  private sessionHandlers: Set<SessionEventHandler> = new Set();
  private userJoinedHandlers: Set<UserEventHandler> = new Set();
  private userLeftHandlers: Set<UserEventHandler> = new Set();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.signalingService = getSignalingService();
    this.webRTCService = getWebRTCService();
    this.yjsService = getYjsService();

    this.sessionState = {
      isActive: false,
      isHost: false,
      currentSession: null,
      localUser: null,
      connectionStatus: 'disconnected',
    };

    this.setupWebRTCHandlers();
  }

  private setupWebRTCHandlers(): void {
    this.webRTCService.onConnection((peerId, connected) => {
      if (!connected && this.currentSession) {
        const user = this.currentSession.participants.get(peerId);
        if (user) {
          this.currentSession.participants.delete(peerId);
          this.userLeftHandlers.forEach((handler) => handler(user));
        }
      }
    });

    this.webRTCService.onData((peerId, data: unknown) => {
      const message = data as { type: string; payload: unknown };

      if (message.type === 'user-info') {
        const user = message.payload as User;
        if (this.currentSession && !this.currentSession.participants.has(user.id)) {
          this.currentSession.participants.set(user.id, user);
          this.userJoinedHandlers.forEach((handler) => handler(user));
        }
      }
    });
  }

  async createSession(name?: string): Promise<Session> {
    const roomId = generateRoomId();
    const user = await this.createLocalUser('admin');

    const session: Session = {
      id: roomId,
      name: name || `Session ${roomId}`,
      hostId: user.id,
      createdAt: Date.now(),
      participants: new Map([[user.id, user]]),
      sharedFiles: [],
      settings: {
        allowVideo: true,
        allowAudio: true,
        allowTerminal: true,
        requireApproval: false,
        maxParticipants: 8,
      },
    };

    await this.signalingService.connect();
    await this.webRTCService.connect(roomId, user);
    this.yjsService.setLocalUser(user);

    this.currentSession = session;
    this.localUser = user;
    this.sessionState = {
      isActive: true,
      isHost: true,
      currentSession: session,
      localUser: user,
      connectionStatus: 'connected',
    };

    // Update context for menu visibility
    await vscode.commands.executeCommand('setContext', 'codecollab.inSession', true);
    await vscode.commands.executeCommand('setContext', 'codecollab.isHost', true);

    // Save session to storage
    await this.saveSession(session);

    this.sessionHandlers.forEach((handler) => handler(session));

    return session;
  }

  async joinSession(roomId: string): Promise<Session> {
    const user = await this.createLocalUser('edit');

    await this.signalingService.connect();
    await this.webRTCService.connect(roomId, user);
    this.yjsService.setLocalUser(user);

    // Broadcast our user info to peers
    setTimeout(() => {
      this.webRTCService.broadcast({
        type: 'user-info',
        payload: user,
      });
    }, 1000);

    const session: Session = {
      id: roomId,
      name: `Session ${roomId}`,
      hostId: '', // Will be updated when host sends info
      createdAt: Date.now(),
      participants: new Map([[user.id, user]]),
      sharedFiles: [],
      settings: {
        allowVideo: true,
        allowAudio: true,
        allowTerminal: true,
        requireApproval: false,
        maxParticipants: 8,
      },
    };

    this.currentSession = session;
    this.localUser = user;
    this.sessionState = {
      isActive: true,
      isHost: false,
      currentSession: session,
      localUser: user,
      connectionStatus: 'connected',
    };

    await vscode.commands.executeCommand('setContext', 'codecollab.inSession', true);
    await vscode.commands.executeCommand('setContext', 'codecollab.isHost', false);

    this.sessionHandlers.forEach((handler) => handler(session));

    return session;
  }

  async leaveSession(): Promise<void> {
    if (this.currentSession && this.localUser) {
      await this.webRTCService.disconnect();
      this.signalingService.disconnect();
    }

    this.currentSession = null;
    this.localUser = null;
    this.sessionState = {
      isActive: false,
      isHost: false,
      currentSession: null,
      localUser: null,
      connectionStatus: 'disconnected',
    };

    await vscode.commands.executeCommand('setContext', 'codecollab.inSession', false);
    await vscode.commands.executeCommand('setContext', 'codecollab.isHost', false);

    this.sessionHandlers.forEach((handler) => handler(null));
  }

  private async createLocalUser(permission: Permission): Promise<User> {
    const config = vscode.workspace.getConfiguration('codecollab');
    let userName = config.get<string>('userName', '');

    if (!userName) {
      // Try to get from git config or generate
      userName = await this.getGitUserName() || `User-${generateId().substring(0, 4)}`;
    }

    const colors = generateUserColor();

    return {
      id: generateId(),
      name: userName,
      color: colors.color,
      colorLight: colors.colorLight,
      permission,
      status: 'available',
    };
  }

  private async getGitUserName(): Promise<string | null> {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (gitExtension) {
        const git = gitExtension.exports.getAPI(1);
        if (git.repositories.length > 0) {
          const config = await git.repositories[0].getConfig('user.name');
          return config || null;
        }
      }
    } catch (error) {
      console.log('[SessionService] Could not get git user name:', error);
    }
    return null;
  }

  private async saveSession(session: Session): Promise<void> {
    const sessions = this.context.globalState.get<Record<string, unknown>>('sessions', {});
    sessions[session.id] = {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      hostId: session.hostId,
    };
    await this.context.globalState.update('sessions', sessions);
  }

  getSavedSessions(): { id: string; name: string; createdAt: number }[] {
    const sessions = this.context.globalState.get<Record<string, { id: string; name: string; createdAt: number }>>('sessions', {});
    return Object.values(sessions).sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteSavedSession(sessionId: string): Promise<void> {
    const sessions = this.context.globalState.get<Record<string, unknown>>('sessions', {});
    delete sessions[sessionId];
    await this.context.globalState.update('sessions', sessions);
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  getLocalUser(): User | null {
    return this.localUser;
  }

  getState(): SessionState {
    return this.sessionState;
  }

  getParticipants(): User[] {
    if (!this.currentSession) {
      return [];
    }
    return Array.from(this.currentSession.participants.values());
  }

  updateUserStatus(status: 'available' | 'focused' | 'away'): void {
    if (this.localUser) {
      this.localUser.status = status;
      this.webRTCService.broadcast({
        type: 'user-info',
        payload: this.localUser,
      });
    }
  }

  setUserPermission(userId: string, permission: Permission): void {
    if (!this.currentSession || !this.sessionState.isHost) {
      return;
    }

    const user = this.currentSession.participants.get(userId);
    if (user) {
      user.permission = permission;
      this.webRTCService.broadcast({
        type: 'permission-update',
        payload: { userId, permission },
      });
    }
  }

  onSessionChange(handler: SessionEventHandler): void {
    this.sessionHandlers.add(handler);
  }

  offSessionChange(handler: SessionEventHandler): void {
    this.sessionHandlers.delete(handler);
  }

  onUserJoined(handler: UserEventHandler): void {
    this.userJoinedHandlers.add(handler);
  }

  offUserJoined(handler: UserEventHandler): void {
    this.userJoinedHandlers.delete(handler);
  }

  onUserLeft(handler: UserEventHandler): void {
    this.userLeftHandlers.add(handler);
  }

  offUserLeft(handler: UserEventHandler): void {
    this.userLeftHandlers.delete(handler);
  }
}

// Singleton instance
let sessionServiceInstance: SessionService | null = null;

export function getSessionService(context?: vscode.ExtensionContext): SessionService {
  if (!sessionServiceInstance) {
    if (!context) {
      throw new Error('SessionService requires ExtensionContext on first initialization');
    }
    sessionServiceInstance = new SessionService(context);
  }
  return sessionServiceInstance;
}

export function resetSessionService(): void {
  if (sessionServiceInstance) {
    sessionServiceInstance.leaveSession();
    sessionServiceInstance = null;
  }
}
