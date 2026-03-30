const express = require('express');
const { sendMessage, getChatHistory, markAsRead } = require('../controllers/message.controller');
const { validateToken } = require('../utils/validateToken');
const router = express.Router();

// Route to send a message
router.post('/messages/send', sendMessage);
// Route to get messages between two users
router.get('/messages/history',  getChatHistory);

router.patch('/messages/:messageId/read',  markAsRead);

module.exports = router;
