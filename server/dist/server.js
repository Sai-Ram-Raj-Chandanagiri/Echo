"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
});
const rooms = new Map();
io.on('connection', (socket) => {
    console.log(`[Server] Client connected: ${socket.id}`);
    // Join room
    socket.on('join-room', (data) => {
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
        const room = rooms.get(roomId);
        // Add user to room
        const userWithSocket = { ...user, socketId: socket.id };
        room.users.set(user.id, userWithSocket);
        // Join socket.io room
        socket.join(roomId);
        // Store room info on socket
        socket.roomId = roomId;
        socket.userId = user.id;
        // Send existing users to the new user
        const existingUsers = Array.from(room.users.values()).filter((u) => u.id !== user.id);
        socket.emit('room-users', { users: existingUsers, roomId });
        // Notify other users in the room
        socket.to(roomId).emit('user-joined', { user: userWithSocket, roomId });
        console.log(`[Server] Room ${roomId} now has ${room.users.size} users`);
    });
    // Leave room
    socket.on('leave-room', (data) => {
        const { roomId, userId } = data;
        handleUserLeave(socket, roomId, userId);
    });
    // WebRTC signaling: Offer
    socket.on('webrtc-offer', (data) => {
        const { roomId, targetId, offer } = data;
        const room = rooms.get(roomId);
        if (room) {
            const targetUser = room.users.get(targetId);
            if (targetUser) {
                const fromId = socket.userId;
                console.log(`[Server] Relaying offer from ${fromId} to ${targetId}`);
                io.to(targetUser.socketId).emit('webrtc-offer', { fromId, offer, roomId });
            }
        }
    });
    // WebRTC signaling: Answer
    socket.on('webrtc-answer', (data) => {
        const { roomId, targetId, answer } = data;
        const room = rooms.get(roomId);
        if (room) {
            const targetUser = room.users.get(targetId);
            if (targetUser) {
                const fromId = socket.userId;
                console.log(`[Server] Relaying answer from ${fromId} to ${targetId}`);
                io.to(targetUser.socketId).emit('webrtc-answer', { fromId, answer, roomId });
            }
        }
    });
    // WebRTC signaling: ICE Candidate
    socket.on('ice-candidate', (data) => {
        const { roomId, targetId, candidate } = data;
        const room = rooms.get(roomId);
        if (room) {
            const targetUser = room.users.get(targetId);
            if (targetUser) {
                const fromId = socket.userId;
                io.to(targetUser.socketId).emit('ice-candidate', { fromId, candidate, roomId });
            }
        }
    });
    // User update (status, cursor, etc.)
    socket.on('user-update', (data) => {
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
        const roomId = socket.roomId;
        const userId = socket.userId;
        if (roomId && userId) {
            handleUserLeave(socket, roomId, userId);
        }
    });
});
function handleUserLeave(socket, roomId, userId) {
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
            }
            else if (room.hostId === userId) {
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
