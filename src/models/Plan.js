const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  price: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String, // e.g., "Mobile", "iPhone", "Broadband"
    default: 'Mobile',
    trim: true
  },
  data: {
    type: String, // e.g., "Unlimited Data", "5GB Data"
    required: true,
    trim: true
  },
  details: [{
    type: String,
    trim: true
  }],
  category: {
    type: String, // "Basic", "Standard", "Premium"
    default: 'Standard',
    trim: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  createdByName: {
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

// Index for faster queries
planSchema.index({ organizationId: 1, isActive: 1 });
planSchema.index({ organizationId: 1, category: 1 });

module.exports = mongoose.model('Plan', planSchema);
