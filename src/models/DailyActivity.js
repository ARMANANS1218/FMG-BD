const mongoose = require('mongoose');

const dailyActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  loginTime: {
    type: Date,
    default: null
  },
  logoutTime: {
    type: Date,
    default: null
  },
  totalOnlineTime: {
    type: Number, // in minutes
    default: 0
  },
  totalBreakTime: {
    type: Number, // in minutes
    default: 0
  },
  breakCount: {
    type: Number,
    default: 0
  },
  breakLogs: [{
    start: Date,
    end: Date,
    duration: Number // in minutes
  }],
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  }
}, {
  timestamps: true
});

// Compound index for efficient querying
dailyActivitySchema.index({ userId: 1, date: -1 });
dailyActivitySchema.index({ organizationId: 1, date: -1 });

module.exports = mongoose.model('DailyActivity', dailyActivitySchema);
