const express = require('express');
const router = express.Router();
const { validateToken } = require('../utils/validateToken');
const upload = require('../utils/uploadScreenshot');
const {
  uploadScreenshot,
  getAllScreenshots,
  getScreenshotById,
  deleteScreenshot,
  getScreenshotsByPetition
} = require('../controllers/screenshot.controller');

// Upload screenshot (Agent/QA only)
router.post('/upload', validateToken, upload.single('screenshot'), uploadScreenshot);

// Get all screenshots (with filters)
router.get('/', validateToken, getAllScreenshots);

// Get screenshots for a specific petition
router.get('/petition/:petitionId', validateToken, getScreenshotsByPetition);

// Get single screenshot by ID
router.get('/:id', validateToken, getScreenshotById);

// Delete screenshot
router.delete('/:id', validateToken, deleteScreenshot);

module.exports = router;
