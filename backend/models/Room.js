/**
 * Room Schema — MongoDB Atlas Persistence for Blechat V6
 */

const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    msgId: { type: String, required: true },
    type: { type: String, required: true }, // 'text' | 'media'
    text: { type: String, default: null },
    data: { type: String, default: null }, // Base64 data for media/pdf
    mediaType: { type: String, default: null },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: null },
    senderRole: { type: String, required: true }, // 'host' | 'client'
    senderName: { type: String, required: true },
    timestamp: { type: String, required: true },
    replyTo: { type: mongoose.Schema.Types.Mixed, default: null },
    edited: { type: Boolean, default: false }
}, { _id: false });

const RoomSchema = new mongoose.Schema({
    roomUsername: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    hostPassword: { type: String, required: true },
    guestPassword: { type: String, required: true },
    hostName: { type: String, default: 'Host' },
    clientName: { type: String, default: '' },
    messages: [MessageSchema],
    lastResetDate: { type: String, required: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('Room', RoomSchema);
