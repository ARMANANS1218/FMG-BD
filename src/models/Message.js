const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const MessageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  from: String,
  to: String,
  message: String,
  status: { type: String, default: "sent" },
  timestamp: { type: Date, default: getIndiaTime },
  source: { type: String, default: "whatsapp" },
  platform: String,
  direction: String,
  petitionToken: String,
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema);
