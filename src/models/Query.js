const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');
const moment = require('moment-timezone');

// Message Schema for Query Chat
const queryMessageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  senderName: {
    type: String,
    required: true
  },
  senderRole: {
    type: String,
    enum: ['Customer', 'Agent', 'QA', 'TL', 'Admin', 'System'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: getIndiaTime
  },
  isRead: {
    type: Boolean,
    default: false
  }
});

// Transfer History Schema
const transferHistorySchema = new mongoose.Schema({
  fromAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  fromAgentName: String,
  toAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  toAgentName: String,
  transferredAt: {
    type: Date,
    default: getIndiaTime
  },
  reason: String,
  status: {
    type: String,
    enum: ['Requested', 'Accepted', 'Rejected'],
    default: 'Requested'
  },
  requestedAt: {
    type: Date,
    default: getIndiaTime
  },
  acceptedAt: Date
});

// Feedback Schema
const feedbackSchema = new mongoose.Schema({
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  comment: String,
  submittedAt: {
    type: Date,
    default: getIndiaTime
  }
});

// Main Query Schema
const querySchema = new mongoose.Schema({
  // ==================== MULTI-TENANT FIELD ====================
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  
  petitionId: {
    type: String,
    required: true
  },
  // Optional link to widget conversation (for guest chats)
  conversationId: {
    type: String,
    required: false,
    index: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Changed: Not required for guest customers
    default: null
  },
  customerName: {
    type: String,
    required: true
  },
  customerEmail: {
    type: String,
    required: true
  },
  customerPhone: String,
  
  // ==================== GUEST CUSTOMER TRACKING ====================
  isGuestCustomer: {
    type: Boolean,
    default: false
  },
  // ==================== AIRLINE CRM CASE FIELDS ====================
  // Link to specific Booking context
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null
  },

  subject: {
    type: String,
    required: true
  },
  
  // 4. Query / Case Information
  category: {
    type: String,
    enum: ['Booking', 'Cancellation', 'Reschedule', 'Refund', 'Baggage', 'Check-in', 'Meal / Seat', 'Visa / Travel Advisory', 'Other'],
    default: 'Other'
  },
  subCategory: {
    type: String, // e.g., "Excess Baggage", "Meal Preference"
    trim: true,
    default: null
  },
  concernDescription: {
    type: String,
    trim: true,
    default: null
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Pending', 'Open', 'Accepted', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Transferred'], // Added 'Accepted' for workflow
    default: 'Pending'
  },

  // 5. Action Taken by Agent
  actionType: {
    type: String,
    enum: ['Informational', 'Modification', 'Escalation', 'Troubleshooting', 'None'],
    default: 'None'
  },
  changesMade: {
    type: Boolean,
    default: false
  },
  remarks: {
    type: String,
    trim: true
  },
  policyReference: {
    type: String, // e.g., "Refund Policy Sec 4.2"
    trim: true
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  tatShared: {
    type: String, // e.g., "48 Hours"
    trim: true
  },

  // 6. Escalation & Resolution
  escalationLevel: {
    type: String,
    enum: ['L1', 'L2', 'Back Office', 'Management'],
    default: 'L1'
  },
  escalationReason: {
    type: String,
    trim: true
  },
  resolutionCode: {
    type: String, // e.g., "RES-001"
    trim: true
  },
  resolutionSummary: {
    type: String,
    trim: true
  },

  // 7. Payment & Refund
  paymentDetails: {
    modeOfPayment: { type: String, enum: ['Credit Card', 'Debit Card', 'Net Banking', 'Wallet', 'UPI', 'Cash'], default: null },
    transactionId: { type: String, default: null },
    refundEligibility: { type: Boolean, default: false },
    refundStatus: { type: String, enum: ['Initiated', 'Processed', 'Failed', 'Pending'], default: 'Pending' },
    expectedRefundTimeline: { type: String, default: null },
    currency: { type: String, default: 'USD' }
  },

  // 8. Customer Feedback & Quality
  qualityMetrics: {
    csatScore: { type: Number, min: 1, max: 5, default: null },
    fcr: { type: Boolean, default: null }, // First Contact Resolution
    qaScore: { type: Number, min: 0, max: 100, default: null },
    complianceCheck: { type: Boolean, default: null }
  },

  // 9. System Tags
  slaBreach: {
    type: Boolean,
    default: false
  },
  autoTags: [{ type: String }],

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedToName: String,
  assignedToRole: String,
  assignedAt: Date,
  messages: [queryMessageSchema],
  transferHistory: [transferHistorySchema],
  feedback: feedbackSchema,
  isActive: {
    type: Boolean,
    default: true
  },
  // Auto-expire queries after 24 hours of inactivity
  lastActivityAt: {
    type: Date,
    default: getIndiaTime
  },
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    }
  },
  resolvedAt: Date,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedByName: String,
  createdAt: {
    type: Date,
    default: getIndiaTime
  },
  updatedAt: {
    type: Date,
    default: getIndiaTime
  }
}, { timestamps: true });

// Normalize string timestamps (legacy records saved with formatted string) to Date objects on retrieval
querySchema.post('init', function(doc) {
  const tryParse = (val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'string') {
      // Legacy format: 'DD MMM YYYY hh:mm:ss A' in IST
      const m = moment.tz(val, 'DD MMM YYYY hh:mm:ss A', 'Asia/Kolkata');
      if (m.isValid()) return m.toDate();
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  };

  ['createdAt','updatedAt','lastActivityAt','resolvedAt','assignedAt','expiresAt'].forEach(f => {
    const parsed = tryParse(doc[f]);
    if (parsed) doc[f] = parsed;
  });

  if (Array.isArray(doc.messages)) {
    doc.messages.forEach(m => {
      const parsed = tryParse(m.timestamp);
      if (parsed) m.timestamp = parsed;
    });
  }
});

// ==================== INDEXES FOR MULTI-TENANCY & PERFORMANCE ====================
querySchema.index({ organizationId: 1, status: 1, createdAt: -1 });
querySchema.index({ organizationId: 1, assignedTo: 1 });
querySchema.index({ organizationId: 1, category: 1 });
querySchema.index({ petitionId: 1 });
querySchema.index({ customer: 1 });
querySchema.index({ status: 1 });
querySchema.index({ assignedTo: 1 });
querySchema.index({ category: 1 });
querySchema.index({ createdAt: -1 });

// Middleware to update lastActivityAt on new messages
querySchema.pre('save', function(next) {
  if (this.isModified('messages')) {
    this.lastActivityAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Query', querySchema);
