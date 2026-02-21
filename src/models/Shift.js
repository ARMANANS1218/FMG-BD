const mongoose = require("mongoose");

const ShiftSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true
    },
    shiftName: {
      type: String,
      required: true,
      trim: true,
      enum: ['Morning', 'Afternoon', 'Night', 'General']
    },
    startTime: {
      type: String, // Format: "09:00"
      required: true
    },
    endTime: {
      type: String, // Format: "18:00"
      required: true
    },
    duration: {
      type: Number, // Duration in hours
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

// Compound index for unique shift names per organization
ShiftSchema.index({ organizationId: 1, shiftName: 1 }, { unique: true });

module.exports = mongoose.model("Shift", ShiftSchema);
