const mongoose = require('mongoose');

const OrgEmailConfigSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String },
    emailAddress: { type: String, required: true },
    imap: {
      host: { type: String, default: 'mail.bitmaxtest.com' },
      port: { type: Number, default: 993 },
      secure: { type: Boolean, default: true },
      username: { type: String, required: true },
      password: { type: String, required: true },
    },
    smtp: {
      host: { type: String, default: 'mail.bitmaxtest.com' },
      port: { type: Number, default: 465 },
      secure: { type: Boolean, default: true },
      username: { type: String },
      password: { type: String },
      fromName: { type: String },
    },
    isEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

OrgEmailConfigSchema.index({ organization: 1, emailAddress: 1 }, { unique: true });

module.exports = mongoose.model('OrgEmailConfig', OrgEmailConfigSchema);
