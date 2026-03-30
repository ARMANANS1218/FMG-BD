const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const CustomerSchema = new mongoose.Schema(
  {
    // ==================== MULTI-TENANT FIELD ====================
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },

    // ==================== BASIC INFORMATION ====================
    customerId: {
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
    visiblePassword: {
      type: String,
      default: null,
      select: false,
    },
    encryptedPassword: {
      type: String,
      default: null,
      select: false,
    },

    // ==================== CUSTOMER TYPE ====================
    customerType: {
      type: String,
      enum: ['registered', 'guest'],
      default: 'registered',
    },
    guestIdentifier: {
      type: String,
    },

    // ==================== GOVERNMENT ID INFORMATION ====================
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

    // ==================== ADDRESS INFORMATION ====================
    address: {
      street: { type: String, default: null, trim: true },
      locality: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      state: { type: String, default: null, trim: true },
      country: { type: String, default: null, trim: true },
      postalCode: { type: String, default: null, trim: true },
      landmark: { type: String, default: null, trim: true },
    },

    // ==================== SERVICE / BILLING INFORMATION ====================
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
      trim: true,
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

    // ==================== PLAN HISTORY ====================
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

    // ==================== QUERY HISTORY ====================
    queryHistory: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Query',
      },
    ],

    // ==================== DEVICE INFORMATION ====================
    deviceInfo: {
      model: { type: String, default: null, trim: true },
      imei: { type: String, default: null, trim: true },
    },

    // ==================== SIM INFORMATION ====================
    simNumber: {
      type: String,
      default: null,
      trim: true,
    },
    simType: {
      type: String,
      enum: ['Physical', 'eSIM', null],
      default: null,
    },

    // ==================== DATE OF BIRTH / GENDER ====================
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', null],
      default: null,
    },

    // ==================== PROFILE ====================
    profileImage: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },

    // ==================== STATUS FIELDS ====================
    is_active: { type: Boolean, default: false },
    workStatus: {
      type: String,
      enum: ['active', 'break', 'offline', 'busy'],
      default: 'offline',
    },
    is_typing: { type: Boolean, default: false },

    // ==================== TIMESTAMPS ====================
    login_time: { type: Date, default: getIndiaTime },
    logout_time: { type: Date, default: getIndiaTime },

    // ==================== NOTES ====================
    notes: {
      type: String,
      default: null,
    },

    // ==================== CREATOR / LINK ====================
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ==================== LOCATION ====================
    ip: { type: String, default: null },
    locationName: { type: String, default: null },
    location: {
      country: { type: String, default: null },
      region: { type: String, default: null },
      city: { type: String, default: null },
      isp: { type: String, default: null },
      timezone: { type: String, default: null },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

// ==================== INDEXES FOR MULTI-TENANCY & SEARCH ====================
CustomerSchema.index({ organizationId: 1 });
CustomerSchema.index({ organizationId: 1, email: 1 });
CustomerSchema.index({ organizationId: 1, mobile: 1 });
CustomerSchema.index({ organizationId: 1, customerId: 1 });
CustomerSchema.index({ customerId: 1 }, { sparse: true });
CustomerSchema.index({ organizationId: 1, 'address.city': 1, 'address.state': 1 });
CustomerSchema.index({ organizationId: 1, name: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);
