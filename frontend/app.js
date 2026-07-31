/**
 * Realtime Chat V6 — Frontend Application
 * Features:
 * - Permanent rooms with Dual Passwords (Host Password & Guest Password)
 * - "Create Room" sets Unique Room Username, Host PIN & Guest PIN
 * - "Join Room" authenticates as Host or Guest depending on PIN entered
 * - Daily 11:59 PM chat reset
 * - Message Edit & Delete
 * - RAR Library story reader (10 pages)
 * - Media sharing, WhatsApp-style replies, Chat download consent
 */

const $ = (id) => document.getElementById(id);

const DOM = {
    statusRow: $('status-row'), statusDot: $('status-dot'), statusText: $('status-text'),
    headerTitle: $('header-title'), btnLeave: $('btn-leave'), btnDissolve: $('btn-dissolve'),
    lobby: $('lobby'), inputName: $('input-name'),
    inputRoomUsername: $('input-room-username'),
    inputCreateHostPin: $('input-create-host-pin'),
    inputCreateGuestPin: $('input-create-guest-pin'),
    btnCreate: $('btn-create'),
    inputJoinUsername: $('input-join-username'),
    inputCode: $('input-code'), btnJoin: $('btn-join'),
    waitingScreen: $('waiting-screen'),
    waitingHostPin: $('waiting-host-pin'),
    waitingGuestPin: $('waiting-guest-pin'),
    waitingRoomUsername: $('waiting-room-username'),
    btnCopy: $('btn-copy'), copyLabel: $('copy-label'), btnCancelWait: $('btn-cancel-wait'),
    chatScreen: $('chat-screen'), peerBar: $('peer-bar'),
    peerName: $('peer-name'), typingIndicator: $('typing-indicator'),
    chatMessages: $('chat-messages'), inputBar: $('input-bar'),
    msgInput: $('msg-input'), btnSend: $('btn-send'),
    btnAttach: $('btn-attach'), fileInput: $('file-input'),
    previewModal: $('media-preview-modal'), previewFilename: $('media-preview-filename'),
    previewBody: $('media-preview-body'), previewSize: $('media-preview-size'),
    btnPreviewClose: $('btn-preview-close'), btnMediaSend: $('btn-media-send'),
    lightbox: $('media-lightbox'), lightboxContent: $('media-lightbox-content'),
    btnLightboxClose: $('btn-lightbox-close'),
    // Edit Modal
    editModal: $('edit-modal'), editInput: $('edit-input'),
    btnEditSave: $('btn-edit-save'), btnEditCancel: $('btn-edit-cancel'),
    // V3-V6 elements
    modeToggle: $('mode-toggle'), modeSwitch: $('mode-switch'),
    btnDownloadChat: $('btn-download-chat'),
    pdfViewerScreen: $('pdf-viewer-screen'),
    replyBar: $('reply-bar'), replyBarName: $('reply-bar-name'),
    replyBarMsg: $('reply-bar-msg'), btnReplyClose: $('btn-reply-close'),
    consentModal: $('consent-modal'), consentTitle: $('consent-title'),
    consentMessage: $('consent-message'), btnConsentAllow: $('btn-consent-allow'),
    btnConsentDeny: $('btn-consent-deny'),
    toast: $('toast'), errorOverlay: $('error-overlay'),
    errorTitle: $('error-title'), errorMessage: $('error-message'),
    btnReconnect: $('btn-error-reconnect'), btnHome: $('btn-error-home'),
};

// ===== State =====
const State = {
    ws: null, roomUsername: null, pin: null, hostPassword: null, guestPassword: null, role: null, myName: '', peerName: '',
    connected: false, typingTimeout: null,
    reconnectAttempts: 0, maxReconnect: 5,
    pendingMedia: null, _pendingAction: null,
    chatHistory: [],
    replyTo: null,
    editingMsgId: null,
    pdfMode: false,
    currentPageIndex: 0,
    pages: [
        { page: 1, file: 'page1.png', title: 'An Old Dog' },
        { page: 2, file: 'page2.png', title: 'Joke about a Bed' },
        { page: 3, file: 'page3.png', title: 'Petrol Station' },
        { page: 4, file: 'page4.png', title: 'Frying Pan' },
        { page: 5, file: 'page5.png', title: 'Hot Summer Day' },
        { page: 6, file: 'page6.png', title: 'Game' },
        { page: 7, file: 'page7.png', title: 'Photographer' },
        { page: 8, file: 'page8.png', title: 'Swimmer' },
        { page: 9, file: 'page9.png', title: 'Optimist' },
        { page: 10, file: 'page10.png', title: 'Best Friend' }
    ]
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('chat-username');
    if (savedName) DOM.inputName.value = savedName;
    attachListeners();
    connectWebSocket();
});

// ===== Event Listeners =====
function attachListeners() {
    DOM.btnCreate.addEventListener('click', createRoom);
    DOM.btnJoin.addEventListener('click', joinRoom);
    DOM.btnCancelWait.addEventListener('click', leaveRoom);
    DOM.btnLeave.addEventListener('click', leaveRoom);
    DOM.btnDissolve.addEventListener('click', dissolveRoom);
    DOM.btnCopy.addEventListener('click', copyRoomCode);
    DOM.btnSend.addEventListener('click', sendMessage);
    DOM.btnReconnect.addEventListener('click', () => { DOM.errorOverlay.classList.add('hidden'); connectWebSocket(); });
    DOM.btnHome.addEventListener('click', () => { DOM.errorOverlay.classList.add('hidden'); resetToLobby(); });

    DOM.msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    DOM.msgInput.addEventListener('input', () => {
        DOM.btnSend.disabled = DOM.msgInput.value.trim().length === 0;
        sendTypingSignal(true);
    });

    DOM.inputCreateHostPin.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    DOM.inputCreateGuestPin.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    DOM.inputCode.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    DOM.inputRoomUsername.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20).toLowerCase(); });
    DOM.inputJoinUsername.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20).toLowerCase(); });

    DOM.inputCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

    // Media
    DOM.btnAttach.addEventListener('click', () => DOM.fileInput.click());
    DOM.fileInput.addEventListener('change', handleFileSelect);
    DOM.btnPreviewClose.addEventListener('click', closePreview);
    DOM.btnMediaSend.addEventListener('click', sendMedia);
    DOM.btnLightboxClose.addEventListener('click', closeLightbox);
    DOM.lightbox.querySelector('.media-lightbox-backdrop').addEventListener('click', closeLightbox);

    // Reply & Edit
    DOM.btnReplyClose.addEventListener('click', cancelReply);
    DOM.btnEditSave.addEventListener('click', saveEditMessage);
    DOM.btnEditCancel.addEventListener('click', closeEditModal);

    // Download chat
    DOM.btnDownloadChat.addEventListener('click', requestDownload);
    DOM.btnConsentAllow.addEventListener('click', () => respondToDownload(true));
    DOM.btnConsentDeny.addEventListener('click', () => respondToDownload(false));

    // PDF mode toggle & Story Reader navigation
    DOM.modeSwitch.addEventListener('change', togglePdfMode);
    $('btn-reader-prev').addEventListener('click', prevStoryPage);
    $('btn-reader-next').addEventListener('click', nextStoryPage);
    document.addEventListener('keydown', handleReaderKeyPress);
}

// ===== WebSocket =====
function isConnected() { return State.ws && State.ws.readyState === WebSocket.OPEN; }

function connectWebSocket() {
    if (State.ws && (State.ws.readyState === WebSocket.OPEN || State.ws.readyState === WebSocket.CONNECTING)) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${location.host}`;
    setStatus('waiting', 'Connecting…');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        State.ws = ws; State.reconnectAttempts = 0;
        setStatus('connected', 'Connected to server');
        if (State._pendingAction) { const a = State._pendingAction; State._pendingAction = null; a(); }
        if (State.roomUsername && State.pin) {
            ws.send(JSON.stringify({
                type: 'join-room',
                roomUsername: State.roomUsername,
                password: State.pin,
                name: State.myName
            }));
        }
    };
    ws.onmessage = (event) => {
        let msg; try { msg = JSON.parse(event.data); } catch { return; }
        handleServerMessage(msg);
    };
    ws.onclose = () => {
        State.ws = null;
        if (State.connected) {
            State.connected = false; setStatus('disconnected', 'Disconnected');
            showError('Connection Lost', 'WebSocket closed. Try reconnecting.');
        } else {
            if (State.reconnectAttempts < State.maxReconnect) {
                State.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, State.reconnectAttempts), 10000);
                setStatus('waiting', 'Reconnecting…');
                setTimeout(connectWebSocket, delay);
            } else {
                setStatus('disconnected', 'Disconnected');
                showError('Cannot Connect', 'Server unreachable.');
            }
        }
    };
    ws.onerror = () => {};
}

function ensureConnected(action) {
    if (isConnected()) { action(); return; }
    showToast('Reconnecting…'); setStatus('waiting', 'Reconnecting…');
    State.reconnectAttempts = 0; State._pendingAction = action; connectWebSocket();
}

// ===== Server Message Handler =====
function handleServerMessage(msg) {
    switch (msg.type) {
        case 'room-created':
            State.roomUsername = msg.roomUsername;
            State.hostPassword = msg.hostPassword;
            State.guestPassword = msg.guestPassword;
            State.pin = msg.hostPassword;
            State.role = 'host';
            State.myName = msg.name;
            showWaitingScreen(msg.roomUsername, msg.hostPassword, msg.guestPassword);
            setStatus('waiting', 'Room Created! Share Guest Password…');
            if (msg.history && msg.history.length > 0) loadHistory(msg.history);
            break;

        case 'room-joined':
            State.roomUsername = msg.roomUsername;
            State.role = msg.role;
            State.myName = msg.name;
            State.peerName = msg.peerName || '';
            State.connected = true;
            showChatScreen(msg.peerName || 'Waiting for peer…');
            setStatus('connected', msg.peerName ? `Connected to ${msg.peerName}` : `Joined room @${msg.roomUsername} (${msg.role.toUpperCase()})`);
            addSystemMsg(`You joined room @${msg.roomUsername} as ${msg.role.toUpperCase()}`);
            if (msg.history && msg.history.length > 0) loadHistory(msg.history);
            break;

        case 'peer-joined':
            State.peerName = msg.peerName; State.connected = true;
            showChatScreen(msg.peerName); setStatus('connected', `Connected to ${msg.peerName}`);
            addSystemMsg(`${msg.peerName} joined the chat`); break;

        case 'chat-message':
            addChatMessage(msg.text, 'received', msg.timestamp, msg.msgId, msg.replyTo, msg.senderName); break;
        case 'message-sent':
            addChatMessage(msg.text, 'sent', msg.timestamp, msg.msgId, msg.replyTo, State.myName); break;

        case 'media-message':
            addMediaMessage(msg.data, msg.mediaType, msg.fileName, 'received', msg.timestamp, msg.msgId, msg.senderName); break;
        case 'media-sent':
            addMediaMessage(msg.data, msg.mediaType, msg.fileName, 'sent', msg.timestamp, msg.msgId, State.myName); break;

        // ===== Edit / Delete Message Events =====
        case 'message-edited': {
            const row = document.querySelector(`.msg-row[data-msg-id="${msg.msgId}"]`);
            if (row) {
                const textEl = row.querySelector('.msg-text');
                if (textEl) {
                    textEl.textContent = msg.newText;
                    if (!row.querySelector('.edited-tag')) {
                        const tag = document.createElement('span');
                        tag.className = 'edited-tag';
                        tag.textContent = '(edited)';
                        textEl.appendChild(tag);
                    }
                }
            }
            const item = State.chatHistory.find(m => m.msgId === msg.msgId);
            if (item) { item.text = msg.newText; item.edited = true; }
            showToast('Message edited');
            break;
        }

        case 'message-deleted': {
            const row = document.querySelector(`.msg-row[data-msg-id="${msg.msgId}"]`);
            if (row) {
                row.remove();
            }
            State.chatHistory = State.chatHistory.filter(m => m.msgId !== msg.msgId);
            showToast('Message deleted');
            break;
        }

        // ===== Daily 11:59 PM Reset =====
        case 'daily-reset':
            DOM.chatMessages.innerHTML = `<div class="chat-welcome"><div class="welcome-icon">💬</div><p>Dual-Key room active! Say hello.<br><small style="opacity:0.7">Chats auto-reset at 11:59 PM daily.</small></p></div>`;
            State.chatHistory = [];
            addSystemMsg(msg.message || '🌙 Midnight Reset — Chat history cleared for the new day ✨');
            break;

        case 'typing': showTyping(msg.isTyping); break;

        case 'peer-left':
            State.connected = false; addSystemMsg(`${msg.peerName} left the room`);
            setStatus('waiting', 'Peer disconnected'); showTyping(false); break;

        case 'room-dissolved':
            State.connected = false; State.pin = null; State.roomUsername = null;
            setStatus('disconnected', 'Room dissolved');
            showToast(msg.message || 'Room was dissolved by host');
            setTimeout(resetToLobby, 2500); break;

        // Download consent
        case 'download-request':
            DOM.consentMessage.textContent = `${msg.requesterName} wants to download the chat history. Allow?`;
            DOM.consentModal.classList.remove('hidden'); break;
        case 'download-response':
            DOM.consentModal.classList.add('hidden');
            if (msg.allowed) { showToast(`${msg.responderName} allowed the download`); performDownload(); }
            else { showToast(`${msg.responderName} denied the download`); }
            break;

        case 'error': showToast(msg.message); break;
    }
}

// ===== Room Actions =====
function createRoom() {
    const name = DOM.inputName.value.trim() || 'Host';
    const roomUsername = DOM.inputRoomUsername.value.trim().toLowerCase();
    const hostPassword = DOM.inputCreateHostPin.value.trim();
    const guestPassword = DOM.inputCreateGuestPin.value.trim();

    if (!roomUsername || roomUsername.length < 3) {
        showToast('Room username must be at least 3 characters');
        return;
    }
    if (hostPassword.length !== 6) {
        showToast('Enter a 6-digit Host Password (Master Key)');
        return;
    }
    if (guestPassword.length !== 6) {
        showToast('Enter a 6-digit Guest Password (Normal Key)');
        return;
    }
    if (hostPassword === guestPassword) {
        showToast('Host and Guest passwords must be different!');
        return;
    }

    State.myName = name;
    State.roomUsername = roomUsername;
    State.hostPassword = hostPassword;
    State.guestPassword = guestPassword;
    State.pin = hostPassword;
    localStorage.setItem('chat-username', name);

    ensureConnected(() => {
        State.ws.send(JSON.stringify({
            type: 'create-room',
            name: State.myName,
            roomUsername,
            hostPassword,
            guestPassword
        }));
    });
}

function joinRoom() {
    const name = DOM.inputName.value.trim() || 'User';
    const roomUsername = DOM.inputJoinUsername.value.trim().toLowerCase();
    const pin = DOM.inputCode.value.trim();

    if (!roomUsername) {
        showToast('Enter the room username');
        return;
    }
    if (pin.length !== 6) {
        showToast('Enter the 6-digit password');
        return;
    }

    State.myName = name;
    State.pin = pin;
    State.roomUsername = roomUsername;
    localStorage.setItem('chat-username', name);

    ensureConnected(() => {
        State.ws.send(JSON.stringify({ type: 'join-room', roomUsername, password: pin, name: State.myName }));
    });
}

function dissolveRoom() {
    if (confirm('Are you sure you want to permanently dissolve this room? All history will be deleted.')) {
        if (isConnected()) State.ws.send(JSON.stringify({ type: 'dissolve-room' }));
    }
}

function leaveRoom() {
    if (isConnected()) State.ws.send(JSON.stringify({ type: 'leave-room' }));
    State.pin = null; State.roomUsername = null; State.connected = false; State.peerName = '';
    State.chatHistory = []; resetToLobby();
}

function sendMessage() {
    const text = DOM.msgInput.value.trim();
    if (!text) return;
    if (!isConnected()) { showToast('Reconnecting…'); State.reconnectAttempts = 0; connectWebSocket(); return; }

    const payload = { type: 'chat-message', text };
    if (State.replyTo) {
        payload.replyTo = { msgId: State.replyTo.msgId, text: State.replyTo.text, sender: State.replyTo.sender };
    }
    State.ws.send(JSON.stringify(payload));
    DOM.msgInput.value = ''; DOM.btnSend.disabled = true;
    sendTypingSignal(false); cancelReply();
}

function sendTypingSignal(isTyping) {
    if (!State.ws || !State.connected) return;
    clearTimeout(State.typingTimeout);
    if (isTyping) {
        State.ws.send(JSON.stringify({ type: 'typing', isTyping: true }));
        State.typingTimeout = setTimeout(() => {
            if (State.ws && State.connected) State.ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
        }, 2000);
    } else {
        State.ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
    }
}

function copyRoomCode() {
    const text = `Room: @${State.roomUsername || '---'}\nHost Password (Master): ${State.hostPassword || '------'}\nGuest Password (Normal): ${State.guestPassword || '------'}`;
    navigator.clipboard.writeText(text).then(() => {
        DOM.copyLabel.textContent = 'Copied!'; DOM.btnCopy.classList.add('copied');
        setTimeout(() => { DOM.copyLabel.textContent = 'Copy Credentials'; DOM.btnCopy.classList.remove('copied'); }, 2000);
    }).catch(() => showToast('Failed to copy'));
}

// ===== Edit & Delete Features =====
function openEditModal(msgId, currentText) {
    State.editingMsgId = msgId;
    DOM.editInput.value = currentText;
    DOM.editModal.classList.remove('hidden');
    DOM.editInput.focus();
}

function closeEditModal() {
    State.editingMsgId = null;
    DOM.editModal.classList.add('hidden');
}

function saveEditMessage() {
    const newText = DOM.editInput.value.trim();
    if (!newText || !State.editingMsgId) return;
    if (!isConnected()) { showToast('Reconnecting…'); return; }

    State.ws.send(JSON.stringify({
        type: 'edit-message',
        msgId: State.editingMsgId,
        newText
    }));

    closeEditModal();
}

function deleteMessage(msgId) {
    if (confirm('Delete this message for everyone?')) {
        if (isConnected()) {
            State.ws.send(JSON.stringify({ type: 'delete-message', msgId }));
        }
    }
}

// ===== Reply Feature =====
function setReply(msgId, text, sender) {
    State.replyTo = { msgId, text, sender };
    DOM.replyBarName.textContent = sender === State.myName ? 'You' : sender;
    DOM.replyBarMsg.textContent = text || '📎 Media';
    DOM.replyBar.classList.remove('hidden');
    DOM.msgInput.focus();
}
function cancelReply() { State.replyTo = null; DOM.replyBar.classList.add('hidden'); }

// ===== Chat History Loader =====
function loadHistory(messages) {
    DOM.chatMessages.innerHTML = `<div class="chat-welcome"><div class="welcome-icon">💬</div><p>Dual-Key room active! Say hello.<br><small style="opacity:0.7">Chats auto-reset at 11:59 PM daily.</small></p></div>`;
    State.chatHistory = [];
    messages.forEach(m => {
        if (m.type === 'text') {
            addChatMessage(m.text, m.senderName === State.myName ? 'sent' : 'received', m.timestamp, m.msgId, m.replyTo, m.senderName);
        } else if (m.type === 'media') {
            addMediaMessage(m.data, m.mediaType, m.fileName, m.senderName === State.myName ? 'sent' : 'received', m.timestamp, m.msgId, m.senderName);
        }
    });
}

// ===== Chat Download Consent =====
function requestDownload() {
    if (!isConnected() || !State.connected) { showToast('Not in an active chat'); return; }
    if (State.chatHistory.length === 0) { showToast('No messages to download'); return; }
    State.ws.send(JSON.stringify({ type: 'download-request' }));
    showToast('Waiting for permission…');
}
function respondToDownload(allowed) {
    DOM.consentModal.classList.add('hidden');
    if (isConnected()) State.ws.send(JSON.stringify({ type: 'download-response', allowed }));
    if (allowed) showToast('Download allowed');
}
function performDownload() {
    let txt = `Chat History — Room: @${State.roomUsername || 'N/A'}\n`;
    txt += `Date: ${new Date().toLocaleString()}\n`;
    txt += `Participants: ${State.myName}, ${State.peerName}\n`;
    txt += '─'.repeat(40) + '\n\n';

    State.chatHistory.forEach(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
        if (entry.type === 'system') {
            txt += `  --- ${entry.text} ---\n`;
        } else if (entry.mediaType) {
            txt += `[${time}] ${entry.sender}: [${entry.mediaType.startsWith('video') ? 'Video' : 'Photo'}: ${entry.fileName}]\n`;
        } else {
            if (entry.replyTo) {
                txt += `[${time}] ${entry.sender} (replying to "${entry.replyTo.text?.substring(0,30)}"):\n  ${entry.text}\n`;
            } else {
                txt += `[${time}] ${entry.sender}: ${entry.text}\n`;
            }
        }
    });

    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${State.roomUsername || 'history'}-${Date.now()}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Chat downloaded!');
}

// ===== RAR Library Story Reader =====
function togglePdfMode() {
    State.pdfMode = DOM.modeSwitch.checked;
    if (State.pdfMode) {
        DOM.headerTitle.textContent = 'RAR Library';
        DOM.statusRow.classList.add('hidden');
        DOM.btnDownloadChat.classList.add('hidden');
        DOM.pdfViewerScreen.classList.remove('hidden');
        showStoryPage(State.currentPageIndex || 0);
    } else {
        DOM.headerTitle.textContent = 'Realtime Chat V6';
        DOM.statusRow.classList.remove('hidden');
        if (State.connected) {
            DOM.btnDownloadChat.classList.remove('hidden');
        }
        DOM.pdfViewerScreen.classList.add('hidden');
    }
}

function showStoryPage(index) {
    if (index < 0 || index >= State.pages.length) return;
    State.currentPageIndex = index;
    const item = State.pages[index];

    const img = $('reader-img');
    img.classList.add('page-flip');

    setTimeout(() => {
        img.src = `/pages/${item.file}`;
        img.alt = item.title;
        img.classList.remove('page-flip');
    }, 150);

    $('reader-page-counter').textContent = `Page ${item.page} of ${State.pages.length}`;
    $('reader-page-title').textContent = item.title;

    $('btn-reader-prev').disabled = index === 0;
    $('btn-reader-next').disabled = index === State.pages.length - 1;
}

function prevStoryPage() {
    if (State.currentPageIndex > 0) showStoryPage(State.currentPageIndex - 1);
}
function nextStoryPage() {
    if (State.currentPageIndex < State.pages.length - 1) showStoryPage(State.currentPageIndex + 1);
}
function handleReaderKeyPress(e) {
    if (!State.pdfMode) return;
    if (e.key === 'ArrowLeft') prevStoryPage();
    if (e.key === 'ArrowRight') nextStoryPage();
}

// ===== Media Handling =====
function handleFileSelect(e) {
    const file = e.target.files[0]; if (!file) return;
    DOM.fileInput.value = '';
    const allowedTypes = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm'];
    if (!allowedTypes.includes(file.type)) { showToast('Only images and videos are supported'); return; }
    if (file.size > MAX_FILE_SIZE) { showToast(`File too large (${formatSize(file.size)}). Max 10MB.`); return; }
    const reader = new FileReader();
    reader.onload = (evt) => {
        State.pendingMedia = { data: evt.target.result, mediaType: file.type, fileName: file.name, fileSize: file.size };
        showPreview(evt.target.result, file.type, file.name, file.size);
    };
    reader.readAsDataURL(file);
}
function showPreview(dataUrl, mediaType, fileName, fileSize) {
    DOM.previewFilename.textContent = fileName;
    DOM.previewSize.textContent = formatSize(fileSize);
    DOM.previewBody.innerHTML = '';
    if (mediaType.startsWith('video')) {
        const v = document.createElement('video'); v.src = dataUrl; v.controls = true; v.muted = true;
        v.style.cssText = 'max-width:100%;max-height:60vh'; DOM.previewBody.appendChild(v);
    } else {
        const img = document.createElement('img'); img.src = dataUrl; img.alt = fileName;
        img.style.cssText = 'max-width:100%;max-height:60vh'; DOM.previewBody.appendChild(img);
    }
    DOM.previewModal.classList.remove('hidden');
}
function closePreview() { DOM.previewModal.classList.add('hidden'); DOM.previewBody.innerHTML = ''; State.pendingMedia = null; }
function sendMedia() {
    if (!State.pendingMedia) return;
    if (!isConnected()) { showToast('Reconnecting…'); connectWebSocket(); return; }
    const { data, mediaType, fileName, fileSize } = State.pendingMedia;
    State.ws.send(JSON.stringify({ type: 'media-message', data, mediaType, fileName, fileSize }));
    closePreview();
}

// ===== Render Messages =====
function addChatMessage(text, type, timestamp, msgId, replyTo, senderName) {
    State.chatHistory.push({ type: type === 'sent' ? 'sent' : 'received', text, sender: senderName || (type === 'sent' ? State.myName : State.peerName), timestamp, msgId, replyTo });

    const row = document.createElement('div');
    row.className = `msg-row ${type}`;
    row.dataset.msgId = msgId || '';

    const time = timestamp ? new Date(timestamp) : new Date();
    const timeStr = time.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-row-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (replyTo && replyTo.text) {
        const quote = document.createElement('div');
        quote.className = 'reply-quote';
        quote.innerHTML = `<span class="reply-quote-name">${escapeHTML(replyTo.sender || 'Unknown')}</span>${escapeHTML(replyTo.text.substring(0, 80))}`;
        bubble.appendChild(quote);
    }

    const msgText = document.createElement('div');
    msgText.className = 'msg-text';
    msgText.textContent = text;
    bubble.appendChild(msgText);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span class="msg-time">${timeStr}</span>`;
    bubble.appendChild(meta);

    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'msg-actions-group';

    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn'; replyBtn.title = 'Reply';
    replyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>`;
    replyBtn.addEventListener('click', () => {
        const sender = type === 'sent' ? State.myName : State.peerName;
        setReply(msgId, text, sender);
    });
    actionsGroup.appendChild(replyBtn);

    if (type === 'sent') {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn'; editBtn.title = 'Edit';
        editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
        editBtn.addEventListener('click', () => openEditModal(msgId, text));
        actionsGroup.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'msg-action-btn delete-btn'; deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;
        deleteBtn.addEventListener('click', () => deleteMessage(msgId));
        actionsGroup.appendChild(deleteBtn);
    }

    wrapper.appendChild(bubble);
    wrapper.appendChild(actionsGroup);
    row.appendChild(wrapper);
    DOM.chatMessages.appendChild(row);
    scrollToBottom();
}

function addMediaMessage(dataUrl, mediaType, fileName, type, timestamp, msgId, senderName) {
    State.chatHistory.push({ type: type === 'sent' ? 'sent' : 'received', sender: senderName || (type === 'sent' ? State.myName : State.peerName), timestamp, msgId, mediaType, fileName, text: null });

    const row = document.createElement('div');
    row.className = `msg-row ${type}`;
    row.dataset.msgId = msgId || '';

    const time = timestamp ? new Date(timestamp) : new Date();
    const timeStr = time.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
    const isVideo = mediaType.startsWith('video');

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-row-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    const container = document.createElement('div');
    container.className = 'media-container';

    if (isVideo) {
        const video = document.createElement('video');
        video.src = dataUrl; video.preload = 'metadata'; video.muted = true; video.playsInline = true;
        container.appendChild(video);
        const play = document.createElement('div');
        play.className = 'media-play-overlay';
        play.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>`;
        container.appendChild(play);
        container.addEventListener('click', () => openLightbox(dataUrl, mediaType));
    } else {
        const img = document.createElement('img');
        img.src = dataUrl; img.alt = fileName || 'Image'; img.loading = 'lazy';
        container.appendChild(img);
        container.addEventListener('click', () => openLightbox(dataUrl, mediaType));
    }

    const dlBtn = document.createElement('button');
    dlBtn.className = 'media-download-btn'; dlBtn.title = 'Download';
    dlBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadMedia(dataUrl, fileName || (isVideo ? 'video.mp4' : 'image.png')); });
    container.appendChild(dlBtn);

    bubble.appendChild(container);
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `<span class="msg-time">${timeStr}</span>`;
    bubble.appendChild(meta);

    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'msg-actions-group';

    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn'; replyBtn.title = 'Reply';
    replyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>`;
    replyBtn.addEventListener('click', () => {
        const sender = type === 'sent' ? State.myName : State.peerName;
        setReply(msgId, `📎 ${isVideo ? 'Video' : 'Photo'}`, sender);
    });
    actionsGroup.appendChild(replyBtn);

    if (type === 'sent') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'msg-action-btn delete-btn'; deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;
        deleteBtn.addEventListener('click', () => deleteMessage(msgId));
        actionsGroup.appendChild(deleteBtn);
    }

    wrapper.appendChild(bubble);
    wrapper.appendChild(actionsGroup);
    row.appendChild(wrapper);
    DOM.chatMessages.appendChild(row);
    scrollToBottom();
}

function addSystemMsg(text) {
    State.chatHistory.push({ type: 'system', text, timestamp: new Date().toISOString() });
    const el = document.createElement('div');
    el.className = 'sys-msg';
    el.innerHTML = `<span>${escapeHTML(text)}</span>`;
    DOM.chatMessages.appendChild(el);
    scrollToBottom();
}

function downloadMedia(dataUrl, fileName) {
    const a = document.createElement('a'); a.href = dataUrl; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Download started');
}

function openLightbox(dataUrl, mediaType) {
    DOM.lightboxContent.innerHTML = '';
    if (mediaType.startsWith('video')) {
        const v = document.createElement('video'); v.src = dataUrl; v.controls = true; v.autoplay = true;
        v.style.cssText = 'max-width:100%;max-height:85vh'; DOM.lightboxContent.appendChild(v);
    } else {
        const img = document.createElement('img'); img.src = dataUrl; img.alt = 'Preview';
        DOM.lightboxContent.appendChild(img);
    }
    DOM.lightbox.classList.remove('hidden');
}
function closeLightbox() {
    DOM.lightbox.classList.add('hidden');
    const v = DOM.lightboxContent.querySelector('video'); if (v) v.pause();
    DOM.lightboxContent.innerHTML = '';
}

// ===== UI Screens =====
function showWaitingScreen(roomUsername, hostPin, guestPin) {
    DOM.lobby.classList.add('hidden'); DOM.chatScreen.classList.add('hidden'); DOM.inputBar.classList.add('hidden');
    DOM.replyBar.classList.add('hidden'); DOM.waitingScreen.classList.remove('hidden');
    DOM.btnLeave.classList.remove('hidden');
    DOM.waitingRoomUsername.textContent = '@' + (roomUsername || '---');
    DOM.waitingHostPin.textContent = hostPin || '------';
    DOM.waitingGuestPin.textContent = guestPin || '------';
    if (State.role === 'host') DOM.btnDissolve.classList.remove('hidden');
}
function showChatScreen(peerName) {
    DOM.lobby.classList.add('hidden'); DOM.waitingScreen.classList.add('hidden');
    DOM.chatScreen.classList.remove('hidden'); DOM.inputBar.classList.remove('hidden');
    DOM.btnLeave.classList.remove('hidden'); DOM.btnDownloadChat.classList.remove('hidden');
    DOM.modeToggle.classList.remove('hidden');
    if (State.role === 'host') DOM.btnDissolve.classList.remove('hidden');
    DOM.peerName.textContent = peerName; DOM.msgInput.focus();
}
function resetToLobby() {
    DOM.lobby.classList.remove('hidden'); DOM.waitingScreen.classList.add('hidden');
    DOM.chatScreen.classList.add('hidden'); DOM.inputBar.classList.add('hidden');
    DOM.replyBar.classList.add('hidden'); DOM.btnLeave.classList.add('hidden');
    DOM.btnDissolve.classList.add('hidden'); DOM.btnDownloadChat.classList.add('hidden');
    DOM.modeToggle.classList.add('hidden'); DOM.pdfViewerScreen.classList.add('hidden');
    DOM.editModal.classList.add('hidden'); DOM.errorOverlay.classList.add('hidden');
    DOM.modeSwitch.checked = false; State.pdfMode = false;
    DOM.headerTitle.textContent = 'Realtime Chat V6'; DOM.statusRow.classList.remove('hidden');
    DOM.chatMessages.innerHTML = `<div class="chat-welcome"><div class="welcome-icon">💬</div><p>Dual-Key room active! Say hello.<br><small style="opacity:0.7">Chats auto-reset at 11:59 PM daily.</small></p></div>`;
    setStatus(isConnected() ? 'connected' : '', isConnected() ? 'Connected to server' : 'Ready');
    State.pin = null; State.roomUsername = null; State.hostPassword = null; State.guestPassword = null; State.role = null; State.peerName = ''; State.connected = false;
    State.chatHistory = []; cancelReply(); closeEditModal();
}

// ===== Helpers =====
function setStatus(state, text) { DOM.statusDot.className = 'status-dot' + (state ? ' ' + state : ''); DOM.statusText.textContent = text; }
function scrollToBottom() { requestAnimationFrame(() => { DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight; }); }
function showTyping(isTyping) { DOM.typingIndicator.classList.toggle('hidden', !isTyping); }
function showToast(message) {
    DOM.toast.textContent = message; DOM.toast.classList.remove('hidden'); DOM.toast.classList.add('show');
    setTimeout(() => { DOM.toast.classList.remove('show'); setTimeout(() => DOM.toast.classList.add('hidden'), 300); }, 3000);
}
function showError(title, message) { DOM.errorTitle.textContent = title; DOM.errorMessage.textContent = message; DOM.errorOverlay.classList.remove('hidden'); }
function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function formatSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB'; return (bytes/1048576).toFixed(1) + ' MB'; }
