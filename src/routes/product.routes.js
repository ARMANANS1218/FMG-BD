const express = require('express');
const productController = require('../controllers/product.controller');
const { requireSignin } = require('../middleware/authMiddleware');

const router = express.Router();

// Public or Protected depending on requirement. Assuming Protected for creation, maybe public for viewing if needed.
// For now protecting them to ensure authorized agents manage products.
router.post('/create', requireSignin, productController.createProduct);
router.get('/', requireSignin, productController.getAllProducts);

module.exports = router;
