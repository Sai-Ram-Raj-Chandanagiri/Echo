// User types
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

// Session types
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

// WebRTC types
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

// Voice comment types
export interface VoiceComment {
  id: string;
  lineNumber: number;
  fileName: string;
  audioData: string; // base64 encoded audio
  author: User;
  timestamp: number;
  duration: number;
}

// AI types
export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  codeContext?: string;
  fileReferences?: FileReference[];
  editProposal?: EditProposal;  // Proposed file edits from AI
}

export interface AIRequest {
  prompt: string;
  codeContext?: string;
  action?: AIAction;
  fileReferences?: FileReference[];
  model?: AIModelProvider;
}

export type AIAction = 'explain' | 'fix' | 'refactor' | 'document' | 'review' | 'chat';

// Model provider types
export type AIModelProvider = 'gemma_3' | 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'codellama';

export interface AIModelConfig {
  provider: AIModelProvider;
  name: string;
  description: string;
  isOnline: boolean;
  maxTokens: number;
  apiModel?: string; // The actual model ID to use in API calls
}

export const AI_MODELS: Record<AIModelProvider, AIModelConfig> = {
  // Gemma 3 Model
  'gemma_3': {
    provider: 'gemma_3',
    name: 'Gemma 3',
    description: 'Fast, efficient - good for most tasks',
    isOnline: true,
    maxTokens: 8192,
    apiModel: 'gemma-3-27b-it',
  },
  // Gemini 3 Models
  'gemini-3-flash': {
    provider: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    description: 'Fast, efficient - good for most tasks',
    isOnline: true,
    maxTokens: 8192,
    apiModel: 'gemini-3-flash',
  },
  'gemini-3-pro': {
    provider: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    description: 'Most capable, best for complex tasks',
    isOnline: true,
    maxTokens: 8192,
    apiModel: 'gemini-3-pro',
  },
  // Gemini 2.5 Models
  'gemini-2.5-flash': {
    provider: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Good performance, balanced latency',
    isOnline: true,
    maxTokens: 8192,
    apiModel: 'gemini-2.5-flash',
  },
  'gemini-2.5-pro': {
    provider: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Most capable, handles complex reasoning',
    isOnline: true,
    maxTokens: 8192,
    apiModel: 'gemini-2.5-pro',
  },
  // Offline Model
  codellama: {
    provider: 'codellama',
    name: 'CodeLlama 7B',
    description: 'Offline - Local Processing',
    isOnline: false,
    maxTokens: 4096,
  },
};

// File reference types for '@' decorator
export interface FileReference {
  path: string;
  relativePath: string;
  fileName: string;
  content?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
}

// Agentic AI types
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

// File editing types for AI-driven code modifications
export type FileEditType = 'create' | 'modify' | 'delete' | 'rename';

export interface FileEdit {
  id: string;
  type: FileEditType;
  filePath: string;           // Relative path from workspace root
  originalContent?: string;   // Original content (for modify/delete)
  newContent?: string;        // New content (for create/modify)
  newFilePath?: string;       // For rename operations
  startLine?: number;         // For partial modifications
  endLine?: number;           // For partial modifications
  description?: string;       // Human-readable description of the change
}

export interface EditProposal {
  id: string;
  edits: FileEdit[];
  summary: string;            // AI-generated summary of all changes
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  error?: string;             // Error message if status is 'failed'
}

export interface EditResult {
  success: boolean;
  editId: string;
  filePath: string;
  error?: string;
  backupPath?: string;        // Path to backup file if created
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

// Gemini API types
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

// Terminal types
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

// Events
export interface CollabEventMap {
  'session:created': Session;
  'session:joined': Session;
  'session:left': void;
  'user:joined': User;
  'user:left': User;
  'user:updated': User;
  'cursor:moved': { userId: string; cursor: CursorPosition };
  'selection:changed': { userId: string; selection: SelectionRange };
  'document:changed': { fileName: string; changes: unknown };
  'voice-comment:added': VoiceComment;
  'voice-comment:removed': string;
  'terminal:data': TerminalMessage;
  'connection:status': ConnectionStatus;
  'error': Error;
}

// Utility types
export type EventCallback<T> = (data: T) => void;

export interface Disposable {
  dispose(): void;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

export function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const segments = [];
  for (let i = 0; i < 3; i++) {
    let segment = '';
    for (let j = 0; j < 3; j++) {
      segment += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(segment);
  }
  return segments.join('-');
}

export function generateUserColor(): { color: string; colorLight: string } {
  const hue = Math.floor(Math.random() * 360);
  const color = `hsl(${hue}, 70%, 50%)`;
  const colorLight = `hsl(${hue}, 70%, 90%)`;
  return { color, colorLight };
}
