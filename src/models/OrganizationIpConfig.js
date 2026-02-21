const mongoose = require('mongoose');

const organizationIpConfigSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true
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
  applyToRoles: [{
    type: String,
    enum: ['Agent', 'TL', 'QA', 'agent', 'teamleader', 'tl', 'qa'],
    default: ['Agent', 'TL', 'QA']
  }],
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

// Index for faster queries
organizationIpConfigSchema.index({ organizationId: 1, isActive: 1 });

// Method to check if an IP is allowed
organizationIpConfigSchema.methods.isIpAllowed = function(ip) {
  if (!this.isActive) return false;
  // Trim and compare to handle any whitespace issues
  const trimmedIp = ip?.trim();
  return this.allowedIps.some(allowedIp => allowedIp.ip?.trim() === trimmedIp);
};

// Static method to verify IP access for organization
organizationIpConfigSchema.statics.verifyOrgIpAccess = async function(organizationId, userRole, clientIp) {
  try {
    // First check if any config exists for this organization (active or inactive)
    const anyConfig = await this.findOne({ organizationId });
    console.log('🔍 [IP Verify] Organization:', organizationId);
    console.log('🔍 [IP Verify] Any config exists:', !!anyConfig);
    if (anyConfig) {
      console.log('🔍 [IP Verify] Config isActive:', anyConfig.isActive);
    }

    // Check for any config (active or inactive)
    const config = await this.findOne({ organizationId }).populate('organizationId', 'name');

    // If no config exists at all, allow access (not configured yet)
    if (!config) {
      console.log('✅ [IP Verify] No config found - allowing access');
      return { 
        allowed: true, 
        reason: 'no_config',
        message: 'Organization IP configuration not set'
      };
    }

    // If config exists but is INACTIVE, BLOCK all access
    if (!config.isActive) {
      console.log('❌ [IP Verify] Config is INACTIVE - blocking all access');
      return { 
        allowed: false, 
        reason: 'config_inactive',
        message: 'Organization IP restrictions are currently disabled. Login is blocked.',
        allowedIps: []
      };
    }

    // Config is ACTIVE - proceed with IP check
    console.log('🔍 [IP Verify] Config is ACTIVE - checking IP access');

    // Check if this role should be restricted
    const roleNormalized = userRole.toLowerCase();
    const shouldCheck = config.applyToRoles.some(role => 
      role.toLowerCase() === roleNormalized || 
      (roleNormalized === 'tl' && role.toLowerCase() === 'teamleader')
    );

    if (!shouldCheck) {
      return { 
        allowed: true, 
        reason: 'role_not_restricted',
        message: 'This role is not restricted by IP'
      };
    }

    // Check if IP is in allowed list
    const isAllowed = config.isIpAllowed(clientIp);
    const allowedIpsList = config.allowedIps.map(ip => ip.ip);

    console.log('🔍 [IP Check] Client IP:', clientIp);
    console.log('🔍 [IP Check] Allowed IPs:', allowedIpsList);
    console.log('🔍 [IP Check] Is Allowed:', isAllowed);

    if (isAllowed) {
      console.log('✅ [IP Check] ACCESS GRANTED - IP is in allowed list');
      return { 
        allowed: true, 
        reason: 'ip_allowed',
        config 
      };
    } else {
      console.log('❌ [IP Check] ACCESS DENIED - IP not in allowed list');
      return { 
        allowed: false, 
        reason: 'ip_not_allowed',
        message: `Access restricted to organization IPs only. Your IP: ${clientIp}`,
        allowedIps: allowedIpsList,
        config 
      };
    }
  } catch (error) {
    console.error('Error verifying organization IP access:', error);
    return { 
      allowed: true, 
      reason: 'error',
      error: error.message 
    };
  }
};

module.exports = mongoose.model('OrganizationIpConfig', organizationIpConfigSchema);
