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
  requestDataDeletion,
  requestSubjectAccess,
  updateConsent,
  getPendingGdprRequests,
  resolveGdprRequest
} = require('../controllers/customer.controller');
const upload = require('../utils/uploadProfile');
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
router.get('/search', validateToken, searchCustomers);
router.get('/list', validateToken, getCustomerList);

// GDPR COMPLIANCE ROUTES (Must come before /:id to prevent route collision)
router.get('/gdpr/requests', validateToken, getPendingGdprRequests);

// ID-BASED ROUTES
router.get('/:id', validateToken, getCustomerById);
router.put('/:id', validateToken, updateCustomerDetails);
router.delete('/:id', validateToken, require('../controllers/customer.controller').deleteCustomer);

// GDPR COMPLIANCE (ID-based)
router.post('/:id/gdpr/delete-request', validateToken, requestDataDeletion);
router.post('/:id/gdpr/sar', validateToken, requestSubjectAccess);
router.put('/:id/consent', validateToken, updateConsent);
router.put('/gdpr/:id/resolve', validateToken, resolveGdprRequest);

// UPDATE CUSTOMER PROFILE IMAGE
router.put('/update-profile-image', validateToken, updateCustomerProfileImage);

// QUERY HISTORY MANAGEMENT
const { addQueryToCustomer, getCustomerQueryHistory, findCustomerByQuery } = require('../controllers/customer.controller');
router.post('/add-query', validateToken, addQueryToCustomer);
router.get('/:customerId/query-history', validateToken, getCustomerQueryHistory);
router.get('/find-by-query/:queryId', validateToken, findCustomerByQuery);

module.exports = router;
