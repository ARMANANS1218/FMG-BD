// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  subject:String,
  message: { type: String, required: true },
  link: { type: String }, 
  customerEmail: {type:String },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  receivers: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date }
  }],
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Indexes for faster queries
notificationSchema.index({ 'receivers.userId': 1, createdAt: -1 });
notificationSchema.index({ ticketId: 1 });

module.exports = mongoose.model('Notification', notificationSchema);