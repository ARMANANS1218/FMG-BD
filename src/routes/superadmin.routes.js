const express = require('express');
const router = express.Router();
const { authenticateToken, superAdminOnly } = require('../middleware/tenantAuth');
const {
  createOrganization,
  getAllOrganizations,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
  suspendOrganization,
  activateOrganization,
  regenerateApiKey,
  getDashboardStats,
  updateSubscription,
  createOrganizationAdmin,
  getOrganizationAdmins,
  getAdminDetails,
  updateOrganizationAdmin,
  resetAdminPassword,
  deleteOrganizationAdmin,
  toggleLocationAccess,
  getLocationAccessSettings
} = require('../controllers/superadmin.controller');

const {
  linkAdminToOrganization,
  getUnlinkedAdmins
} = require('../controllers/linkAdmin.controller');

// All routes require SuperAdmin authentication
// Note: authenticateToken handles SuperAdmin validation
router.use(authenticateToken);
router.use(superAdminOnly);

// ==================== ORGANIZATION MANAGEMENT ====================
router.post('/organizations/create', createOrganization);
router.get('/organizations', getAllOrganizations);
router.get('/organizations/:orgId', getOrganizationById);
router.put('/organizations/:orgId', updateOrganization);
router.delete('/organizations/:orgId', deleteOrganization);

// ==================== ORGANIZATION STATUS ====================
router.post('/organizations/:orgId/suspend', suspendOrganization);
router.post('/organizations/:orgId/activate', activateOrganization);

// ==================== SUBSCRIPTION MANAGEMENT ====================
router.put('/organizations/:orgId/subscription', updateSubscription);

// ==================== API KEY MANAGEMENT ====================
router.post('/organizations/:orgId/api-key/regenerate', regenerateApiKey);

// ==================== ORGANIZATION ADMIN MANAGEMENT ====================
router.post('/organizations/:orgId/admin/create', createOrganizationAdmin);
router.get('/organizations/:orgId/admins', getOrganizationAdmins);
router.get('/organizations/:orgId/admins/:adminId', getAdminDetails);
router.put('/organizations/:orgId/admins/:adminId', updateOrganizationAdmin);
router.post('/organizations/:orgId/admins/:adminId/reset-password', resetAdminPassword);
router.delete('/organizations/:orgId/admins/:adminId', deleteOrganizationAdmin);

// ==================== FIX UNLINKED ADMINS ====================
router.get('/admins/unlinked', getUnlinkedAdmins);
router.post('/admins/link-to-organization', linkAdminToOrganization);

// ==================== ANALYTICS & STATS ====================
router.get('/dashboard/stats', getDashboardStats);

// ==================== LOCATION ACCESS SETTINGS ====================
router.get('/organizations/:orgId/location-access', getLocationAccessSettings);
router.put('/organizations/:orgId/location-access/toggle', toggleLocationAccess);

module.exports = router;
