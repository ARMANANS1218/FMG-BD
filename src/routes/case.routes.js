const express = require('express');
const caseController = require('../controllers/case.controller');
const { validateToken } = require('../utils/validateToken');

const router = express.Router();

// Cases usually created and managed by agents
router.post('/create', validateToken, caseController.createCase);
router.get('/', validateToken, caseController.getAllCases);

module.exports = router;
