const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');
const { authenticateToken } = require('../middleware/tenantAuth');

// All routes require authentication
router.use(authenticateToken);

// Get all Plans
router.get('/', planController.getPlans);

// Create new Plan (Admin only)
router.post('/', planController.createPlan);

// Update Plan (Admin only)
router.put('/:id', planController.updatePlan);

// Delete Plan (Admin only)
router.delete('/:id', planController.deletePlan);

module.exports = router;
