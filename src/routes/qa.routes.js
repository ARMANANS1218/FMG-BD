const express = require('express');
const { validateToken } = require('../utils/validateToken');
const ctrl = require('../controllers/qaEvaluation.controller');
const ticketCtrl = require('../controllers/ticketEvaluation.controller');

const router = express.Router();

// All routes require authentication; role enforcement is done in controller to allow reuse
router.post('/evaluate', validateToken, ctrl.createEvaluation);
router.get('/by-petition/:petitionId', validateToken, ctrl.getByPetition);
router.get('/list', validateToken, ctrl.listEvaluations);
router.get('/aggregates', validateToken, ctrl.listAgentAggregates);
router.get('/export/csv', validateToken, ctrl.exportCSV);
router.get('/export/xlsx', validateToken, ctrl.exportXLSX);

// Email ticket evaluation routes (QA/TL)
router.post('/ticket/evaluate', validateToken, ticketCtrl.evaluateTicket);
router.get('/ticket/by-ticket/:ticketId', validateToken, ticketCtrl.getByTicket);
router.get('/ticket/list', validateToken, ticketCtrl.listEvaluations);
router.get('/ticket/aggregates', validateToken, ticketCtrl.listAggregates);
router.get('/ticket/export/csv', validateToken, ticketCtrl.exportCSV);
router.get('/ticket/export/xlsx', validateToken, ticketCtrl.exportXLSX);

module.exports = router;