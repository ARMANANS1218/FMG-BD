const Product = require('../models/Product');

// Create a new Master SKU Product
exports.createProduct = async (req, res) => {
    try {
        const { productName, brand, skuCode, category, status } = req.body;

        const existingProduct = await Product.findOne({ skuCode });
        if (existingProduct) {
            return res.status(400).json({ status: false, message: 'SKU Code already exists' });
        }

        const newProduct = await Product.create({
            productName,
            brand,
            skuCode,
            category,
            status: status || 'Active'
        });

        res.status(201).json({
            status: true,
            message: 'Product created successfully',
            data: newProduct
        });
    } catch (error) {
        console.error('Create Product Error:', error);
        res.status(500).json({ status: false, message: 'Failed to create product', error: error.message });
    }
};

// Get all Products
exports.getAllProducts = async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.status(200).json({ status: true, data: products });
    } catch (error) {
        console.error('Get Products Error:', error);
        res.status(500).json({ status: false, message: 'Failed to get products', error: error.message });
    }
};
