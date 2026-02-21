const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { validateToken } = require('../utils/validateToken');

// All routes require authentication
router.use(validateToken);

// Admin routes
router.post('/generate', invoiceController.generateInvoice);
router.put('/:id/publish', invoiceController.publishInvoice);
router.put('/:id/unpublish', invoiceController.unpublishInvoice);
router.get('/all', invoiceController.getAllInvoices);
router.get('/:month/:year', invoiceController.getInvoiceByMonth);

// Management route
router.get('/management', invoiceController.getInvoiceForManagement);

module.exports = router;
