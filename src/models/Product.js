const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
    {
        organizationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            required: true,
        },
        productName: {
            type: String,
            required: true,
            trim: true,
        },
        brand: {
            type: String,
            required: true,
            trim: true,
        },
        skuCode: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        category: {
            type: String,
            enum: ['Food', 'Beverage', 'Personal Care', 'Household'],
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Product', ProductSchema);
