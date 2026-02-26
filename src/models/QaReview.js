const mongoose = require('mongoose');

const QaReviewSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        agentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        complianceScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        communicationScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        knowledgeScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        slaScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        resolutionScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        softSkillScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        totalScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        qaComments: {
            type: String,
            trim: true,
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        reviewDate: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('QaReview', QaReviewSchema);
