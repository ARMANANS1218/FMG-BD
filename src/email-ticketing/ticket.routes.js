const express = require('express');
const ctrl = require('./ticket.controller');
const admin = require('./admin.controller');
const {
  authenticateToken,
  superAdminOnly,
  authorize,
  identifyTenant,
} = require('../middleware/tenantAuth');
const { upload } = require('./multerConfig');

const router = express.Router();

// Note: Using a distinct base path to avoid clashing with existing /api/v1/tickets
// Final mount from app.js: /api/v1/email-ticketing

// Public download endpoint (no tenant identification required)
router.get('/attachments/download', ctrl.downloadAttachment);

// Apply tenant identification middleware to all remaining routes
router.use(identifyTenant);

// Main ticket routes with dual authentication (JWT or API Key)
router.post('/tickets', upload.array('attachments', 10), ctrl.createTicketDual);
router.get('/tickets', ctrl.listTicketsDual);

// Widget-specific routes (API Key only)
router.post('/tickets/widget/reply', upload.array('attachments', 10), ctrl.replyToTicketFromWidget);
router.get('/tickets/:ticketId/messages', ctrl.getTicketMessagesFromWidget);

// Authenticated-only routes (JWT required)
router.get('/stats', authenticateToken, ctrl.getTicketStats);
router.get('/my-stats', authenticateToken, ctrl.getMyTicketStats); // Role-specific personal stats
router.post(
  '/tickets/reply',
  upload.array('attachments', 10),
  authenticateToken,
  ctrl.replyToTicket
);

router.get('/tickets/:id', authenticateToken, ctrl.getTicket);
router.put('/tickets/:id/status', authenticateToken, ctrl.updateStatus);
router.put('/tickets/:id/priority', authenticateToken, ctrl.updatePriority);
router.put('/tickets/:id/assign', authenticateToken, ctrl.assignTicket);
router.put('/tickets/:id/tags', authenticateToken, ctrl.updateTags);
router.put('/tickets/:id/team', authenticateToken, ctrl.updateTeamInbox);
// Delete ticket - Only Admin role allowed
router.delete('/tickets/:id', authenticateToken, authorize('Admin'), ctrl.deleteTicket);

// Admin
// Admin/SuperAdmin protected routes
router.get(
  '/admin/configs',
  authenticateToken,
  authorize('Admin', 'SuperAdmin'),
  admin.listOrgEmailConfigs
);
router.post(
  '/admin/configs',
  authenticateToken,
  authorize('Admin', 'SuperAdmin'),
  admin.createOrgEmailConfig
);
router.put(
  '/admin/configs/:id',
  authenticateToken,
  authorize('Admin', 'SuperAdmin'),
  admin.updateOrgEmailConfig
);
router.delete(
  '/admin/configs/:id',
  authenticateToken,
  authorize('Admin', 'SuperAdmin'),
  admin.deleteOrgEmailConfig
);
router.post(
  '/admin/configs/:id/test',
  authenticateToken,
  authorize('Admin', 'SuperAdmin'),
  admin.testOrgEmailConfig
);
router.post('/admin/reload', authenticateToken, superAdminOnly, admin.reloadImapListeners); // Reload all restricted to SuperAdmin

module.exports = router;
