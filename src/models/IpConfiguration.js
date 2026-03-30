const mongoose = require('mongoose');

const ipConfigurationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  allowedIps: [{
    ip: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  userRole: {
    type: String,
    enum: ['agent', 'teamleader', 'qa'],
    required: true
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
}, {
  timestamps: true
});

// Compound index for faster queries
ipConfigurationSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
ipConfigurationSchema.index({ organizationId: 1, userRole: 1 });

// Method to check if an IP is allowed
ipConfigurationSchema.methods.isIpAllowed = function(ipAddress) {
  if (!this.isActive) return false;
  if (!this.allowedIps || this.allowedIps.length === 0) return false;
  
  return this.allowedIps.some(entry => entry.ip === ipAddress);
};

// Static method to verify user IP access
ipConfigurationSchema.statics.verifyIpAccess = async function(userId, ipAddress) {
  const config = await this.findOne({ 
    userId, 
    isActive: true 
  }).populate('userId', 'name email role');
  
  if (!config) {
    // If no IP configuration exists, allow access (backward compatibility)
    return { allowed: true, reason: 'no_config' };
  }
  
  const isAllowed = config.isIpAllowed(ipAddress);
  
  return {
    allowed: isAllowed,
    reason: isAllowed ? 'ip_allowed' : 'ip_not_allowed',
    config: config
  };
};

const IpConfiguration = mongoose.model('IpConfiguration', ipConfigurationSchema);

module.exports = IpConfiguration;
