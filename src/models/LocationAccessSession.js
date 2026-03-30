const mongoose = require('mongoose');

const locationAccessSessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Admin who created the link

    clientName: { type: String }, // Optional name for who the link is for

    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'used', 'expired'],
      default: 'pending',
    },

    // Track usage
    usedAt: { type: Date },
    createdRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgLocationRequest' }, // The request created from this session
  },
  { timestamps: true }
);

// Auto-expire documents after they expire (TTL index)
// Note: This removes the document from DB. If we want to keep history, we shouldn't use TTL or set it to a long time.
// For now, let's keep it to avoid clutter, maybe 7 days after expiry.
locationAccessSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('LocationAccessSession', locationAccessSessionSchema);
