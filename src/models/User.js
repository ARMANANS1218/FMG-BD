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

    // ==================== AIRLINE CRM CUSTOMER FIELDS ====================
    // Customer ID for airline bookings
    customerId: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
    },
    title: {
      type: String,
      enum: ['Mr', 'Ms', 'Mrs', 'Dr', 'Prof', 'Rev', 'Other'],
      default: null,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', 'Prefer not to say'],
      default: null,
    },
    nationality: {
      type: String,
      trim: true,
      default: null,
    },
    preferredLanguage: {
      type: String,
      trim: true,
      default: 'English',
    },
    frequentFlyerNumber: {
      type: String,
      trim: true,
      default: null,
    },

    // Travel Preferences
    travelPreferences: {
      mealPreference: {
        type: String,
        enum: [
          'Regular',
          'Vegetarian',
          'Vegan',
          'Halal',
          'Kosher',
          'Gluten-Free',
          'Diabetic',
          'Low-Calorie',
          'Other',
        ],
        default: 'Regular',
      },
      seatPreference: {
        type: String,
        enum: ['Window', 'Aisle', 'Middle', 'No Preference'],
        default: 'No Preference',
      },
      specialAssistance: {
        type: String,
        trim: true,
        default: null, // e.g., "Wheelchair", "Extra Legroom", etc.
      },
    },

    // Emergency Contact
    emergencyContact: {
      name: { type: String, default: null, trim: true },
      relationship: { type: String, default: null, trim: true },
      phone: { type: String, default: null, trim: true },
      email: { type: String, default: null, trim: true },
    },

    // Travel Document (Passport / National ID)
    travelDocument: {
      documentType: {
        type: String,
        enum: {
          values: ['Passport', 'National ID', 'Other'],
          message: '{VALUE} is not a valid travel document type',
        },
        default: null,
        required: false,
      },
      documentNumber: { type: String, default: null, trim: true },
      issuingCountry: { type: String, default: null, trim: true },
      issueDate: { type: Date, default: null },
      expiryDate: { type: Date, default: null },
    },

    // Complete Address Information
    address: {
      street: { type: String, default: null, trim: true },
      locality: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      state: { type: String, default: null, trim: true },
      country: { type: String, default: null, trim: true },
      countryCode: { type: String, default: null, trim: true },
      stateCode: { type: String, default: null, trim: true },
      postalCode: { type: String, default: null, trim: true },
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
        'Accounts',
        'Technicals',
        'Billings', // Legacy/Internal
        'Booking',
        'Cancellation',
        'Reschedule',
        'Refund',
        'Baggage',
        'Check-in',
        'Meal / Seat',
        'Visa / Travel Advisory',
        'Other', // Airline Specific
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
