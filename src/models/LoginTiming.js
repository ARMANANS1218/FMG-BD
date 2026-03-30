const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const LoginTimingSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
    },

    // Login time window in IST (24-hour format)
    startTime: {
      type: String, // Format: "HH:MM" (e.g., "09:00" for 9 AM)
      required: true,
      default: '09:00',
    },

    endTime: {
      type: String, // Format: "HH:MM" (e.g., "18:00" for 6 PM)
      required: true,
      default: '18:00',
    },

    // Roles affected by login timing restrictions
    // Admin and Dev are always exempt
    restrictedRoles: {
      type: [String],
      enum: [
        'Agent',
        'QA',
        'TL',
        'Management',
        'Center',
        'Associate',
        'Aggregator',
        'Client',
        'Dev',
      ],
      default: ['Agent', 'QA', 'TL', 'Management', 'Center', 'Associate', 'Aggregator', 'Client'],
      // Note: Admin is always unrestricted, Dev can be included but won't be by default
    },

    // Enable/disable login timing enforcement
    isActive: {
      type: Boolean,
      default: true,
    },

    // Optional description
    description: {
      type: String,
      trim: true,
      default: 'CRM Login Hours',
    },

    // Audit
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    createdAt: {
      type: Date,
      default: getIndiaTime,
    },

    updatedAt: {
      type: Date,
      default: getIndiaTime,
    },
  },
  {
    timestamps: { currentTime: getIndiaTime },
  }
);

// Helper method to check if login is allowed
LoginTimingSchema.methods.isLoginAllowed = function (role) {
  // Admin and Dev are always allowed
  if (role === 'Admin' || role === 'Dev') {
    return true;
  }

  // If feature is inactive, allow all
  if (!this.isActive) {
    return true;
  }

  // Check if role is restricted
  if (!this.restrictedRoles.includes(role)) {
    return true; // Role not in restricted list, allow login
  }

  // Check if current time is within allowed window
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = String(istTime.getHours()).padStart(2, '0');
  const currentMinute = String(istTime.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHour}:${currentMinute}`;

  const [startH, startM] = this.startTime.split(':').map(Number);
  const [endH, endM] = this.endTime.split(':').map(Number);
  const [currH, currM] = currentTimeStr.split(':').map(Number);

  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;
  const currTotalMinutes = currH * 60 + currM;

  return currTotalMinutes >= startTotalMinutes && currTotalMinutes <= endTotalMinutes;
};

// Helper method to get remaining login time
LoginTimingSchema.methods.getRemainingLoginMinutes = function (role) {
  // Admin and Dev don't have time restrictions
  if (role === 'Admin' || role === 'Dev') {
    return null; // No restriction
  }

  if (!this.isActive || !this.restrictedRoles.includes(role)) {
    return null; // No restriction
  }

  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = istTime.getHours();
  const currentMinute = istTime.getMinutes();

  const [endH, endM] = this.endTime.split(':').map(Number);

  const endTotalMinutes = endH * 60 + endM;
  const currTotalMinutes = currentHour * 60 + currentMinute;

  const remainingMinutes = Math.max(0, endTotalMinutes - currTotalMinutes);
  return remainingMinutes;
};

// Helper method to get next login start time
LoginTimingSchema.methods.getNextLoginStartTime = function () {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentHour = istTime.getHours();
  const currentMinute = istTime.getMinutes();

  const [startH, startM] = this.startTime.split(':').map(Number);
  const [endH, endM] = this.endTime.split(':').map(Number);

  const currTotalMinutes = currentHour * 60 + currentMinute;
  const startTotalMinutes = startH * 60 + startM;

  if (currTotalMinutes < startTotalMinutes) {
    // Today's start time hasn't arrived yet
    return `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
  } else {
    // Today's window has passed, show tomorrow's start time
    return `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')} (Tomorrow)`;
  }
};

module.exports = mongoose.model('LoginTiming', LoginTimingSchema);
