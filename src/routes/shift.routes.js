const express = require("express");
const router = express.Router();
const shiftController = require("../controllers/shift.controller");
const { validateToken } = require("../utils/validateToken");

// All routes require authentication
router.use(validateToken);

// Create a new shift (Admin/TL only)
router.post("/", shiftController.createShift);

// Get all shifts
router.get("/", shiftController.getShifts);

// Get a single shift by ID
router.get("/:id", shiftController.getShiftById);

// Update a shift (Admin/TL only)
router.put("/:id", shiftController.updateShift);

// Delete a shift (Admin only)
router.delete("/:id", shiftController.deleteShift);

module.exports = router;
