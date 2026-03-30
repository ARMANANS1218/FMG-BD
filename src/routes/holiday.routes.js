const express = require('express');
const router = express.Router();
const { validateToken } = require('../utils/validateToken');
const {
  createHoliday,
  getAllHolidays,
  updateHoliday,
  deleteHoliday,
  checkHoliday
} = require('../controllers/holiday.controller');

// All routes require authentication
router.use(validateToken);

// Create holiday (Admin/TL only)
router.post('/', createHoliday);

// Get all holidays (All authenticated users)
router.get('/', getAllHolidays);

// Check if a date is holiday
router.get('/check', checkHoliday);

// Update holiday (Admin/TL only)
router.put('/:id', updateHoliday);

// Delete holiday (Admin/TL only)
router.delete('/:id', deleteHoliday);

module.exports = router;
