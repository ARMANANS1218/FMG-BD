const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['Public Holiday', 'Company Holiday', 'Optional Holiday'],
    default: 'Public Holiday'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate holidays for same organization on same date
holidaySchema.index({ organizationId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Holiday', holidaySchema);
