const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { validateToken } = require('../utils/validateToken');

// All routes require authentication
router.use(validateToken);

// Admin routes
router.post('/generate', invoiceController.generateInvoice);
router.put('/overwrite-login-hours', invoiceController.overwriteLoginHours);
router.put('/excluded-employees', invoiceController.updateExcludedEmployees);
router.put('/:id/publish', invoiceController.publishInvoice);
router.put('/:id/unpublish', invoiceController.unpublishInvoice);
router.put('/:id/management-review', invoiceController.reviewInvoiceByManagement);
router.put('/:id/transaction-status', invoiceController.updateTransactionStatus);
router.put('/:id/bank-details', invoiceController.updateBankDetails);
router.get('/all', invoiceController.getAllInvoices);
router.get('/login-hours/:month/:year', invoiceController.getLoginHoursByMonth);
router.get('/daily-breakdown/:month/:year', invoiceController.getDailyBreakdown);

// Management route
router.get('/management', invoiceController.getInvoiceForManagement);
router.get('/management/transactions', invoiceController.getInvoiceTransactions);

// Bank details route
router.get('/:id/bank-details', invoiceController.getBankDetails);

router.get('/:month/:year', invoiceController.getInvoiceByMonth);

module.exports = router;
