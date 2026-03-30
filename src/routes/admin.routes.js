const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/tenantAuth');
const {
  toggleLocationAccess,
  getLocationAccessSettings,
  getMyOrganization,
  getAllEmployeesWithPasswords
} = require('../controllers/admin.controller');

// All routes require authentication and Admin role
router.use(authenticateToken);
router.use(authorize('Admin'));

// ==================== ORGANIZATION SETTINGS ====================
router.get('/organization', getMyOrganization);

// ==================== LOCATION ACCESS SETTINGS ====================
router.get('/location-access', getLocationAccessSettings);
router.put('/location-access/toggle', toggleLocationAccess);

// ==================== PASSWORD MANAGEMENT ====================
// WARNING: Security-sensitive endpoint - returns hashed passwords
router.get('/employees/passwords', getAllEmployeesWithPasswords);

module.exports = router;
