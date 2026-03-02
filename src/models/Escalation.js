const mongoose = require('mongoose');

const EscalationSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        escalatedTo: {
            type: String,
            enum: ['QA', 'TL', 'Legal', 'Supply Chain', 'Manager', 'Admin'],
            required: true,
        },
        escalationDate: {
            type: Date,
            default: Date.now,
        },
        rootCauseCategory: {
            type: String,
            trim: true,
        },
        correctiveAction: {
            type: String,
            trim: true,
        },
        fsaNotificationRequired: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Escalation', EscalationSchema);
