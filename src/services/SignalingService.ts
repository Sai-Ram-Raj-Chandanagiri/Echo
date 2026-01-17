import { io, Socket } from 'socket.io-client';
import * as vscode from 'vscode';
import { SignalingMessage, User, generateId } from '../types';

type MessageHandler = (message: SignalingMessage) => void;

export class SignalingService {
  private socket: Socket | null = null;
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private _isConnected = false;

  constructor(private serverUrl: string) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.serverUrl, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: 1000,
          timeout: 10000,
        });

        this.socket.on('connect', () => {
          console.log('[SignalingService] Connected to signaling server');
          this._isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        });

        this.socket.on('disconnect', (reason) => {
          console.log('[SignalingService] Disconnected:', reason);
          this._isConnected = false;
          this.emit('connection:status', { status: 'disconnected', reason });
        });

        this.socket.on('connect_error', (error) => {
          console.error('[SignalingService] Connection error:', error);
          this.reconnectAttempts++;
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            reject(new Error('Failed to connect to signaling server'));
          }
        });

        this.socket.on('reconnect', (attemptNumber) => {
          console.log('[SignalingService] Reconnected after', attemptNumber, 'attempts');
          this._isConnected = true;
          this.emit('connection:status', { status: 'reconnected' });
        });

        // Handle incoming signaling messages
        this.socket.on('signal', (message: SignalingMessage) => {
          this.handleMessage(message);
        });

        this.socket.on('user-joined', (data: { user: User; roomId: string }) => {
          this.handleMessage({
            type: 'join',
            roomId: data.roomId,
            fromId: data.user.id,
            payload: data.user,
          });
        });

        this.socket.on('user-left', (data: { userId: string; roomId: string }) => {
          this.handleMessage({
            type: 'leave',
            roomId: data.roomId,
            fromId: data.userId,
            payload: null,
          });
        });

        this.socket.on('room-users', (data: { users: User[]; roomId: string }) => {
          data.users.forEach((user) => {
            this.handleMessage({
              type: 'join',
              roomId: data.roomId,
              fromId: user.id,
              payload: user,
            });
          });
        });

        this.socket.on('webrtc-offer', (data: { fromId: string; offer: RTCSessionDescriptionInit; roomId: string }) => {
          this.handleMessage({
            type: 'offer',
            roomId: data.roomId,
            fromId: data.fromId,
            payload: data.offer,
          });
        });

        this.socket.on('webrtc-answer', (data: { fromId: string; answer: RTCSessionDescriptionInit; roomId: string }) => {
          this.handleMessage({
            type: 'answer',
            roomId: data.roomId,
            fromId: data.fromId,
            payload: data.answer,
          });
        });

        this.socket.on('ice-candidate', (data: { fromId: string; candidate: RTCIceCandidateInit; roomId: string }) => {
          this.handleMessage({
            type: 'ice-candidate',
            roomId: data.roomId,
            fromId: data.fromId,
            payload: data.candidate,
          });
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this._isConnected = false;
    }
  }

  joinRoom(roomId: string, user: User): void {
    if (!this.socket || !this._isConnected) {
      throw new Error('Not connected to signaling server');
    }
    this.socket.emit('join-room', { roomId, user });
  }

  leaveRoom(roomId: string, userId: string): void {
    if (this.socket && this._isConnected) {
      this.socket.emit('leave-room', { roomId, userId });
    }
  }

  sendOffer(roomId: string, targetId: string, offer: RTCSessionDescriptionInit): void {
    if (!this.socket || !this._isConnected) {
      return;
    }
    this.socket.emit('webrtc-offer', { roomId, targetId, offer });
  }

  sendAnswer(roomId: string, targetId: string, answer: RTCSessionDescriptionInit): void {
    if (!this.socket || !this._isConnected) {
      return;
    }
    this.socket.emit('webrtc-answer', { roomId, targetId, answer });
  }

  sendIceCandidate(roomId: string, targetId: string, candidate: RTCIceCandidateInit): void {
    if (!this.socket || !this._isConnected) {
      return;
    }
    this.socket.emit('ice-candidate', { roomId, targetId, candidate });
  }

  sendUserUpdate(roomId: string, user: User): void {
    if (!this.socket || !this._isConnected) {
      return;
    }
    this.socket.emit('user-update', { roomId, user });
  }

  on(event: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(event)) {
      this.messageHandlers.set(event, new Set());
    }
    this.messageHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, data: unknown): void {
    const message: SignalingMessage = {
      type: event as SignalingMessage['type'],
      roomId: '',
      fromId: '',
      payload: data,
    };
    this.handleMessage(message);
  }

  private handleMessage(message: SignalingMessage): void {
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[SignalingService] Handler error:', error);
        }
      });
    }

    // Also emit to 'all' handlers
    const allHandlers = this.messageHandlers.get('all');
    if (allHandlers) {
      allHandlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[SignalingService] Handler error:', error);
        }
      });
    }
  }
}

// Singleton instance
let signalingServiceInstance: SignalingService | null = null;

export function getSignalingService(): SignalingService {
  if (!signalingServiceInstance) {
    const config = vscode.workspace.getConfiguration('codecollab');
    const serverUrl = config.get<string>('signalingServer', 'ws://localhost:3001');
    signalingServiceInstance = new SignalingService(serverUrl);
  }
  return signalingServiceInstance;
}

export function resetSignalingService(): void {
  if (signalingServiceInstance) {
    signalingServiceInstance.disconnect();
    signalingServiceInstance = null;
  }
}
