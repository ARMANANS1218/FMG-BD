const express = require('express');
const productController = require('../controllers/product.controller');
const { validateToken } = require('../utils/validateToken');

const router = express.Router();

// Required routes for Product Management
router.post('/', validateToken, productController.createProduct);             // Create single
router.post('/bulk', validateToken, productController.bulkImportProducts);     // Bulk import
router.get('/', validateToken, productController.getAllProducts);              // List all (with search & filter query params)
router.get('/:id', validateToken, productController.getProductById);           // Get single product
router.put('/:id', validateToken, productController.updateProduct);            // Update product
router.delete('/:id', validateToken, productController.deleteProduct);         // Soft delete product

module.exports = router;
