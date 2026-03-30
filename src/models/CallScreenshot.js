const mongoose = require('mongoose');

const callScreenshotSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  petitionId: {
    type: String,
    index: true
  },
  capturedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Allow null for guest/widget snapshots
  },
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    role: String
  }],
  imagePath: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String, // Cloudinary URL
  },
  cloudinaryPublicId: {
    type: String, // For deletion
  },
  callType: {
    type: String,
    enum: ['audio', 'video', 'snapshot'],
    default: 'video'
  },
  metadata: {
    customerName: String,
    agentName: String,
    querySubject: String,
    originalFilename: String,
    fileSize: Number,
    mimeType: String
  }
}, {
  timestamps: true
});

callScreenshotSchema.index({ createdAt: -1 });
callScreenshotSchema.index({ capturedBy: 1, createdAt: -1 });

module.exports = mongoose.model('CallScreenshot', callScreenshotSchema);
