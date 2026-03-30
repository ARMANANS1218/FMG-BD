const express = require('express');
const router = express.Router();
const { validateToken } = require('../utils/validateToken');
const {
  createLink,
  getSessionPublic,
  submitCapturePublic,
  listCaptures,
  updateCaptureMeta,
  deleteCapture
} = require('../controllers/geocam.controller');

// Admin guard
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Admin only' });
  next();
};

// Admin creates one-time link
router.post('/link', validateToken, adminOnly, createLink);

// Admin lists captured items
router.get('/captures', validateToken, adminOnly, listCaptures);

// Admin updates metadata
router.put('/capture/:id', validateToken, adminOnly, updateCaptureMeta);

// Admin deletes capture
router.delete('/capture/:id', validateToken, adminOnly, deleteCapture);

// Public endpoints (no auth)
router.get('/session/:token', getSessionPublic);
router.post('/submit/:token', submitCapturePublic);

module.exports = router;