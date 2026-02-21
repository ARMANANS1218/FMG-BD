const mongoose = require('mongoose');

// Email Ticket Message model (namespaced)
// Mongoose model name: EmailTicketMessage

const AttachmentSchema = new mongoose.Schema(
  {
    filename: String,
    contentType: String,
    size: Number,
    cid: String,
    path: String, // Legacy field for email attachments
    url: String, // Cloudinary URL or full URL for accessing the file
    publicId: String, // Cloudinary public ID for deletion
  },
  { _id: false }
);

const TicketMessageSchema = new mongoose.Schema(
  {
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTicket', index: true },
    ticketId: { type: String, index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    senderType: { type: String, enum: ['customer', 'agent', 'qa', 'tl', 'system'], required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // The user who sent the message
    senderName: { type: String }, // For customer names or cached names
    message: { type: String },
    html: { type: String },
    attachments: [AttachmentSchema],

    // Email threading metadata
    externalMessageId: { type: String, index: true }, // Message-ID
    inReplyTo: { type: String, index: true },
    references: [{ type: String }],
    from: { type: String },
    to: [{ type: String }],
    cc: [{ type: String }],
    date: { type: Date },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

TicketMessageSchema.index({ ticketId: 1, createdAt: 1 });

module.exports = mongoose.model('EmailTicketMessage', TicketMessageSchema);
