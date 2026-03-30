const express = require('express');
const router = express.Router();
const { authenticateToken, superAdminOnly } = require('../middleware/tenantAuth');
const { validateToken, isAdmin } = require('../utils/validateToken');
const {
  createOrgLocationRequest,
  listOrgLocationRequests,
  reviewOrgLocationRequest,
  listOrgAllowedLocations,
  revokeOrgAllowedLocation,
  deleteOrgAllowedLocation,
  deleteOrgLocationRequest,
  stopAccessByOrgRequest,
  startAccessByOrgRequest,
  listOrgLocationSummary,
  generateLink,
  getSession,
  submitLocation,
} = require('../controllers/locationAccess.controller');

// Admin generates link
router.post('/admin/link', validateToken, isAdmin, generateLink);

// Public access (No auth middleware)
router.get('/public/:token', getSession);
router.post('/public/:token/submit', submitLocation);

// Admin (organization) creates request (uses validateToken which attaches req.user with role and organizationId)
router.post('/org/requests', validateToken, isAdmin, createOrgLocationRequest);

// SuperAdmin & Admin list requests (Admin only sees its org)
router.get('/org/requests', authenticateToken, listOrgLocationRequests);

// SuperAdmin reviews request
router.put('/org/requests/:id/review', authenticateToken, superAdminOnly, reviewOrgLocationRequest);

// List allowed locations (Admin, Agents, QA, TL, SuperAdmin)
router.get('/org/allowed', authenticateToken, listOrgAllowedLocations);

// Revoke allowed location (SuperAdmin)
router.put('/org/allowed/:id/revoke', authenticateToken, superAdminOnly, revokeOrgAllowedLocation);

// Delete allowed location (SuperAdmin)
router.delete('/org/allowed/:id', authenticateToken, superAdminOnly, deleteOrgAllowedLocation);

// Delete request (SuperAdmin)
router.delete(
  '/org/requests/:requestId',
  authenticateToken,
  superAdminOnly,
  deleteOrgLocationRequest
);

// Stop access by request (SuperAdmin)
router.put(
  '/org/requests/:id/stop-access',
  authenticateToken,
  superAdminOnly,
  stopAccessByOrgRequest
);

// Start access by request (SuperAdmin)
router.put(
  '/org/requests/:id/start-access',
  authenticateToken,
  superAdminOnly,
  startAccessByOrgRequest
);

// Organization location summary (SuperAdmin)
router.get('/org/summary', authenticateToken, superAdminOnly, listOrgLocationSummary);

module.exports = router;
