const express = require('express');
const router = express.Router();
const {
  getAgentPerformance,
  getAllAgentPerformanceData
} = require('../controllers/agentPerformance.controller');
const { validateToken } = require('../utils/validateToken');

// Get agent performance with stats (queries + tickets)
// Query params: ?agentId=xxx&startDate=2026-01-01&endDate=2026-01-31
router.get('/performance', validateToken, getAgentPerformance);

// Get all raw data for export (PDF/Excel)
router.get('/performance/all-data', validateToken, getAllAgentPerformanceData);

module.exports = router;
