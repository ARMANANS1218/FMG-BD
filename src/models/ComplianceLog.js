const mongoose = require('mongoose');

const ComplianceLogSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            default: null, // Depending on if all logs are attached to cases
            index: true,
        },
        gdprConsent: {
            type: Boolean,
            default: false,
        },
        dataRetentionExpiry: {
            type: Date,
            default: null, // Compute e.g. 5 yrs from creation
        },
        deletionRequested: {
            type: Boolean,
            default: false,
        },
        subjectAccessRequest: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ComplianceLog', ComplianceLogSchema);
