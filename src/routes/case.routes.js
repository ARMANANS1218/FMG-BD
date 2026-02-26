const express = require('express');
const caseController = require('../controllers/case.controller');
const { requireSignin } = require('../middleware/authMiddleware');

const router = express.Router();

// Cases usually created and managed by agents
router.post('/create', requireSignin, caseController.createCase);
router.get('/', requireSignin, caseController.getAllCases);

module.exports = router;
