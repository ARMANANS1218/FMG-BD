const express = require('express');
const router = express.Router();
const fmcgReportingController = require('../controllers/fmcgReporting.controller');
const { identifyTenant, authenticateToken, authorize } = require('../middleware/tenantAuth');

// All reports are for TL, Admin, SuperAdmin, Management
router.use(identifyTenant);
router.use(authenticateToken);
router.use(authorize('TL', 'QA', 'Admin', 'SuperAdmin', 'Management'));

router.get('/daily-ops', fmcgReportingController.getDailyOperationsReport);
router.get('/weekly-quality', fmcgReportingController.getWeeklyQualityReport);
router.get('/refunds', fmcgReportingController.getRefundReport);
router.get('/batch-trends', fmcgReportingController.getBatchTrendReport);
router.get('/mpr', fmcgReportingController.getMonthlyPerformanceReview);
router.get('/regulatory', fmcgReportingController.getRegulatoryComplianceReport);
router.get('/productivity', fmcgReportingController.getWorkforceProductivityReport);
router.get('/root-cause', fmcgReportingController.getRootCauseReport);

module.exports = router;
