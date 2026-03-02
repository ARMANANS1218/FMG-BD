const mongoose = require('mongoose');

const ChatLogSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        channel: {
            type: String,
            enum: ['Web', 'WhatsApp', 'Social', 'Email', 'Phone'],
            default: 'Web',
        },
        firstResponseTime: {
            type: Number, // in seconds or minutes
            default: 0,
        },
        avgResponseTime: {
            type: Number, // in seconds or minutes
            default: 0,
        },
        chatDuration: {
            type: Number, // in seconds or minutes
            default: 0,
        },
        holdTime: {
            type: Number, // in seconds
            default: 0,
        },
        transferCount: {
            type: Number,
            default: 0,
        },
        resolutionType: {
            type: String,
            trim: true,
        },
        refundAmount: {
            type: Number,
            default: 0,
        },
        compensationType: {
            type: String,
            trim: true,
        },
        courierRequired: {
            type: Boolean,
            default: false,
        },
        returnLabelSent: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ChatLog', ChatLogSchema);
