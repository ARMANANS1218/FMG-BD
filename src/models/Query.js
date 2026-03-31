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
    enum: ['Customer', 'Agent', 'QA', 'TL', 'Admin', 'Dev', 'System'],
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
    ref: 'Customer',
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
  subject: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: [
      'Accounts',
      'Technicals',
      'Billings',
      'Supports',
      'Quality Issue',
      'Damaged Product',
      'Missing Item',
      'Expired Product',
      'Allergy Concern',
      'Packaging Issue',
      'Refund Request',
      'Replacement Request',
      'General Inquiry',
    ],
    default: 'General Inquiry'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'In Progress', 'Resolved', 'Expired', 'Transferred'],
    default: 'Pending'
  },
  firstResponseAt: {
    type: Date,
    default: null,
  },
  firstResponseTimeSeconds: {
    type: Number,
    default: null,
  },
  slaTargetSeconds: {
    type: Number,
    default: 60,
  },
  isBreached: {
    type: Boolean,
    default: false,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedToName: String,
  assignedToRole: String,
  assignedAt: Date,
  // ==================== TIER-BASED ESCALATION TRACKING ====================
  escalatedToTier: {
    type: String,
    enum: ['Tier-1', 'Tier-2', 'Tier-3', null],
    default: null
  },
  escalatedToDev: {
    type: Boolean,
    default: false
  },
  escalatedAt: {
    type: Date,
    default: null
  },
  escalatedFromTier: {
    type: String,
    enum: ['Tier-1', 'Tier-2', 'Tier-3', null],
    default: null
  },
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
  devResolutionRemark: {
    message: {
      type: String,
      default: ''
    },
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    byName: {
      type: String,
      default: ''
    },
    createdAt: {
      type: Date,
      default: null
    },
    updatedAt: {
      type: Date,
      default: null
    }
  },
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
querySchema.index({ organizationId: 1, createdAt: -1 });
querySchema.index({ organizationId: 1, assignedTo: 1 });
querySchema.index({ organizationId: 1, category: 1 });
querySchema.index({ organizationId: 1, petitionId: 1 });
querySchema.index({ organizationId: 1, isBreached: 1, createdAt: -1 });
querySchema.index({ organizationId: 1, 'transferHistory.fromAgent': 1 });
querySchema.index({ organizationId: 1, 'transferHistory.toAgent': 1 });
querySchema.index({ petitionId: 1 });
querySchema.index({ customer: 1 });
querySchema.index({ status: 1 });
querySchema.index({ assignedTo: 1 });
querySchema.index({ category: 1 });
querySchema.index({ createdAt: -1 });

// Middleware to update lastActivityAt on new messages
querySchema.pre('save', function(next) {
  if (!this.slaTargetSeconds || Number.isNaN(this.slaTargetSeconds)) {
    this.slaTargetSeconds = Number(process.env.UK_CHAT_FRT_TARGET_SECONDS) || 60;
  }

  if (this.isModified('messages')) {
    this.lastActivityAt = new Date();

    if (!this.firstResponseAt && Array.isArray(this.messages) && this.messages.length > 0) {
      const firstAgentReply = this.messages.find(
        (msg) => msg?.senderRole && ['Agent', 'QA', 'TL', 'Admin', 'Dev'].includes(msg.senderRole)
      );

      if (firstAgentReply?.timestamp) {
        const queryCreatedAt = this.createdAt ? new Date(this.createdAt) : new Date();
        const responseAt = new Date(firstAgentReply.timestamp);
        const responseSeconds = Math.max(
          0,
          Math.round((responseAt.getTime() - queryCreatedAt.getTime()) / 1000)
        );

        this.firstResponseAt = responseAt;
        this.firstResponseTimeSeconds = responseSeconds;
        this.isBreached = responseSeconds > this.slaTargetSeconds;
      }
    }
  }
  next();
});

module.exports = mongoose.model('Query', querySchema);
