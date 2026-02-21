const mongoose = require('mongoose');

// Email Ticket model (namespaced to avoid conflict with existing Ticket model)
// Mongoose model name: EmailTicket

const TicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    subject: { type: String },
    customerName: { type: String },
    customerEmail: { type: String, index: true },
    channel: { type: String, enum: ['email', 'internal', 'widget'], required: true },
    status: { type: String, enum: ['open', 'pending', 'closed'], default: 'pending', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    category: { type: String, default: 'general' }, // general, technical, billing, feature, bug
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Who assigned the ticket (QA/TL)
    assignedAt: { type: Date, default: null }, // When the ticket was assigned
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Who created internal ticket

    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    emailThreadRootId: { type: String, index: true }, // Message-ID of the first email in thread

    // Airline CRM Fields
    pnr: { type: String, trim: true, uppercase: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },

    // Team inbox assignment (category-based)
    teamInbox: { type: String, default: 'general', index: true },

    // Tags (technical_issue, billing, FRD Overdue, RD Overdue, etc.)
    tags: [{ type: String, trim: true }],

    // Watchers (users following this ticket)
    watchers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Last activity timestamp for sorting by activity
    lastActivityAt: { type: Date, default: Date.now, index: true },

    // Unread count for assignee
    unreadCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } }
);

TicketSchema.index({ organization: 1, status: 1, createdAt: -1 });
TicketSchema.index({ organization: 1, ticketId: 1 });
TicketSchema.index({ organization: 1, teamInbox: 1, status: 1, lastActivityAt: -1 });
TicketSchema.index({ organization: 1, assignedTo: 1, status: 1, lastActivityAt: -1 });

module.exports = mongoose.model('EmailTicket', TicketSchema);
