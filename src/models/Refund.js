const mongoose = require('mongoose');

const RefundSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        refundAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        approvalLevel: {
            type: String,
            enum: ['Auto', 'TL', 'Manager', 'Admin'],
            default: 'TL',
        },
        approvalId: {
            type: String, // Transaction or reference ID
            trim: true,
        },
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        approvalTimestamp: {
            type: Date,
            default: null,
        },
        tat: {
            type: Number, // Turnaround time in hours/days/seconds depending on requirements
            default: 0,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Refund', RefundSchema);
