const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const RoleSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Base role determines permissions. Custom roles inherit from a base role.
    baseRole: {
      type: String,
      enum: ['Admin', 'Agent', 'QA', 'TL', 'Management', 'Dev'],
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdAt: {
      type: Date,
      default: getIndiaTime,
    },
  },
  { timestamps: true }
);

// Unique role name per organization
RoleSchema.index({ organizationId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Role', RoleSchema);
