const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const { validateToken } = require('../utils/validateToken');

const router = express.Router();

/**
 * @route   GET /api/v1/dashboard/stats
 * @access  Private (Agent, QA)
 * @desc    Get dashboard statistics (auto-determines role)
 */
router.get('/stats', validateToken, dashboardController.getDashboardStats);

/**
 * @route   GET /api/v1/dashboard/agent/stats
 * @access  Private (Agent)
 * @desc    Get Agent-specific dashboard statistics
 */
router.get('/agent/stats', validateToken, dashboardController.getAgentDashboardStats);

/**
 * @route   GET /api/v1/dashboard/qa/stats
 * @access  Private (QA)
 * @desc    Get QA-specific dashboard statistics
 */
router.get('/qa/stats', validateToken, dashboardController.getQADashboardStats);

/**
 * @route   GET /api/v1/dashboard/weekly-performance
 * @access  Private (Agent, QA)
 * @desc    Get weekly performance data for charts
 */
router.get('/weekly-performance', validateToken, dashboardController.getWeeklyPerformance);

/**
 * @route   GET /api/v1/dashboard/trends
 * @access  Private (Agent, QA)
 * @desc    Get 30-day performance trends
 */
router.get('/trends', validateToken, dashboardController.getPerformanceTrends);

/**
 * @route   GET /api/v1/dashboard/admin/stats
 * @access  Private (Admin)
 * @desc    Get Admin dashboard statistics (aggregated from all agents and QA)
 */
router.get('/admin/stats', validateToken, dashboardController.getAdminDashboardStats);

/**
 * @route   GET /api/v1/dashboard/agents/performance
 * @access  Private (Admin)
 * @desc    Get detailed performance metrics for all agents
 */
router.get('/agents/performance', validateToken, dashboardController.getAgentPerformanceList);

/**
 * @route   GET /api/v1/dashboard/qa/performance
 * @access  Private (Admin)
 * @desc    Get detailed performance metrics for all QA members
 */
router.get('/qa/performance', validateToken, dashboardController.getQAPerformanceList);

/**
 * @route   GET /api/v1/dashboard/agent/feedback
 * @access  Private (Agent)
 * @desc    Get agent's customer feedback data (recent and trends)
 */
router.get('/agent/feedback', validateToken, dashboardController.getAgentFeedback);

/**
 * @route   GET /api/v1/dashboard/admin/feedback
 * @access  Private (Admin)
 * @desc    Get comprehensive customer feedback data for admin dashboard
 */
router.get('/admin/feedback', validateToken, dashboardController.getAdminFeedback);

module.exports = router;
