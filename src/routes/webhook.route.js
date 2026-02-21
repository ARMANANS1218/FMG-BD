// ✅ Route: src/routes/webhook.routes.js
const express = require('express');
const { verifyWebhook, receiveWebhookMessage, createGuestConversation, sendWidgetMessage, uploadWidgetSnapshot } = require('../controllers/webhook.controller');
const upload = require('../utils/uploadScreenshot');
const router = express.Router();

router.get('/', verifyWebhook);
router.post('/', receiveWebhookMessage);
router.post('/guest-conversation', createGuestConversation);
// Widget standalone REST message endpoint (API key auth)
router.post('/send-message', sendWidgetMessage);
// Widget snapshot upload (API key auth, multipart)
router.post('/upload-snapshot', upload.single('screenshot'), uploadWidgetSnapshot);

module.exports = router;