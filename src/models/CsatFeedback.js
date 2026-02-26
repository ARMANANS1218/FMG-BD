const mongoose = require('mongoose');

const CsatFeedbackSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        csatScore: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        dsatFlag: {
            type: Boolean,
            default: function () {
                // Automatically check if it's a 'Dissatisfied' score (e.g., 1 or 2)
                return this.csatScore <= 2;
            },
        },
        comments: {
            type: String,
            trim: true,
        },
        submittedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('CsatFeedback', CsatFeedbackSchema);
