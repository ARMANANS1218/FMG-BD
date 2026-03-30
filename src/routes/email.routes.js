const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');
const { validateToken } = require('../utils/validateToken');

// Public webhook endpoint (should be protected with IP whitelist in production)
router.post('/webhook/brevo', emailController.brevoWebhook);

// Protected routes - require authentication

// Send email
router.post('/send', validateToken, emailController.sendEmail);

// Send email with template
router.post('/send-with-template', validateToken, emailController.sendEmailWithTemplate);

// Get all emails for a ticket
router.get('/ticket/:ticketId', validateToken, emailController.getTicketEmails);

// Get single email by ID
router.get('/:emailId', validateToken, emailController.getEmailById);

// Mark email as read
router.put('/:emailId/read', validateToken, emailController.markEmailAsRead);

// Delete email
router.delete('/:emailId', validateToken, emailController.deleteEmail);

// Get unread count
router.get('/unread/count', validateToken, emailController.getUnreadCount);

// Search emails
router.get('/search', validateToken, emailController.searchEmails);

module.exports = router;
