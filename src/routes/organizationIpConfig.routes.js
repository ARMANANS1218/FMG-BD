const express = require('express');
const router = express.Router();
const {
  getOrganizationIpConfig,
  createOrUpdateOrgIpConfig,
  addIpToOrgConfig,
  removeIpFromOrgConfig,
  toggleOrgIpConfigStatus,
  deleteOrgIpConfig,
  verifyOrgIpAccess
} = require('../controllers/organizationIpConfig.controller');
const { authenticateToken } = require('../middleware/tenantAuth');

// Apply authentication to all routes
router.use(authenticateToken);

// Get organization IP configuration
router.get('/', getOrganizationIpConfig);

// Create or update organization IP configuration
router.post('/', createOrUpdateOrgIpConfig);

// Add IP to organization configuration
router.post('/add-ip', addIpToOrgConfig);

// Remove IP from organization configuration
router.delete('/ip/:ipId', removeIpFromOrgConfig);

// Toggle organization IP configuration status
router.patch('/toggle', toggleOrgIpConfigStatus);

// Delete organization IP configuration
router.delete('/', deleteOrgIpConfig);

// Verify IP access
router.post('/verify', verifyOrgIpAccess);

module.exports = router;
