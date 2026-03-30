const mongoose = require("mongoose");
const getIndiaTime = require("../utils/timezone");

const AttendanceSchema = new mongoose.Schema(
  {
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
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shift',
      required: true
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    // Check-in details
    checkInTime: {
      type: Date
    },
    checkInImage: {
      type: String // Cloudinary URL
    },
    checkInLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String }
    },
    checkInIp: {
      type: String
    },
    // Check-out details
    checkOutTime: {
      type: Date
    },
    checkOutImage: {
      type: String // Cloudinary URL
    },
    checkOutLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String }
    },
    checkOutIp: {
      type: String
    },
    // Status
    status: {
      type: String,
      enum: ['Present', 'Absent', 'On Time', 'Late', 'Half Day'],
      default: 'Present'
    },
    // Working hours
    totalHours: {
      type: Number,
      default: 0
    },
    // Manual marking/editing
    isManuallyMarked: {
      type: Boolean,
      default: false
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    // Editing history
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    editedAt: {
      type: Date
    },
    editRemark: {
      type: String
    },
    remarks: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

// Compound index for unique attendance per user per day
AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ organizationId: 1, date: 1 });
AttendanceSchema.index({ shiftId: 1, date: 1 });

module.exports = mongoose.model("Attendance", AttendanceSchema);
