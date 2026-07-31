/**
 * Realtime Chat V4 — WebSocket Server
 * 
 * Features:
 * - Permanent rooms with unique room-username + 6-digit PIN password
 * - Host creates room with a username & password; guest joins by entering both
 * - Max 2 members per room (locked once guest identity assigned, online or offline)
 * - Daily midnight chat reset at 11:59 PM
 * - Real-time Message Edit & Delete
 * - Media sharing, WhatsApp-style replies, Chat download consent, RAR Library reader
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

// ===== Static File Server =====
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
};

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const httpServer = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
    filePath = path.join(FRONTEND_DIR, filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// ===== WebSocket Server =====
const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_MEDIA_SIZE + 1024 * 100
});

/**
 * Permanent Rooms Map:
 * rooms = Map<roomUsername, {
 *     roomUsername: string,        // unique room identifier chosen by host
 *     password: string,           // 6-digit PIN
 *     host: WebSocket | null,     // host's live socket
 *     client: WebSocket | null,   // guest's live socket
 *     hostName: string,           // host's display name
 *     clientName: string,         // guest's display name (locked once set)
 *     clientLocked: boolean,      // true once a guest has joined (even if offline, slot is taken)
 *     messages: Array,
 *     lastResetDate: string
 * }>
 */
const rooms = new Map();

function sendJSON(ws, data) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

function getPeer(ws, room) {
    if (room.host === ws) return room.client;
    if (room.client === ws) return room.host;
    return null;
}

function findRoomBySocket(ws) {
    for (const [key, room] of rooms.entries()) {
        if (room.host === ws || room.client === ws) {
            return { roomUsername: key, room };
        }
    }
    return null;
}

function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== Daily 11:59 PM Reset =====
setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const today = getTodayString();

    if (hours === 23 && minutes === 59) {
        for (const [key, room] of rooms.entries()) {
            if (room.lastResetDate !== today) {
                room.messages = [];
                room.lastResetDate = today;
                console.log(`[RESET] Daily 11:59 PM reset for room @${key}`);
                const resetMsg = {
                    type: 'daily-reset',
                    message: '🌙 Midnight Reset (11:59 PM) — Yesterday\'s chat cleared for a fresh day ✨'
                };
                if (room.host) sendJSON(room.host, resetMsg);
                if (room.client) sendJSON(room.client, resetMsg);
            }
        }
    }
}, 20000);

wss.on('connection', (ws) => {
    console.log(`[CONNECT] Client connected (total: ${wss.clients.size})`);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (rawData) => {
        let msg;
        try {
            msg = JSON.parse(rawData.toString());
        } catch {
            sendJSON(ws, { type: 'error', message: 'Invalid message format' });
            return;
        }

        switch (msg.type) {
            // ===== Create Permanent Room =====
            case 'create-room': {
                cleanupSocket(ws);
                const roomUsername = sanitize(msg.roomUsername || '').toLowerCase();
                const password = (msg.password || '').trim();
                const displayName = sanitize(msg.name) || 'Host';

                if (!roomUsername || roomUsername.length < 3 || roomUsername.length > 20) {
                    sendJSON(ws, { type: 'error', message: 'Room username must be 3-20 characters.' });
                    return;
                }
                if (!/^[a-z0-9_]+$/.test(roomUsername)) {
                    sendJSON(ws, { type: 'error', message: 'Room username: only lowercase letters, numbers, underscores.' });
                    return;
                }
                if (!/^\d{6}$/.test(password)) {
                    sendJSON(ws, { type: 'error', message: 'Password must be exactly 6 digits.' });
                    return;
                }

                if (rooms.has(roomUsername)) {
                    const existing = rooms.get(roomUsername);
                    // Allow host to reclaim their room if disconnected
                    if (!existing.host && existing.password === password) {
                        existing.host = ws;
                        existing.hostName = displayName;
                        ws._roomUsername = roomUsername;
                        ws._role = 'host';
                        sendJSON(ws, {
                            type: 'room-created',
                            roomUsername,
                            name: displayName,
                            history: existing.messages
                        });
                        if (existing.client) {
                            sendJSON(existing.client, { type: 'peer-joined', peerName: displayName });
                            sendJSON(ws, { type: 'peer-joined', peerName: existing.clientName });
                        }
                        console.log(`[ROOM] Host reclaimed room @${roomUsername}`);
                        return;
                    }
                    sendJSON(ws, { type: 'error', message: `Room username "@${roomUsername}" is already taken. Choose a different one.` });
                    return;
                }

                rooms.set(roomUsername, {
                    roomUsername,
                    password,
                    host: ws,
                    client: null,
                    hostName: displayName,
                    clientName: '',
                    clientLocked: false,
                    messages: [],
                    lastResetDate: getTodayString()
                });

                ws._roomUsername = roomUsername;
                ws._role = 'host';

                sendJSON(ws, { type: 'room-created', roomUsername, name: displayName, history: [] });
                console.log(`[ROOM] Permanent room @${roomUsername} created by "${displayName}"`);
                break;
            }

            // ===== Join Permanent Room =====
            case 'join-room': {
                const roomUsername = sanitize(msg.roomUsername || '').toLowerCase();
                const password = (msg.password || '').trim();
                const displayName = sanitize(msg.name) || 'Guest';

                if (!roomUsername) {
                    sendJSON(ws, { type: 'error', message: 'Enter the room username.' });
                    return;
                }

                if (!rooms.has(roomUsername)) {
                    sendJSON(ws, { type: 'error', message: `Room "@${roomUsername}" not found.` });
                    return;
                }

                const room = rooms.get(roomUsername);

                // Verify password
                if (room.password !== password) {
                    sendJSON(ws, { type: 'error', message: 'Wrong password. Ask the host for the correct 6-digit PIN.' });
                    return;
                }

                // If room already has a locked client, only allow that same person back
                if (room.clientLocked && room.clientName && room.clientName !== displayName) {
                    sendJSON(ws, { type: 'error', message: `Room is full. Only "${room.clientName}" can rejoin as guest.` });
                    return;
                }

                // If client socket is already alive, reject
                if (room.client && room.client.readyState === 1) {
                    sendJSON(ws, { type: 'error', message: 'Room is full (2 active users max).' });
                    return;
                }

                cleanupSocket(ws);
                room.client = ws;
                room.clientName = displayName;
                room.clientLocked = true; // Lock the guest slot permanently
                ws._roomUsername = roomUsername;
                ws._role = 'client';

                sendJSON(ws, {
                    type: 'room-joined',
                    roomUsername,
                    peerName: room.hostName,
                    name: displayName,
                    history: room.messages
                });

                if (room.host) {
                    sendJSON(room.host, { type: 'peer-joined', peerName: displayName });
                }

                console.log(`[ROOM] "${displayName}" joined room @${roomUsername} (slot locked)`);
                break;
            }

            // ===== Text Message =====
            case 'chat-message': {
                const result = findRoomBySocket(ws);
                if (!result) { sendJSON(ws, { type: 'error', message: 'Not in a room.' }); return; }
                const { room } = result;
                const peer = getPeer(ws, room);
                const text = (msg.text || '').trim();
                if (!text || text.length > 2000) return;

                const senderName = room.host === ws ? room.hostName : room.clientName;
                const timestamp = new Date().toISOString();
                const msgId = 'm_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
                const replyTo = msg.replyTo || null;

                room.messages.push({ msgId, type: 'text', text, senderName, timestamp, replyTo, edited: false });

                if (peer) sendJSON(peer, { type: 'chat-message', text, senderName, timestamp, msgId, replyTo });
                sendJSON(ws, { type: 'message-sent', text, timestamp, msgId, replyTo });
                break;
            }

            // ===== Edit Message =====
            case 'edit-message': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { room } = result;
                const peer = getPeer(ws, room);
                const { msgId, newText } = msg;
                if (!msgId || !newText || newText.trim().length === 0) return;

                const trimmed = newText.trim();
                const msgObj = room.messages.find(m => m.msgId === msgId);
                if (msgObj) { msgObj.text = trimmed; msgObj.edited = true; }

                const editPayload = { type: 'message-edited', msgId, newText: trimmed };
                sendJSON(ws, editPayload);
                if (peer) sendJSON(peer, editPayload);
                break;
            }

            // ===== Delete Message =====
            case 'delete-message': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { room } = result;
                const peer = getPeer(ws, room);
                const { msgId } = msg;
                if (!msgId) return;

                const idx = room.messages.findIndex(m => m.msgId === msgId);
                if (idx !== -1) room.messages.splice(idx, 1);

                const deletePayload = { type: 'message-deleted', msgId };
                sendJSON(ws, deletePayload);
                if (peer) sendJSON(peer, deletePayload);
                break;
            }

            // ===== Media Message =====
            case 'media-message': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { room } = result;
                const peer = getPeer(ws, room);
                const { data: mediaData, mediaType, fileName, fileSize } = msg;
                if (!mediaData || !mediaType) return;

                const allowedTypes = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm'];
                if (!allowedTypes.includes(mediaType)) {
                    sendJSON(ws, { type: 'error', message: 'Unsupported file type.' });
                    return;
                }
                if (fileSize && fileSize > MAX_MEDIA_SIZE) {
                    sendJSON(ws, { type: 'error', message: 'File too large (max 10MB).' });
                    return;
                }

                const senderName = room.host === ws ? room.hostName : room.clientName;
                const timestamp = new Date().toISOString();
                const msgId = 'm_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

                room.messages.push({ msgId, type: 'media', data: mediaData, mediaType, fileName, senderName, timestamp });

                if (peer) sendJSON(peer, { type: 'media-message', data: mediaData, mediaType, fileName, senderName, timestamp, msgId });
                sendJSON(ws, { type: 'media-sent', data: mediaData, mediaType, fileName, timestamp, msgId });
                break;
            }

            case 'typing': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const peer = getPeer(ws, result.room);
                if (peer) sendJSON(peer, { type: 'typing', isTyping: msg.isTyping });
                break;
            }

            // ===== Download Consent =====
            case 'download-request': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { room } = result;
                const peer = getPeer(ws, room);
                const requesterName = room.host === ws ? room.hostName : room.clientName;
                if (peer) sendJSON(peer, { type: 'download-request', requesterName });
                break;
            }

            case 'download-response': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { room } = result;
                const peer = getPeer(ws, room);
                const responderName = room.host === ws ? room.hostName : room.clientName;
                if (peer) sendJSON(peer, { type: 'download-response', allowed: msg.allowed, responderName });
                break;
            }

            // ===== Dissolve Permanent Room (host only) =====
            case 'dissolve-room': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { roomUsername, room } = result;
                if (room.host !== ws) {
                    sendJSON(ws, { type: 'error', message: 'Only the host can dissolve the room.' });
                    return;
                }
                const peer = getPeer(ws, room);
                if (peer) sendJSON(peer, { type: 'room-dissolved', message: 'The host has permanently dissolved the room.' });
                rooms.delete(roomUsername);
                sendJSON(ws, { type: 'room-dissolved', message: 'You dissolved the room.' });
                console.log(`[ROOM] @${roomUsername} dissolved by host`);
                break;
            }

            case 'leave-room': {
                handleLeave(ws);
                break;
            }

            default:
                sendJSON(ws, { type: 'error', message: `Unknown type: ${msg.type}` });
        }
    });

    ws.on('close', () => {
        console.log(`[DISCONNECT] Client disconnected (total: ${wss.clients.size})`);
        handleLeave(ws);
    });
    ws.on('error', (err) => console.error(`[ERROR]`, err.message));
});

function handleLeave(ws) {
    const result = findRoomBySocket(ws);
    if (!result) return;
    const { roomUsername, room } = result;
    const peer = getPeer(ws, room);
    const leaverName = room.host === ws ? room.hostName : room.clientName;

    // Just disconnect the socket, keep the room permanent
    if (ws === room.host) {
        room.host = null;
    } else if (ws === room.client) {
        room.client = null;
    }

    if (peer) sendJSON(peer, { type: 'peer-left', peerName: leaverName });
    console.log(`[LEAVE] "${leaverName}" left room @${roomUsername} (room preserved)`);
}

function cleanupSocket(ws) {
    const result = findRoomBySocket(ws);
    if (result) handleLeave(ws);
}

function sanitize(str) {
    if (!str) return '';
    return str.replace(/[<>&"']/g, '').trim().substring(0, 30);
}

// Heartbeat
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
wss.on('close', () => clearInterval(heartbeatInterval));

httpServer.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════╗');
    console.log('  ║      🚀 Realtime Chat V4 Server               ║');
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log(`  ║  Local:     http://localhost:${PORT}              ║`);
    console.log('  ║  Auth:      Room Username + 6-digit Password  ║');
    console.log('  ║  Reset:     Automatic 11:59 PM Daily Reset    ║');
    console.log('  ║  Features:  Edit/Delete, Reply, Media, Reader ║');
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');
});
