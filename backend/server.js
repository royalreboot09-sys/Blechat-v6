/**
 * Realtime Chat V6 — WebSocket Server
 * 
 * Features:
 * - Permanent rooms with Dual Passwords per Unique Room Username:
 *   - Host Password (Master Key for Host / Person X)
 *   - Guest Password (Normal Key for Guest / Person Y)
 * - "Create Room" requires 3 inputs: Unique Username, Host Password, Guest Password
 * - "Join Room" authenticates user as Host or Guest depending on which password they enter
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
 *     roomUsername: string,
 *     hostPassword: string,      // Master Key for Host (Person X)
 *     guestPassword: string,     // Normal Key for Guest (Person Y)
 *     host: WebSocket | null,
 *     client: WebSocket | null,
 *     hostName: string,
 *     clientName: string,
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
            // ===== Create Room with Dual Passwords =====
            case 'create-room': {
                cleanupSocket(ws);
                const roomUsername = sanitize(msg.roomUsername || '').toLowerCase();
                const hostPassword = (msg.hostPassword || '').trim();
                const guestPassword = (msg.guestPassword || '').trim();
                const displayName = sanitize(msg.name) || 'Host';

                if (!roomUsername || roomUsername.length < 3 || roomUsername.length > 20) {
                    sendJSON(ws, { type: 'error', message: 'Room username must be 3-20 characters.' });
                    return;
                }
                if (!/^[a-z0-9_]+$/.test(roomUsername)) {
                    sendJSON(ws, { type: 'error', message: 'Room username: only lowercase letters, numbers, underscores.' });
                    return;
                }
                if (!/^\d{6}$/.test(hostPassword)) {
                    sendJSON(ws, { type: 'error', message: 'Host password (Master Key) must be exactly 6 digits.' });
                    return;
                }
                if (!/^\d{6}$/.test(guestPassword)) {
                    sendJSON(ws, { type: 'error', message: 'Guest password (Normal Key) must be exactly 6 digits.' });
                    return;
                }
                if (hostPassword === guestPassword) {
                    sendJSON(ws, { type: 'error', message: 'Host and Guest passwords must be different!' });
                    return;
                }

                // Check uniqueness
                if (rooms.has(roomUsername)) {
                    sendJSON(ws, { type: 'error', message: `Room username "@${roomUsername}" is already taken! Please choose a different unique username or use "Join Room" to enter.` });
                    return;
                }

                rooms.set(roomUsername, {
                    roomUsername,
                    hostPassword,
                    guestPassword,
                    host: ws,
                    client: null,
                    hostName: displayName,
                    clientName: '',
                    messages: [],
                    lastResetDate: getTodayString()
                });

                ws._roomUsername = roomUsername;
                ws._role = 'host';

                sendJSON(ws, {
                    type: 'room-created',
                    roomUsername,
                    hostPassword,
                    guestPassword,
                    name: displayName,
                    history: []
                });
                console.log(`[ROOM] Room @${roomUsername} created by "${displayName}" with Dual Passwords (Host: ${hostPassword}, Guest: ${guestPassword})`);
                break;
            }

            // ===== Join Room via Password Authentication =====
            case 'join-room': {
                const roomUsername = sanitize(msg.roomUsername || '').toLowerCase();
                const password = (msg.password || '').trim();
                const displayName = sanitize(msg.name) || 'User';

                if (!roomUsername) {
                    sendJSON(ws, { type: 'error', message: 'Enter the room username.' });
                    return;
                }

                if (!rooms.has(roomUsername)) {
                    sendJSON(ws, { type: 'error', message: `Room "@${roomUsername}" does not exist. Check username or create a new room.` });
                    return;
                }

                const room = rooms.get(roomUsername);

                // Authenticate password as Host or Guest
                let isHost = (password === room.hostPassword);
                let isGuest = (password === room.guestPassword);

                if (!isHost && !isGuest) {
                    sendJSON(ws, { type: 'error', message: `Invalid password for room @${roomUsername}. Enter valid Host or Guest password.` });
                    return;
                }

                if (isHost) {
                    // Check if host slot is currently taken
                    if (room.host && room.host.readyState === 1) {
                        sendJSON(ws, { type: 'error', message: `Host slot is already active in room @${roomUsername}.` });
                        return;
                    }

                    cleanupSocket(ws);
                    room.host = ws;
                    room.hostName = displayName;
                    ws._roomUsername = roomUsername;
                    ws._role = 'host';

                    const clientActive = room.client && room.client.readyState === 1;

                    sendJSON(ws, {
                        type: 'room-joined',
                        roomUsername,
                        role: 'host',
                        peerName: clientActive ? room.clientName : '',
                        name: displayName,
                        history: room.messages
                    });

                    if (clientActive) {
                        sendJSON(room.client, { type: 'peer-joined', peerName: displayName });
                    }
                    console.log(`[ROOM] "${displayName}" joined @${roomUsername} as HOST (Master Key)`);
                } else if (isGuest) {
                    // Check if guest slot is currently taken
                    if (room.client && room.client.readyState === 1) {
                        sendJSON(ws, { type: 'error', message: `Guest slot is already active in room @${roomUsername}.` });
                        return;
                    }

                    cleanupSocket(ws);
                    room.client = ws;
                    room.clientName = displayName;
                    ws._roomUsername = roomUsername;
                    ws._role = 'client';

                    const hostActive = room.host && room.host.readyState === 1;

                    sendJSON(ws, {
                        type: 'room-joined',
                        roomUsername,
                        role: 'client',
                        peerName: hostActive ? room.hostName : '',
                        name: displayName,
                        history: room.messages
                    });

                    if (hostActive) {
                        sendJSON(room.host, { type: 'peer-joined', peerName: displayName });
                    }
                    console.log(`[ROOM] "${displayName}" joined @${roomUsername} as GUEST (Normal Key)`);
                }
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

                const senderRole = room.host === ws ? 'host' : 'client';
                const senderName = room.host === ws ? room.hostName : room.clientName;
                const timestamp = new Date().toISOString();
                const msgId = 'm_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
                const replyTo = msg.replyTo || null;

                room.messages.push({ msgId, type: 'text', text, senderRole, senderName, timestamp, replyTo, edited: false });

                if (peer) sendJSON(peer, { type: 'chat-message', text, senderRole, senderName, timestamp, msgId, replyTo });
                sendJSON(ws, { type: 'message-sent', text, senderRole, timestamp, msgId, replyTo });
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

                const senderRole = room.host === ws ? 'host' : 'client';
                const senderName = room.host === ws ? room.hostName : room.clientName;
                const timestamp = new Date().toISOString();
                const msgId = 'm_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

                room.messages.push({ msgId, type: 'media', data: mediaData, mediaType, fileName, senderRole, senderName, timestamp });

                if (peer) sendJSON(peer, { type: 'media-message', data: mediaData, mediaType, fileName, senderRole, senderName, timestamp, msgId });
                sendJSON(ws, { type: 'media-sent', data: mediaData, mediaType, fileName, senderRole, timestamp, msgId });
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

            // ===== Dissolve Room =====
            case 'dissolve-room': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const { roomUsername, room } = result;
                const peer = getPeer(ws, room);
                if (peer) sendJSON(peer, { type: 'room-dissolved', message: 'The room was permanently dissolved.' });
                rooms.delete(roomUsername);
                sendJSON(ws, { type: 'room-dissolved', message: 'You dissolved the room.' });
                console.log(`[ROOM] @${roomUsername} dissolved`);
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
    console.log('  ║      🚀 Realtime Chat V6 Server               ║');
    console.log('  ╠═══════════════════════════════════════════════╣');
    console.log(`  ║  Local:     http://localhost:${PORT}              ║`);
    console.log('  ║  Auth:      Dual Passwords (Host & Guest)     ║');
    console.log('  ║  Capacity:  Max 1 Host + 1 Guest (2 Total)    ║');
    console.log('  ║  Reset:     Automatic 11:59 PM Daily Reset    ║');
    console.log('  ║  Features:  Edit/Delete, Reply, Media, Reader ║');
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');
});
