const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const UserSchema = new mongoose.Schema(
  {
    // ==================== MULTI-TENANT FIELD ====================
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      // Required for all users except SuperAdmin
      required: function () {
        return this.role !== 'SuperAdmin';
      },
    },

    employee_id: {
      type: String,
      trim: true,
    },
    user_name: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Alias name for Agent, TL, QA roles (shown in chats and tickets)
    alias: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    mobile: {
      type: String,
      trim: true,
    },
    alternatePhone: {
      type: String,
      trim: true,
      default: null,
    },
    password: {
      type: String,
      required: true,
    },
    // Encrypted password for admin viewing (reversible encryption)
    // WARNING: Security sensitive - only for admin access
    encryptedPassword: {
      type: String,
      default: null,
      select: false, // Don't include by default in queries
    },

    // ==================== CUSTOMER-SPECIFIC FIELDS (for Service Provider CRM) ====================
    customerId: {
      type: String,
      trim: true,
    },

    // Government ID Information
    governmentId: {
      type: {
        type: String,
        enum: ['Driving License', 'Passport', 'Other'],
        default: null,
      },
      number: { type: String, default: null, trim: true },
      issuedDate: { type: Date, default: null },
      expiryDate: { type: Date, default: null },
    },

    // Complete Address Information
    address: {
      street: { type: String, default: null, trim: true },
      locality: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      state: { type: String, default: null, trim: true },
      country: { type: String, default: null, trim: true },
      postalCode: { type: String, default: null, trim: true },
      landmark: { type: String, default: null, trim: true },
    },

    // Service/Billing Information (DEPRECATED - Use planHistory)
    planType: {
      type: String,
      default: null,
      trim: true,
    },
    billingType: {
      type: String,
      enum: ['Prepaid', 'Postpaid', null],
      default: null,
    },
    billingCycle: {
      type: String,
      enum: ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', null],
      default: null,
    },
    validityPeriod: {
      type: String,
      default: null,
      trim: true, // e.g., "30 Days", "1 Year", etc.
    },
    activationDate: {
      type: Date,
      default: null,
    },
    deactivationDate: {
      type: Date,
      default: null,
    },
    serviceStatus: {
      type: String,
      enum: ['Active', 'Inactive', 'Suspended', 'Pending', null],
      default: null,
    },

    // ==================== PLAN HISTORY (Multiple Plans Support) ====================
    planHistory: [
      {
        planType: {
          type: String,
          required: true,
          trim: true,
        },
        billingType: {
          type: String,
          enum: ['Prepaid', 'Postpaid'],
          required: true,
        },
        billingCycle: {
          type: String,
          enum: ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'],
          required: true,
        },
        validityPeriod: {
          type: String,
          required: true,
          trim: true,
        },
        activationDate: {
          type: Date,
          required: true,
        },
        deactivationDate: {
          type: Date,
          default: null,
        },
        serviceStatus: {
          type: String,
          enum: ['Active', 'Inactive', 'Suspended', 'Expired'],
          default: 'Active',
        },
        addedAt: {
          type: Date,
          default: getIndiaTime,
        },
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        notes: {
          type: String,
          default: null,
        },
      },
    ],

    // ==================== QUERY HISTORY (Customer Queries) ====================
    queryHistory: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Query',
      },
    ],
    // ==================== SUPERADMIN VISIBLE PASSWORD (for password recovery) ====================
    visiblePassword: {
      type: String,
      default: null,
      select: false, // Hidden by default, only fetched when explicitly requested
    },
    role: {
      type: String,
      enum: ['SuperAdmin', 'Admin', 'Agent', 'QA', 'TL', 'Management', 'Dev', 'Customer'],
      default: 'Customer',
    },
    // Dynamic custom role name (e.g., "Senior Agent", "Dev Support", etc.)
    // When set, this overrides display name but permissions use the base 'role' field
    customRole: {
      type: String,
      trim: true,
      default: null,
    },

    // ==================== CUSTOMER TYPE (for registered vs guest) ====================
    customerType: {
      type: String,
      enum: ['registered', 'guest'],
      default: 'registered',
    },

    guestIdentifier: {
      type: String, // email or phone or session ID
    },

    department: {
      type: String,
      enum: ['Accounts', 'Technicals', 'Billings', 'Supports', 'Management'],
    },
    // Escalation Tier (for structured escalation flows)
    tier: {
      type: String,
      enum: ['Tier-1', 'Tier-2', 'Tier-3'],
      default: null,
      validate: {
        validator: function (v) {
          // Require tier for operational escalation roles (Agent, QA, TL, Dev)
          if (['Agent', 'QA', 'TL', 'Dev'].includes(this.role)) {
            return !!v;
          }
          // Admin does not need a tier; allow null
          return true;
        },
        message: 'Tier is required for Agent, QA, TL and Dev roles',
      },
    },

    // Salary (daily rate) for payroll calculation
    salary: {
      type: Number,
      default: null,
      min: 0,
      comment: 'Daily salary rate for invoice calculation',
    },

    // Status fields
    is_active: { type: Boolean, default: false },
    workStatus: {
      type: String,
      enum: ['active', 'break', 'offline', 'busy'],
      default: 'offline',
    },
    is_typing: { type: Boolean, default: false },

    // Timestamps for login & break
    login_time: { type: Date, default: getIndiaTime },
    logout_time: { type: Date, default: getIndiaTime },
    break_time: { type: Date, default: getIndiaTime },

    // Break logs
    breakLogs: [
      {
        start: { type: Date, default: getIndiaTime },
        end: { type: Date, default: getIndiaTime },
        duration: { type: Number },
      },
    ],

    // Active time tracking (only counts 'active' and 'busy' status)
    accumulatedActiveTime: {
      type: Number,
      default: 0,
      comment: 'Total active minutes in current session (only active/busy time)',
    },
    lastStatusChangeTime: {
      type: Date,
      default: null,
      comment: 'Timestamp when workStatus last changed',
    },

    // Profile
    profileImage: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },

    // Creator reference
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Location info
    ip: { type: String, default: null },
    locationName: { type: String, default: null }, // Human-readable location from Geocam
    location: {
      country: { type: String, default: null },
      region: { type: String, default: null },
      city: { type: String, default: null },
      isp: { type: String, default: null },
      timezone: { type: String, default: null },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    // Terms & Conditions acceptance (pre-login gate)
    acceptedTerms: { type: Boolean, default: false, index: true },
    acceptedTermsAt: { type: Date, default: null },
    // Login security / lockout
    failedLoginAttempts: { type: Number, default: 0 },
    failedIpAttempts: { type: Number, default: 0 }, // Track IP mismatch attempts for Agent/TL/QA
    isBlocked: { type: Boolean, default: false, index: true },
    blockedAt: { type: Date, default: null },
    blockedReason: { type: String, default: null },
  },
  { timestamps: true }
);

// ==================== INDEXES FOR MULTI-TENANCY ====================
UserSchema.index({ organizationId: 1, role: 1 });
UserSchema.index({ organizationId: 1, email: 1 });
UserSchema.index({ organizationId: 1, workStatus: 1 });
UserSchema.index({ guestIdentifier: 1 }, { sparse: true });
UserSchema.index({ organizationId: 1, tier: 1, department: 1, role: 1 });
UserSchema.index({ customerId: 1 }, { sparse: true });
UserSchema.index({ organizationId: 1, customerId: 1 });
UserSchema.index({ organizationId: 1, mobile: 1 });
UserSchema.index({ organizationId: 1, 'address.city': 1, 'address.state': 1 });

module.exports = mongoose.model('User', UserSchema);
