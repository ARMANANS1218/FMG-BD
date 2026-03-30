const mongoose = require('mongoose');

const TrainingMaterialSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  category: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: null
  },
  fileName: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  cloudinaryPublicId: {
    type: String,
    default: null
  },
  fileType: {
    type: String,
    enum: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'other'],
    required: true
  },
  fileSize: {
    type: Number, // in bytes
    default: 0
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploadedByName: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});

// Indexes for efficient queries
TrainingMaterialSchema.index({ organizationId: 1, category: 1 });
TrainingMaterialSchema.index({ organizationId: 1, isActive: 1 });
TrainingMaterialSchema.index({ createdAt: -1 });

module.exports = mongoose.model('TrainingMaterial', TrainingMaterialSchema);
