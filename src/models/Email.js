const mongoose = require("mongoose");
const getIndiaTime = require("../utils/timezone");

const emailSchema = new mongoose.Schema({
  // Email Identification
  emailId: {
    type: String,
    required: true,
    unique: true,
    default: () => `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  // Link to Ticket
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ticket",
    required: false,
    index: true,
    default: null
  },

  // Participants
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  senderEmail: {
    type: String,
    required: true
  },
  senderName: String,

  // Recipients
  recipientEmail: {
    type: String,
    required: true,
    lowercase: true
  },
  recipientName: String,

  // Email Content
  subject: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  htmlBody: {
    type: String,
    default: null
  },

  // Email Type & Status
  type: {
    type: String,
    enum: ["outgoing", "incoming"],
    required: true,
    default: "outgoing"
  },
  status: {
    type: String,
    enum: ["draft", "sent", "received", "failed", "read"],
    default: "draft"
  },

  // Attachments
  attachments: [{
    fileName: String,
    fileUrl: String,
    fileSize: Number,
    mimeType: String
  }],

  // Metadata
  messageId: String, // From Brevo API
  threadId: String, // For grouping related emails
  isReply: {
    type: Boolean,
    default: false
  },
  replyToEmailId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Email",
    default: null
  },

  // Timestamps
  sentAt: {
    type: Date,
    default: null
  },
  receivedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: getIndiaTime
  },

  // Read status for recipients
  readBy: [{
    userId: mongoose.Schema.Types.ObjectId,
    readAt: Date
  }],

  // Error tracking
  error: {
    code: String,
    message: String,
    timestamp: Date
  },

  // Brevo specific
  brevoMessageId: String,
  brevoEventId: String,
});

// Indexes for better query performance
emailSchema.index({ ticketId: 1, createdAt: -1 });
emailSchema.index({ senderId: 1, createdAt: -1 });
emailSchema.index({ senderEmail: 1, recipientEmail: 1 });
emailSchema.index({ type: 1, status: 1 });
emailSchema.index({ threadId: 1 });

module.exports = mongoose.model("Email", emailSchema);
