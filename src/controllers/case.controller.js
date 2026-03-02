const Case = require('../models/Case');
const User = require('../models/User');
const Product = require('../models/Product');

// Create a new FMCG Case
exports.createCase = async (req, res) => {
    try {
        const {
            customerId,
            productId,
            batchNumber,
            expiryDate,
            manufacturingDate,
            purchaseDate,
            purchaseChannel,
            orderNumber,
            quantityPurchased,
            quantityAffected,
            complaintCategory,
            subCategory,
            severityLevel,
            healthRisk,
            regulatoryRisk,
            escalationRequired,
            status
        } = req.body;

        // Validate relations
        const customer = await User.findById(customerId);
        if (!customer || customer.role !== 'Customer') {
            return res.status(404).json({ status: false, message: 'Customer not found' });
        }

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ status: false, message: 'Product not found' });
        }

        const newCase = await Case.create({
            customerId,
            productId,
            batchNumber,
            expiryDate,
            manufacturingDate,
            purchaseDate,
            purchaseChannel,
            orderNumber,
            quantityPurchased,
            quantityAffected,
            complaintCategory,
            subCategory,
            severityLevel,
            healthRisk,
            regulatoryRisk,
            escalationRequired,
            status: status || 'Open'
            // assignedAgentId: req.user?.id || null 
        });

        res.status(201).json({
            status: true,
            message: 'Case created successfully',
            data: newCase
        });
    } catch (error) {
        console.error('Create Case Error:', error);
        res.status(500).json({ status: false, message: 'Failed to create Case', error: error.message });
    }
};

// Get all Cases
exports.getAllCases = async (req, res) => {
    try {
        const cases = await Case.find()
            .populate('customerId', 'name email phone contactId')
            .populate('productId', 'productName brand skuCode')
            .populate('assignedAgentId', 'name email role')
            .sort({ createdAt: -1 });

        res.status(200).json({ status: true, data: cases });
    } catch (error) {
        console.error('Get Cases Error:', error);
        res.status(500).json({ status: false, message: 'Failed to get cases', error: error.message });
    }
};
