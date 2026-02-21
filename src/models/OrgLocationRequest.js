const mongoose = require('mongoose');

const orgLocationRequestSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Admin user

  address: { type: String },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  requestedRadius: { type: Number, default: 100, min: 5 },

  reason: { type: String, required: true },
  requestType: { type: String, enum: ['temporary', 'permanent'], default: 'permanent' },
  startAt: { type: Date },
  endAt: { type: Date },
  emergency: { type: Boolean, default: false },

  status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'stopped'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // SuperAdmin
  reviewedAt: { type: Date },
  reviewComments: { type: String },
  // Link to created allowed location (set on approval)
  allowedLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgAllowedLocation' },

  stoppedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  stoppedAt: { type: Date },
  reactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reactivatedAt: { type: Date },
}, { timestamps: true });

orgLocationRequestSchema.index({ organizationId: 1, status: 1, createdAt: 1 });
orgLocationRequestSchema.index({ emergency: 1, status: 1, createdAt: 1 });
orgLocationRequestSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('OrgLocationRequest', orgLocationRequestSchema);
