const express = require("express");
const router = express.Router();
const attendanceController = require("../controllers/attendance.controller");
const { validateToken } = require("../utils/validateToken");

// All routes require authentication
router.use(validateToken);

// Check-in (All authenticated users)
router.post("/check-in", attendanceController.checkIn);

// Check-out (All authenticated users)
router.post("/check-out", attendanceController.checkOut);

// Get today's attendance for current user
router.get("/today", attendanceController.getMyTodayAttendance);

// Get my attendance history
router.get("/my-attendance", attendanceController.getMyAttendance);

// Get all attendance (Admin/TL only)
router.get("/all", attendanceController.getAllAttendance);

// Manually mark attendance (Admin/TL only)
router.post("/manual-mark", attendanceController.manualMarkAttendance);

// Edit attendance (Admin/TL only)
router.put("/:id", attendanceController.editAttendance);

// Get attendance statistics
router.get("/stats/summary", attendanceController.getAttendanceStats);

// Download attendance report (Admin/TL only)
router.get("/download/report", attendanceController.downloadAttendanceReport);

module.exports = router;
