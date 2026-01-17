import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

interface User {
  id: string;
  name: string;
  color: string;
  colorLight: string;
  permission: 'read' | 'edit' | 'admin';
  status: 'available' | 'focused' | 'away';
  socketId: string;
}

interface Room {
  id: string;
  users: Map<string, User>;
  hostId: string;
  createdAt: number;
}

const rooms = new Map<string, Room>();

io.on('connection', (socket: Socket) => {
  console.log(`[Server] Client connected: ${socket.id}`);

  // Join room
  socket.on('join-room', (data: { roomId: string; user: User }) => {
    const { roomId, user } = data;
    console.log(`[Server] User ${user.name} joining room ${roomId}`);

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        users: new Map(),
        hostId: user.id,
        createdAt: Date.now(),
      });
      console.log(`[Server] Created new room: ${roomId}`);
    }

    const room = rooms.get(roomId)!;

    // Add user to room
    const userWithSocket: User = { ...user, socketId: socket.id };
    room.users.set(user.id, userWithSocket);

    // Join socket.io room
    socket.join(roomId);

    // Store room info on socket
    (socket as unknown as { roomId: string; userId: string }).roomId = roomId;
    (socket as unknown as { roomId: string; userId: string }).userId = user.id;

    // Send existing users to the new user
    const existingUsers = Array.from(room.users.values()).filter((u) => u.id !== user.id);
    socket.emit('room-users', { users: existingUsers, roomId });

    // Notify other users in the room
    socket.to(roomId).emit('user-joined', { user: userWithSocket, roomId });

    console.log(`[Server] Room ${roomId} now has ${room.users.size} users`);
  });

  // Leave room
  socket.on('leave-room', (data: { roomId: string; userId: string }) => {
    const { roomId, userId } = data;
    handleUserLeave(socket, roomId, userId);
  });

  // WebRTC signaling: Offer
  socket.on('webrtc-offer', (data: { roomId: string; targetId: string; offer: unknown }) => {
    const { roomId, targetId, offer } = data;
    const room = rooms.get(roomId);

    if (room) {
      const targetUser = room.users.get(targetId);
      if (targetUser) {
        const fromId = (socket as unknown as { userId: string }).userId;
        console.log(`[Server] Relaying offer from ${fromId} to ${targetId}`);
        io.to(targetUser.socketId).emit('webrtc-offer', { fromId, offer, roomId });
      }
    }
  });

  // WebRTC signaling: Answer
  socket.on('webrtc-answer', (data: { roomId: string; targetId: string; answer: unknown }) => {
    const { roomId, targetId, answer } = data;
    const room = rooms.get(roomId);

    if (room) {
      const targetUser = room.users.get(targetId);
      if (targetUser) {
        const fromId = (socket as unknown as { userId: string }).userId;
        console.log(`[Server] Relaying answer from ${fromId} to ${targetId}`);
        io.to(targetUser.socketId).emit('webrtc-answer', { fromId, answer, roomId });
      }
    }
  });

  // WebRTC signaling: ICE Candidate
  socket.on('ice-candidate', (data: { roomId: string; targetId: string; candidate: unknown }) => {
    const { roomId, targetId, candidate } = data;
    const room = rooms.get(roomId);

    if (room) {
      const targetUser = room.users.get(targetId);
      if (targetUser) {
        const fromId = (socket as unknown as { userId: string }).userId;
        io.to(targetUser.socketId).emit('ice-candidate', { fromId, candidate, roomId });
      }
    }
  });

  // User update (status, cursor, etc.)
  socket.on('user-update', (data: { roomId: string; user: User }) => {
    const { roomId, user } = data;
    const room = rooms.get(roomId);

    if (room && room.users.has(user.id)) {
      room.users.set(user.id, { ...user, socketId: socket.id });
      socket.to(roomId).emit('user-updated', { user, roomId });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`[Server] Client disconnected: ${socket.id}`);

    const roomId = (socket as unknown as { roomId: string }).roomId;
    const userId = (socket as unknown as { userId: string }).userId;

    if (roomId && userId) {
      handleUserLeave(socket, roomId, userId);
    }
  });
});

function handleUserLeave(socket: Socket, roomId: string, userId: string): void {
  const room = rooms.get(roomId);

  if (room) {
    const user = room.users.get(userId);
    if (user) {
      console.log(`[Server] User ${user.name} leaving room ${roomId}`);

      room.users.delete(userId);
      socket.leave(roomId);

      // Notify other users
      socket.to(roomId).emit('user-left', { userId, roomId });

      // Clean up empty rooms
      if (room.users.size === 0) {
        rooms.delete(roomId);
        console.log(`[Server] Deleted empty room: ${roomId}`);
      } else if (room.hostId === userId) {
        // Transfer host to next user
        const nextUser = room.users.values().next().value;
        if (nextUser) {
          room.hostId = nextUser.id;
          io.to(roomId).emit('host-changed', { newHostId: nextUser.id, roomId });
          console.log(`[Server] Host transferred to ${nextUser.name}`);
        }
      }
    }
  }
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    uptime: process.uptime(),
  });
});

// Room info endpoint (for debugging)
app.get('/rooms', (_req, res) => {
  const roomInfo = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    userCount: room.users.size,
    hostId: room.hostId,
    createdAt: room.createdAt,
  }));
  res.json(roomInfo);
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`[Server] CodeCollab signaling server running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
});
