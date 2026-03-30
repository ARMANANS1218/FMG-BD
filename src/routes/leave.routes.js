const express = require('express');
const router = express.Router();
const { validateToken } = require('../utils/validateToken');
const {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  reviewLeave,
  cancelLeave,
  getPendingLeaveCount
} = require('../controllers/leave.controller');

// All routes require authentication
router.use(validateToken);

// Apply for leave (All authenticated users)
router.post('/apply', applyLeave);

// Get my leaves
router.get('/my', getMyLeaves);

// Get all leaves (Admin/TL only)
router.get('/all', getAllLeaves);

// Get pending leave count (Admin/TL only)
router.get('/pending-count', getPendingLeaveCount);

// Review leave - approve/reject (Admin/TL only)
router.put('/review/:id', reviewLeave);

// Cancel leave (Own leave only)
router.delete('/:id', cancelLeave);

module.exports = router;
