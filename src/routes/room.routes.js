const express = require("express");
const { 
  createCall, 
  updateCallStatus, 
  getCallHistory, 
  getAllCalls,
  deleteCallLog,
  clearCallLogsDate,
  clearAllCallLogs
} = require("../controllers/room.controller");
const { validateToken } = require("../utils/validateToken");
const router = express.Router();


// POST: Create a call
router.post("/", validateToken, createCall);

// PUT: Update call status (accepted/ended)
router.put("/:roomId/status", validateToken, updateCallStatus);

// GET: Fetch all calls
router.get('/history', validateToken, getCallHistory);
router.get('/', getAllCalls);

// DELETE: Delete a single call log
router.delete("/:callId", validateToken, deleteCallLog);

// DELETE: Clear call logs for a specific date
router.delete('/clear/date', validateToken, clearCallLogsDate);

// DELETE: Clear all call logs for user
router.delete('/clear/all', validateToken, clearAllCallLogs);

module.exports = router;
