const mongoose = require('mongoose');

const CaseSchema = new mongoose.Schema(
    {
        caseId: {
            type: String,
            unique: true,
            index: true,
        },
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
        },
        batchNumber: {
            type: String,
            trim: true,
        },
        expiryDate: {
            type: Date,
        },
        manufacturingDate: {
            type: Date,
        },
        purchaseDate: {
            type: Date,
        },
        purchaseChannel: {
            type: String,
            trim: true,
        },
        orderNumber: {
            type: String,
            trim: true,
        },
        quantityPurchased: {
            type: Number,
            min: 0,
        },
        quantityAffected: {
            type: Number,
            min: 0,
        },
        complaintCategory: {
            type: String,
            trim: true,
        },
        subCategory: {
            type: String,
            trim: true,
        },
        severityLevel: {
            type: String,
            enum: ['Low', 'Medium', 'High', 'Critical'],
            default: 'Low',
        },
        healthRisk: {
            type: Boolean,
            default: false,
        },
        regulatoryRisk: {
            type: Boolean,
            default: false,
        },
        escalationRequired: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ['Open', 'Pending', 'Closed', 'Escalated'],
            default: 'Open',
        },
        assignedAgentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        assignedTLId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        closedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true } // automatically adds createdAt and updatedAt
);

// Auto-generate caseId before saving
CaseSchema.pre('save', async function (next) {
    if (this.isNew && !this.caseId) {
        // Basic auto-increment logic or random generation
        // For a robust system, an auto-increment plugin or counter collection is better,
        // but here we use a simple CAS-timestamp based generation to ensure uniqueness
        const randomDigits = Math.floor(1000000 + Math.random() * 9000000);
        this.caseId = `CAS-${randomDigits}`;
    }
    next();
});

module.exports = mongoose.model('Case', CaseSchema);
