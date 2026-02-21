const express = require('express');
const router = express.Router();
const {
  createQuery,
  getCustomerQueries,
  getAllQueries,
  getQueryByPetitionId,
  acceptQuery,
  sendQueryMessage,
  transferQuery,
  resolveQuery,
  submitFeedback,
  getAvailableAgents,
  reopenQuery,
  getEscalationChain,
  getRecentEscalations,
  updateQueryDetails
} = require('../controllers/query.controller');
const { validateToken } = require('../utils/validateToken');
const { authorize } = require('../middleware/tenantAuth');

// Customer routes
router.post('/create', validateToken, createQuery);
router.get('/my-queries', validateToken, getCustomerQueries);
router.post('/:petitionId/reopen', validateToken, reopenQuery);
router.post('/:petitionId/feedback', validateToken, submitFeedback);

// Agent/QA routes
router.get('/all', validateToken, getAllQueries);
router.get('/available-agents', validateToken, getAvailableAgents);
router.get('/escalations/recent', validateToken, getRecentEscalations);
router.post('/:petitionId/accept', validateToken, acceptQuery);
// Submit a transfer request (recipient must accept)
router.post('/:petitionId/transfer', validateToken, transferQuery);
router.post('/:petitionId/transfer/request', validateToken, transferQuery);
router.post('/:petitionId/resolve', validateToken, resolveQuery);
// Update Query Details (Category, PNR, etc)
router.patch('/:petitionId/details', validateToken, updateQueryDetails);

// Common routes
router.get('/:petitionId', validateToken, getQueryByPetitionId);
router.get('/:petitionId/escalation-chain', validateToken, getEscalationChain);
router.post('/:petitionId/message', validateToken, sendQueryMessage);

// Delete a query - Only Admin role allowed
const { deleteQuery } = require('../controllers/query.controller');
router.delete('/:petitionId', validateToken, authorize('Admin'), deleteQuery);

module.exports = router;
