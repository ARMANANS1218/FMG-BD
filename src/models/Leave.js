const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  leaveType: {
    type: String,
    enum: ['Sick Leave', 'Casual Leave', 'Paid Leave', 'Unpaid Leave', 'Emergency Leave', 'Other'],
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewComment: {
    type: String,
    trim: true
  },
  reviewedAt: {
    type: Date
  },
  attachments: [{
    type: String  // URLs for supporting documents (medical certificates, etc.)
  }],
  totalDays: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
leaveSchema.index({ userId: 1, startDate: -1 });
leaveSchema.index({ organizationId: 1, status: 1 });
leaveSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Leave', leaveSchema);
