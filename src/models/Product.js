const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
    {
        productName: {
            type: String,
            required: true,
            trim: true,
        },
        brand: {
            type: String,
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
            trim: true,
        },
        status: {
            type: String,
            enum: ['Active', 'Inactive', 'Discontinued'],
            default: 'Active',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Product', ProductSchema);
