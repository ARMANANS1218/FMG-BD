// ✅ Route: src/routes/webhook.routes.js
const express = require('express');
const {
  verifyWebhook,
  receiveWebhookMessage,
  createGuestConversation,
  sendWidgetMessage,
  submitWidgetRating,
  checkWidgetRating,
  uploadWidgetSnapshot,
} = require('../controllers/webhook.controller');
const upload = require('../utils/uploadScreenshot');
const router = express.Router();

router.get('/', verifyWebhook);
router.post('/', receiveWebhookMessage);
router.post('/guest-conversation', createGuestConversation);
// Widget standalone REST message endpoint (API key auth)
router.post('/send-message', sendWidgetMessage);
// Widget standalone rating submission (API key auth)
router.post('/submit-rating', submitWidgetRating);
// Widget check if rating already exists (API key auth)
router.get('/check-rating', checkWidgetRating);
// Widget snapshot upload (API key auth, multipart)
router.post('/upload-snapshot', upload.single('screenshot'), uploadWidgetSnapshot);

module.exports = router;
