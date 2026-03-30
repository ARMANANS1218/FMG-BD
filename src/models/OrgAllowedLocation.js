const mongoose = require('mongoose');

const orgAllowedLocationSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },

  label: { type: String }, // e.g., HQ, Branch, Admin Home Office
  address: { type: String },

  // GeoJSON Point [lng, lat]
  location: {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true },
  },
  radiusMeters: { type: Number, default: 100, min: 5 },

  type: { type: String, enum: ['permanent', 'temporary'], default: 'permanent' },
  startAt: { type: Date },
  endAt: { type: Date },

  isActive: { type: Boolean, default: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // SuperAdmin who approved
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin who requested
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revokedAt: { type: Date },
  reactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reactivatedAt: { type: Date },
}, { timestamps: true });

orgAllowedLocationSchema.index({ organizationId: 1, isActive: 1 });
orgAllowedLocationSchema.index({ location: '2dsphere' });
orgAllowedLocationSchema.index({ endAt: 1 });

module.exports = mongoose.model('OrgAllowedLocation', orgAllowedLocationSchema);
