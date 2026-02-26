const mongoose = require('mongoose');

const SlaTrackerSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        slaTarget: {
            type: Date,
            required: true,
        },
        slaStatus: {
            type: String,
            enum: ['Met', 'Missed', 'In Progress', 'Snoozed', 'Cancelled'],
            default: 'In Progress',
        },
        breachFlag: {
            type: Boolean,
            default: false,
        },
        breachTime: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('SlaTracker', SlaTrackerSchema);
