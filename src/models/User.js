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

    // ==================== FMCG UK CUSTOMER FIELDS ====================
    preferredContactMethod: {
      type: String,
      enum: ['Chat', 'Email', 'Phone'],
      default: 'Email',
    },
    customerType: {
      type: String,
      enum: ['End Consumer', 'Retailer', 'Distributor', 'Online Buyer'],
      default: 'End Consumer',
    },
    vulnerableCustomerFlag: {
      type: Boolean,
      default: false, // UK Compliance
    },
    consentCaptured: {
      captured: { type: Boolean, default: false },
      timestamp: { type: Date },
      gdprStatementVersion: { type: String, default: '1.0' },
    },
    dataRetentionTimer: {
      type: Number,
      default: 6, // 6/12/24 months (Auto)
      enum: [6, 12, 24],
    },
    caseId: { type: String }, // For FMCG Case Mapping
    contactId: { type: String }, // For FMCG Contact Mapping
    // ==================== GDPR COMPLIANCE FIELDS ====================
    dataDeleteRequest: {
      type: Boolean,
      default: false
    },
    dataDeleteRequestDate: {
      type: Date
    },
    dataDeleteRequestStatus: {
      type: String,
      enum: ['Pending', 'Resolved'],
      default: 'Pending'
    },
    subjectAccessRequest: {
      type: Boolean,
      default: false
    },
    subjectAccessRequestDate: {
      type: Date
    },
    subjectAccessRequestStatus: {
      type: String,
      enum: ['Pending', 'Resolved'],
      default: 'Pending'
    },


    // Complete Address Information
    address: {
      street: { type: String, default: null, trim: true },
      locality: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      region: { type: String, default: null, trim: true },
      country: { type: String, default: null, trim: true },
      countryCode: { type: String, default: null, trim: true },
      stateCode: { type: String, default: null, trim: true },
      postalCode: {
        type: String,
        default: null,
        trim: true,
        validate: {
          validator: function (v) {
            // If the value is empty or null, we allow it (meaning postcode is optional)
            if (!v || String(v).trim() === '') return true;

            // Otherwise, validate against UK Postcode standard
            return /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(v);
          },
          message: props => `${props.value} is not a valid UK postcode`
        }
      },
      landmark: { type: String, default: null, trim: true },
    },

    // Notes/Remarks from Agents
    agentNotes: {
      type: String,
      trim: true,
      default: null,
    },

    // System Information
    crmCreatedDate: {
      type: Date,
      default: getIndiaTime,
    },
    lastUpdatedDate: {
      type: Date,
      default: getIndiaTime,
    },

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
      enum: ['SuperAdmin', 'Admin', 'Agent', 'QA', 'TL', 'Management', 'Customer'], // Added TL (Team Leader) and Management
      default: 'Customer',
    },

    guestIdentifier: {
      type: String, // email or phone or session ID
    },

    department: {
      type: String,
      enum: [
        'Quality Assurance',
        'Customer Service',
        'Refunds & Compensation',
        'Logistics & Courier',
        'Supply Chain',
        'Legal & Compliance',
        'Food Safety',
        'Social Media',
        'Management',
        'Other'
      ],
      default: null,
    },
    // Escalation Tier (for structured escalation flows)
    tier: {
      type: String,
      enum: ['Tier-1', 'Tier-2', 'Tier-3'],
      default: null,
      validate: {
        validator: function (v) {
          // Require tier only for operational escalation roles (Agent, QA, TL)
          if (['Agent', 'QA', 'TL'].includes(this.role)) {
            return !!v;
          }
          // Admin does not need a tier; allow null
          return true;
        },
        message: 'Tier is required for Agent, QA and TL roles',
      },
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
    breakReason: { type: String, default: null },

    // Break logs
    breakLogs: [
      {
        start: { type: Date, default: getIndiaTime },
        end: { type: Date, default: getIndiaTime },
        duration: { type: Number },
        reason: { type: String, default: null },
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
