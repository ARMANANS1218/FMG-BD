const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
  formatted: String,
  address_line1: String,
  address_line2: String,
  street: String,
  housenumber: String,
  district: String,
  suburb: String,
  city: String,
  state: String,
  state_code: String,
  country: String,
  country_code: String,
  postcode: String,
  plus_code: String,
  timezone: Object,
}, { _id: false });

const CaptureSchema = new mongoose.Schema({
  imageUrl: String,
  imagePublicId: String,
  lat: Number,
  lon: Number,
  accuracy: Number,
  address: AddressSchema,
  capturedAt: { type: Date },
}, { _id: false });

const GeocamSessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  employeeName: { type: String, required: true },
  role: { type: String, enum: ['Agent','QA','TL'], required: true },
  status: { type: String, enum: ['pending','used','expired'], default: 'pending' },
  expiresAt: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  capture: CaptureSchema,
}, { timestamps: true });

GeocamSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('GeocamSession', GeocamSessionSchema);
