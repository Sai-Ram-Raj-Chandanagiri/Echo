import * as vscode from 'vscode';
import { SignalingService, getSignalingService } from './SignalingService';
import { User, PeerConnection, SignalingMessage, generateId } from '../types';

type DataHandler = (peerId: string, data: unknown) => void;
type StreamHandler = (peerId: string, stream: MediaStream) => void;
type ConnectionHandler = (peerId: string, connected: boolean) => void;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export class WebRTCService {
  private peers: Map<string, PeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private signalingService: SignalingService;
  private roomId: string | null = null;
  private localUserId: string | null = null;

  private dataHandlers: Set<DataHandler> = new Set();
  private streamHandlers: Set<StreamHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();

  constructor() {
    this.signalingService = getSignalingService();
    this.setupSignalingHandlers();
  }

  private setupSignalingHandlers(): void {
    this.signalingService.on('offer', (message) => this.handleOffer(message));
    this.signalingService.on('answer', (message) => this.handleAnswer(message));
    this.signalingService.on('ice-candidate', (message) => this.handleIceCandidate(message));
    this.signalingService.on('join', (message) => this.handleUserJoined(message));
    this.signalingService.on('leave', (message) => this.handleUserLeft(message));
  }

  async connect(roomId: string, user: User): Promise<void> {
    this.roomId = roomId;
    this.localUserId = user.id;

    if (!this.signalingService.isConnected) {
      await this.signalingService.connect();
    }

    this.signalingService.joinRoom(roomId, user);
    console.log(`[WebRTCService] Joined room ${roomId} as ${user.name}`);
  }

  async disconnect(): Promise<void> {
    if (this.roomId && this.localUserId) {
      this.signalingService.leaveRoom(this.roomId, this.localUserId);
    }

    // Close all peer connections
    for (const [peerId, peerConnection] of this.peers) {
      this.closePeerConnection(peerId);
    }
    this.peers.clear();

    // Stop local media
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.roomId = null;
    this.localUserId = null;
  }

  async getLocalStream(video: boolean = true, audio: boolean = true): Promise<MediaStream | null> {
    if (this.localStream) {
      return this.localStream;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: video ? { width: 640, height: 480 } : false,
        audio: audio,
      });
      return this.localStream;
    } catch (error) {
      console.error('[WebRTCService] Failed to get media stream:', error);
      return null;
    }
  }

  toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }

  toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }

  broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const [peerId, peerConnection] of this.peers) {
      if (peerConnection.dataChannel?.readyState === 'open') {
        try {
          peerConnection.dataChannel.send(message);
        } catch (error) {
          console.error(`[WebRTCService] Failed to send to peer ${peerId}:`, error);
        }
      }
    }
  }

  sendToPeer(peerId: string, data: unknown): void {
    const peerConnection = this.peers.get(peerId);
    if (peerConnection?.dataChannel?.readyState === 'open') {
      try {
        peerConnection.dataChannel.send(JSON.stringify(data));
      } catch (error) {
        console.error(`[WebRTCService] Failed to send to peer ${peerId}:`, error);
      }
    }
  }

  onData(handler: DataHandler): void {
    this.dataHandlers.add(handler);
  }

  offData(handler: DataHandler): void {
    this.dataHandlers.delete(handler);
  }

  onStream(handler: StreamHandler): void {
    this.streamHandlers.add(handler);
  }

  offStream(handler: StreamHandler): void {
    this.streamHandlers.delete(handler);
  }

  onConnection(handler: ConnectionHandler): void {
    this.connectionHandlers.add(handler);
  }

  offConnection(handler: ConnectionHandler): void {
    this.connectionHandlers.delete(handler);
  }

  getPeers(): string[] {
    return Array.from(this.peers.keys());
  }

  isPeerConnected(peerId: string): boolean {
    return this.peers.get(peerId)?.connected ?? false;
  }

  private async createPeerConnection(peerId: string, initiator: boolean): Promise<PeerConnection> {
    console.log(`[WebRTCService] Creating peer connection to ${peerId}, initiator: ${initiator}`);

    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const peerConnection: PeerConnection = {
      peerId,
      peer,
      dataChannel: null,
      mediaStream: null,
      connected: false,
    };

    // Handle ICE candidates
    peer.onicecandidate = (event) => {
      if (event.candidate && this.roomId) {
        this.signalingService.sendIceCandidate(this.roomId, peerId, event.candidate.toJSON());
      }
    };

    // Handle connection state changes
    peer.onconnectionstatechange = () => {
      console.log(`[WebRTCService] Connection state with ${peerId}: ${peer.connectionState}`);
      const connected = peer.connectionState === 'connected';
      peerConnection.connected = connected;
      this.connectionHandlers.forEach((handler) => handler(peerId, connected));

      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        this.closePeerConnection(peerId);
      }
    };

    // Handle incoming streams
    peer.ontrack = (event) => {
      console.log(`[WebRTCService] Received track from ${peerId}`);
      if (event.streams && event.streams[0]) {
        peerConnection.mediaStream = event.streams[0];
        this.streamHandlers.forEach((handler) => handler(peerId, event.streams[0]));
      }
    };

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        peer.addTrack(track, this.localStream!);
      });
    }

    // Create data channel (initiator creates, receiver handles ondatachannel)
    if (initiator) {
      const dataChannel = peer.createDataChannel('collab', {
        ordered: true,
      });
      this.setupDataChannel(dataChannel, peerConnection);
      peerConnection.dataChannel = dataChannel;

      // Create and send offer
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (this.roomId) {
        this.signalingService.sendOffer(this.roomId, peerId, offer);
      }
    } else {
      peer.ondatachannel = (event) => {
        console.log(`[WebRTCService] Received data channel from ${peerId}`);
        this.setupDataChannel(event.channel, peerConnection);
        peerConnection.dataChannel = event.channel;
      };
    }

    this.peers.set(peerId, peerConnection);
    return peerConnection;
  }

  private setupDataChannel(dataChannel: RTCDataChannel, peerConnection: PeerConnection): void {
    dataChannel.onopen = () => {
      console.log(`[WebRTCService] Data channel opened with ${peerConnection.peerId}`);
    };

    dataChannel.onclose = () => {
      console.log(`[WebRTCService] Data channel closed with ${peerConnection.peerId}`);
    };

    dataChannel.onerror = (error) => {
      console.error(`[WebRTCService] Data channel error with ${peerConnection.peerId}:`, error);
    };

    dataChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.dataHandlers.forEach((handler) => handler(peerConnection.peerId, data));
      } catch (error) {
        console.error('[WebRTCService] Failed to parse message:', error);
      }
    };
  }

  private closePeerConnection(peerId: string): void {
    const peerConnection = this.peers.get(peerId);
    if (peerConnection) {
      peerConnection.dataChannel?.close();
      peerConnection.peer.close();
      this.peers.delete(peerId);
      this.connectionHandlers.forEach((handler) => handler(peerId, false));
    }
  }

  private async handleUserJoined(message: SignalingMessage): Promise<void> {
    const user = message.payload as User;
    if (user.id === this.localUserId) {
      return; // Ignore self
    }

    console.log(`[WebRTCService] User joined: ${user.name}`);

    // Create peer connection as initiator (we initiate to new users)
    if (!this.peers.has(user.id)) {
      await this.createPeerConnection(user.id, true);
    }
  }

  private handleUserLeft(message: SignalingMessage): void {
    console.log(`[WebRTCService] User left: ${message.fromId}`);
    this.closePeerConnection(message.fromId);
  }

  private async handleOffer(message: SignalingMessage): Promise<void> {
    const offer = message.payload as RTCSessionDescriptionInit;
    console.log(`[WebRTCService] Received offer from ${message.fromId}`);

    let peerConnection = this.peers.get(message.fromId);
    if (!peerConnection) {
      peerConnection = await this.createPeerConnection(message.fromId, false);
    }

    await peerConnection.peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.peer.createAnswer();
    await peerConnection.peer.setLocalDescription(answer);

    if (this.roomId) {
      this.signalingService.sendAnswer(this.roomId, message.fromId, answer);
    }
  }

  private async handleAnswer(message: SignalingMessage): Promise<void> {
    const answer = message.payload as RTCSessionDescriptionInit;
    console.log(`[WebRTCService] Received answer from ${message.fromId}`);

    const peerConnection = this.peers.get(message.fromId);
    if (peerConnection) {
      await peerConnection.peer.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleIceCandidate(message: SignalingMessage): Promise<void> {
    const candidate = message.payload as RTCIceCandidateInit;

    const peerConnection = this.peers.get(message.fromId);
    if (peerConnection) {
      try {
        await peerConnection.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('[WebRTCService] Failed to add ICE candidate:', error);
      }
    }
  }
}

// Singleton instance
let webRTCServiceInstance: WebRTCService | null = null;

export function getWebRTCService(): WebRTCService {
  if (!webRTCServiceInstance) {
    webRTCServiceInstance = new WebRTCService();
  }
  return webRTCServiceInstance;
}

export function resetWebRTCService(): void {
  if (webRTCServiceInstance) {
    webRTCServiceInstance.disconnect();
    webRTCServiceInstance = null;
  }
}
