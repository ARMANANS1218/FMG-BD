const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

/**
 * FEATURE FLAGS FOR FBAC (Feature-Based Access Control)
 * Each organization can have different features enabled
 */
const featureFlagsSchema = new mongoose.Schema({
  // Core Features
  chat: {
    enabled: { type: Boolean, default: true },
    maxConcurrentChats: { type: Number, default: 50 },
  },

  email: {
    enabled: { type: Boolean, default: false },
    maxEmailsPerMonth: { type: Number, default: 1000 },
  },

  query: {
    enabled: { type: Boolean, default: true },
    maxQueriesPerMonth: { type: Number, default: 500 },
  },

  videoCalls: {
    enabled: { type: Boolean, default: false },
    maxCallDuration: { type: Number, default: 30 }, // minutes
    maxCallsPerMonth: { type: Number, default: 100 },
  },

  audioCalls: {
    enabled: { type: Boolean, default: false },
    maxCallDuration: { type: Number, default: 30 }, // minutes
    maxCallsPerMonth: { type: Number, default: 200 },
  },

  // Advanced Features
  analytics: {
    enabled: { type: Boolean, default: false },
    advancedReports: { type: Boolean, default: false },
  },

  customBranding: {
    enabled: { type: Boolean, default: false },
    whiteLabel: { type: Boolean, default: false },
  },

  apiAccess: {
    enabled: { type: Boolean, default: false },
    rateLimitPerMinute: { type: Number, default: 60 },
  },

  integrations: {
    enabled: { type: Boolean, default: false },
    webhooks: { type: Boolean, default: false },
    thirdPartyApps: { type: Boolean, default: false },
  },

  aiChatbot: {
    enabled: { type: Boolean, default: false },
    monthlyMessages: { type: Number, default: 1000 },
  },

  fileSharing: {
    enabled: { type: Boolean, default: false },
    maxFileSize: { type: Number, default: 5 }, // MB
    totalStorage: { type: Number, default: 100 }, // MB
  },

  // ==================== FMCG SETTINGS (UK Support) ====================
  fmcgSettings: {
    refundThreshold: { type: Number, default: 50 }, // £ GBP - TL approval required above this
    dataRetentionMonthsDefault: { type: Number, default: 6 }, // 6, 12, 24
    slaTargets: {
      frt: { type: Number, default: 60 }, // seconds (First Response Time)
      aht: { type: Number, default: 600 }, // seconds (Average Handle Time - 10 mins)
      resolutionSla: { type: Number, default: 90 }, // % target
    },
    fsaNotificationThreshold: { type: String, enum: ['All', 'High/Critical', 'Critical Only'], default: 'High/Critical' }
  },
}, { _id: false });

/**
 * ORGANIZATION MODEL - Root Tenant Entity
 * Each organization is a separate tenant in the system
 */
const organizationSchema = new mongoose.Schema({
  // Unique Identifiers
  organizationId: {
    type: String,
    unique: true,
    required: true
  }, // "ORG-001", "ORG-002"

  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true,
  }, // "XYZ Company", "ABC Corp"

  displayName: {
    type: String,
    trim: true,
  }, // For widget display

  domain: {
    type: String,
    lowercase: true
  }, // "xyz.com", "abc.com"

  subdomain: {
    type: String,
    lowercase: true
  }, // "xyz" for xyz.chatcrm.com

  // Contact Information
  adminEmail: {
    type: String,
    required: true,
    lowercase: true,
  },

  contactEmail: {
    type: String,
    lowercase: true,
  },

  contactPhone: {
    type: String,
    trim: true,
  },

  website: {
    type: String,
    trim: true,
  },

  // Address
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },

  // Subscription & Billing
  subscription: {
    plan: {
      type: String,
      enum: ['trial', 'basic', 'professional', 'enterprise', 'custom'],
      default: 'trial',
    },

    status: {
      type: String,
      enum: ['active', 'suspended', 'expired', 'cancelled'],
      default: 'active',
    },

    startDate: {
      type: Date,
      default: getIndiaTime,
    },

    expiryDate: {
      type: Date,
    },

    billingCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'annually'],
      default: 'monthly',
    },

    price: {
      type: Number,
      default: 0,
    },

    currency: {
      type: String,
      default: 'USD',
    },

    // Limits
    maxAgents: {
      type: Number,
      default: 5,
    },

    maxQA: {
      type: Number,
      default: 2,
    },

    maxCustomers: {
      type: Number,
      default: 1000,
    },
  },

  // ✨ FEATURE FLAGS (FBAC)
  features: featureFlagsSchema,

  // Configuration & Settings
  settings: {
    // Customer Portal
    allowUnregisteredCustomers: {
      type: Boolean,
      default: true,
    },

    autoAssignQueries: {
      type: Boolean,
      default: true,
    },

    requireEmailVerification: {
      type: Boolean,
      default: false,
    },

    // Working Hours
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },

    workingHours: {
      enabled: { type: Boolean, default: false },
      monday: { start: String, end: String, enabled: { type: Boolean, default: true } },
      tuesday: { start: String, end: String, enabled: { type: Boolean, default: true } },
      wednesday: { start: String, end: String, enabled: { type: Boolean, default: true } },
      thursday: { start: String, end: String, enabled: { type: Boolean, default: true } },
      friday: { start: String, end: String, enabled: { type: Boolean, default: true } },
      saturday: { start: String, end: String, enabled: { type: Boolean, default: false } },
      sunday: { start: String, end: String, enabled: { type: Boolean, default: false } },
    },
    // Enforce login from approved geo-locations (org-wide)
    loginLocationAccess: {
      enforce: { type: Boolean, default: false },
      defaultRadiusMeters: { type: Number, default: 100 },
      // Roles to enforce location on (by default: Admin, Agent, QA, TL)
      roles: {
        type: [String],
        default: ['Admin', 'Agent', 'QA', 'TL']
      }
    },

    // Branding
    branding: {
      logo: String,
      favicon: String,
      primaryColor: { type: String, default: '#4F46E5' },
      secondaryColor: { type: String, default: '#10B981' },
      fontFamily: { type: String, default: 'Inter' },
    },

    // Notifications
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      smsNotifications: { type: Boolean, default: false },
      pushNotifications: { type: Boolean, default: true },
    },

    // Widget Configuration
    widget: {
      enabled: { type: Boolean, default: true },
      position: { type: String, enum: ['bottom-right', 'bottom-left'], default: 'bottom-right' },
      welcomeMessage: { type: String, default: 'Hi! How can we help you today?' },
      theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'light' },
      showAgentAvatar: { type: Boolean, default: true },
      collectEmail: { type: Boolean, default: true },
      collectPhone: { type: Boolean, default: false },
    },
  },

  // API Keys for Widget Integration
  apiKeys: [{
    key: {
      type: String
    },

    name: {
      type: String,
      default: 'Primary API Key',
    },

    permissions: [{
      type: String,
      enum: ['widget', 'api', 'webhook', 'full'],
    }],

    allowedOrigins: [String], // CORS origins

    isActive: {
      type: Boolean,
      default: true,
    },

    lastUsed: Date,

    usageCount: {
      type: Number,
      default: 0,
    },

    createdAt: {
      type: Date,
      default: getIndiaTime,
    },

    expiresAt: Date, // Optional expiry
  }],

  // Usage Statistics & Limits
  usage: {
    // Current Month
    queriesThisMonth: { type: Number, default: 0 },
    emailsThisMonth: { type: Number, default: 0 },
    callsThisMonth: { type: Number, default: 0 },
    callMinutesThisMonth: { type: Number, default: 0 },

    // All Time
    totalQueries: { type: Number, default: 0 },
    totalEmails: { type: Number, default: 0 },
    totalCalls: { type: Number, default: 0 },

    // Employees
    totalAgents: { type: Number, default: 0 },
    totalQA: { type: Number, default: 0 },
    totalCustomers: { type: Number, default: 0 },

    // Storage
    storageUsed: { type: Number, default: 0 }, // MB

    // Last Reset Date (for monthly limits)
    lastResetDate: {
      type: Date,
      default: getIndiaTime,
    },
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }, // SuperAdmin who created this org

  isActive: {
    type: Boolean,
    default: true,
  },

  isSuspended: {
    type: Boolean,
    default: false,
  },

  suspensionReason: String,

  notes: String, // Internal notes by SuperAdmin

  // Timestamps
  createdAt: {
    type: Date,
    default: getIndiaTime,
  },

  updatedAt: {
    type: Date,
    default: getIndiaTime,
  },

  lastLoginAt: Date,
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// ==================== INDEXES ====================
organizationSchema.index({ domain: 1 });
organizationSchema.index({ subdomain: 1 });
organizationSchema.index({ 'apiKeys.key': 1 });
organizationSchema.index({ 'subscription.status': 1 });
organizationSchema.index({ isActive: 1, isSuspended: 1 });

// ==================== VIRTUALS ====================
organizationSchema.virtual('isTrialExpired').get(function () {
  if (this.subscription.plan === 'trial' && this.subscription.expiryDate) {
    return new Date() > this.subscription.expiryDate;
  }
  return false;
});

organizationSchema.virtual('daysRemaining').get(function () {
  if (this.subscription.expiryDate) {
    const diff = this.subscription.expiryDate - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
  return null;
});

// Check if feature is enabled
organizationSchema.methods.hasFeature = function (featureName) {
  const feature = this.features[featureName];
  return feature && feature.enabled === true;
};

// Check if usage limit reached
organizationSchema.methods.canUseFeature = function (featureName, currentCount = 0) {
  const feature = this.features[featureName];

  if (!feature || !feature.enabled) {
    return { allowed: false, reason: 'Feature not enabled' };
  }

  // Check monthly limits
  if (featureName === 'query' && feature.maxQueriesPerMonth) {
    if (this.usage.queriesThisMonth >= feature.maxQueriesPerMonth) {
      return { allowed: false, reason: 'Monthly query limit reached' };
    }
  }

  if (featureName === 'email' && feature.maxEmailsPerMonth) {
    if (this.usage.emailsThisMonth >= feature.maxEmailsPerMonth) {
      return { allowed: false, reason: 'Monthly email limit reached' };
    }
  }

  if ((featureName === 'videoCalls' || featureName === 'audioCalls') && feature.maxCallsPerMonth) {
    if (this.usage.callsThisMonth >= feature.maxCallsPerMonth) {
      return { allowed: false, reason: 'Monthly call limit reached' };
    }
  }

  return { allowed: true };
};

// Increment usage counters
organizationSchema.methods.incrementUsage = async function (featureName) {
  const updates = { updatedAt: getIndiaTime() };

  switch (featureName) {
    case 'query':
      updates['usage.queriesThisMonth'] = (this.usage.queriesThisMonth || 0) + 1;
      updates['usage.totalQueries'] = (this.usage.totalQueries || 0) + 1;
      break;
    case 'email':
      updates['usage.emailsThisMonth'] = (this.usage.emailsThisMonth || 0) + 1;
      updates['usage.totalEmails'] = (this.usage.totalEmails || 0) + 1;
      break;
    case 'call':
      updates['usage.callsThisMonth'] = (this.usage.callsThisMonth || 0) + 1;
      updates['usage.totalCalls'] = (this.usage.totalCalls || 0) + 1;
      break;
  }

  await this.constructor.updateOne({ _id: this._id }, { $inc: updates });
};

// Reset monthly usage (cron job should call this)
organizationSchema.statics.resetMonthlyUsage = async function () {
  const now = getIndiaTime();
  return this.updateMany(
    {},
    {
      $set: {
        'usage.queriesThisMonth': 0,
        'usage.emailsThisMonth': 0,
        'usage.callsThisMonth': 0,
        'usage.callMinutesThisMonth': 0,
        'usage.lastResetDate': now,
      }
    }
  );
};

// ==================== PRE-SAVE HOOKS ====================
organizationSchema.pre('save', function (next) {
  this.updatedAt = getIndiaTime();
  next();
});

const Organization = mongoose.model('Organization', organizationSchema);

module.exports = Organization;
