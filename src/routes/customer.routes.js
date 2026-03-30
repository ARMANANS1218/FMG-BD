const express = require('express');
const router = express.Router();

const { 
  customerRegister, 
  customerLogin, 
  getCustomers, 
  getProfile, 
  updateProfile,
  createCustomer,
  updateCustomerDetails,
  searchCustomers,
  getCustomerById,
  getCustomerList,
  updateCustomerProfileImage,
  bulkUploadCustomers,
  downloadBulkUploadTemplate
} = require('../controllers/customer.controller');
const upload = require('../utils/uploadProfile');
const uploadExcel = require('../utils/uploadExcel');
const { validateToken } = require('../utils/validateToken');

// REGISTER & LOGIN
router.post('/register', upload.single("profileImage"), customerRegister);
router.post('/login', customerLogin);

// PROFILE MANAGEMENT
router.get('/profile', validateToken, getProfile);
router.put('/profile-update', upload.single('profileImage'), validateToken, updateProfile);

// GET ALL CUSTOMERS
router.get('/', getCustomers);

// CUSTOMER MANAGEMENT (Agent/TL/QA)
router.post('/create', validateToken, createCustomer);
router.put('/:id', validateToken, updateCustomerDetails);
router.delete('/:id', validateToken, require('../controllers/customer.controller').deleteCustomer);
router.get('/search', validateToken, searchCustomers);
router.get('/list', validateToken, getCustomerList);
router.get('/:id', validateToken, getCustomerById);

// UPDATE CUSTOMER PROFILE IMAGE
router.put('/update-profile-image', validateToken, updateCustomerProfileImage);

// QUERY HISTORY MANAGEMENT
const { addQueryToCustomer, getCustomerQueryHistory, findCustomerByQuery } = require('../controllers/customer.controller');
router.post('/add-query', validateToken, addQueryToCustomer);
router.get('/:customerId/query-history', validateToken, getCustomerQueryHistory);
router.get('/find-by-query/:queryId', validateToken, findCustomerByQuery);

// PLAN HISTORY MANAGEMENT
const { addPlanToCustomer, updatePlanInHistory, getCustomerPlanHistory, deletePlanFromHistory } = require('../controllers/customer.controller');
router.post('/:customerId/add-plan', validateToken, addPlanToCustomer);
router.put('/:customerId/plan/:planId', validateToken, updatePlanInHistory);
router.delete('/:customerId/plan/:planId', validateToken, deletePlanFromHistory);
router.get('/:customerId/plan-history', validateToken, getCustomerPlanHistory);

// ==================== BULK UPLOAD FROM EXCEL ====================
// Download Excel template for bulk upload
router.get('/bulk-upload/template', validateToken, downloadBulkUploadTemplate);

// Bulk upload customers from Excel file (Admin only)
router.post('/bulk-upload', validateToken, uploadExcel.single('excelFile'), bulkUploadCustomers);

module.exports = router;
