const Email = require('../models/Email');
const Ticket = require('../models/Ticket');
const brevoEmailService = require('../utils/brevoEmailService');
const asyncHandler = require('express-async-handler');

/**
 * @desc    Send email to customer
 * @route   POST /api/v1/email/send
 * @access  Private (Agent/QA)
 */
exports.sendEmail = asyncHandler(async (req, res) => {
  try {
    const {
      ticketId,
      to,
      recipientEmail,
      recipientName,
      subject,
      body,
      htmlBody,
      attachments = []
    } = req.body;

    // Support both 'to' and 'recipientEmail' field names
    const finalRecipientEmail = recipientEmail || to;

    // Validate required fields
    if (!finalRecipientEmail || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: recipientEmail (or to), subject, body'
      });
    }

    // Get sender info from JWT
    const userId = req.user.id; // JWT has 'id' not '_id'
    
    // Fetch full user data from database
    const User = require('../models/User');
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const senderEmail = sender.email;
    const senderName = sender.name || sender.user_name;

    // If ticketId provided, verify it exists
    if (ticketId) {
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found'
        });
      }
    }

    // Send email through Brevo
    const emailDoc = await brevoEmailService.sendEmail({
      ticketId: ticketId || null,
      senderId: userId,
      senderEmail,
      senderName,
      recipientEmail: finalRecipientEmail,
      recipientName,
      subject,
      body,
      htmlBody,
      attachments
    });

    res.status(201).json({
      success: true,
      message: 'Email sent successfully',
      data: emailDoc
    });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error sending email',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Get all emails for a ticket
 * @route   GET /api/v1/email/ticket/:ticketId
 * @access  Private
 */
exports.getTicketEmails = asyncHandler(async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Verify ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Get all emails for this ticket
    const emails = await brevoEmailService.getTicketEmails(ticketId);

    res.status(200).json({
      success: true,
      data: emails,
      count: emails.length
    });
  } catch (error) {
    console.error('Get ticket emails error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching emails',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Mark email as read
 * @route   PUT /api/v1/email/:emailId/read
 * @access  Private
 */
exports.markEmailAsRead = asyncHandler(async (req, res) => {
  try {
    const { emailId } = req.params;
    const userId = req.user._id;

    const emailDoc = await brevoEmailService.markEmailAsRead(emailId, userId);

    if (!emailDoc) {
      return res.status(404).json({
        success: false,
        message: 'Email not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Email marked as read',
      data: emailDoc
    });
  } catch (error) {
    console.error('Mark email as read error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error marking email as read',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Delete email
 * @route   DELETE /api/v1/email/:emailId
 * @access  Private (Agent/QA - own emails only)
 */
exports.deleteEmail = asyncHandler(async (req, res) => {
  try {
    const { emailId } = req.params;
    const userId = req.user._id;

    // Find email
    const emailDoc = await Email.findById(emailId);
    if (!emailDoc) {
      return res.status(404).json({
        success: false,
        message: 'Email not found'
      });
    }

    // Check authorization (only sender can delete)
    if (emailDoc.senderId.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this email'
      });
    }

    // Delete email
    await brevoEmailService.deleteEmail(emailId);

    res.status(200).json({
      success: true,
      message: 'Email deleted successfully'
    });
  } catch (error) {
    console.error('Delete email error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error deleting email',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Get unread email count
 * @route   GET /api/v1/email/unread/count
 * @access  Private
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const count = await brevoEmailService.getUnreadEmailCount(userId);

    res.status(200).json({
      success: true,
      data: {
        unreadCount: count
      }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching unread count',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Search emails
 * @route   GET /api/v1/email/search
 * @access  Private
 */
exports.searchEmails = asyncHandler(async (req, res) => {
  try {
    const { ticketId, senderEmail, recipientEmail, subject, status, type } = req.query;

    const emails = await brevoEmailService.searchEmails({
      ticketId,
      senderEmail,
      recipientEmail,
      subject,
      status,
      type
    });

    res.status(200).json({
      success: true,
      data: emails,
      count: emails.length
    });
  } catch (error) {
    console.error('Search emails error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error searching emails',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Get email by ID
 * @route   GET /api/v1/email/:emailId
 * @access  Private
 */
exports.getEmailById = asyncHandler(async (req, res) => {
  try {
    const { emailId } = req.params;

    const emailDoc = await Email.findById(emailId)
      .populate('senderId', 'name email')
      .exec();

    if (!emailDoc) {
      return res.status(404).json({
        success: false,
        message: 'Email not found'
      });
    }

    // Mark as read if incoming
    if (emailDoc.type === 'incoming' && emailDoc.status !== 'read') {
      await brevoEmailService.markEmailAsRead(emailId, req.user._id);
    }

    res.status(200).json({
      success: true,
      data: emailDoc
    });
  } catch (error) {
    console.error('Get email by ID error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching email',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Webhook for incoming emails from Brevo
 * @route   POST /api/v1/email/webhook/brevo
 * @access  Public (but should be secured with Brevo IP whitelist)
 */
exports.brevoWebhook = asyncHandler(async (req, res) => {
  try {
    const { event, data } = req.body;

    console.log('📧 Brevo Webhook received:', event);

    // Handle different event types
    switch (event) {
      case 'incomingEmail':
        // Save incoming email
        await brevoEmailService.saveIncomingEmail({
          ticketId: data.ticketId, // Should be included in email metadata
          senderEmail: data.from,
          senderName: data.fromName,
          subject: data.subject,
          body: data.text,
          htmlBody: data.html,
          messageId: data.messageId,
          receivedAt: new Date(data.date)
        });
        break;

      case 'delivered':
        // Update email status
        await Email.updateOne(
          { brevoMessageId: data.messageId },
          { status: 'delivered', sentAt: new Date() }
        );
        break;

      case 'opened':
        // Update read status
        await Email.updateOne(
          { brevoMessageId: data.messageId },
          { status: 'read', readAt: new Date() }
        );
        break;

      case 'clicked':
        // Track clicks
        console.log('📎 Email link clicked:', data.messageId);
        break;

      case 'bounce':
      case 'complaint':
      case 'error':
        // Handle bounce/complaint/error
        await Email.updateOne(
          { brevoMessageId: data.messageId },
          {
            status: 'failed',
            error: {
              code: data.code,
              message: data.message,
              timestamp: new Date()
            }
          }
        );
        break;

      default:
        console.log('⚠️ Unknown webhook event:', event);
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error processing webhook',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

/**
 * @desc    Send email with HTML template
 * @route   POST /api/v1/email/send-with-template
 * @access  Private (Agent/QA)
 */
exports.sendEmailWithTemplate = asyncHandler(async (req, res) => {
  try {
    const {
      ticketId,
      recipientEmail,
      recipientName,
      subject,
      templateName,
      templateVariables = {},
      attachments = []
    } = req.body;

    if (!templateName) {
      return res.status(400).json({
        success: false,
        message: 'Template name is required'
      });
    }

    // Get template (you can create a templates folder with HTML files)
    const templateHtml = getEmailTemplate(templateName, templateVariables);

    // Send email
    const emailDoc = await brevoEmailService.sendEmail({
      ticketId,
      senderId: req.user._id,
      senderEmail: req.user.email,
      senderName: req.user.name,
      recipientEmail,
      recipientName,
      subject,
      body: extractTextFromHtml(templateHtml),
      htmlBody: templateHtml,
      attachments
    });

    res.status(201).json({
      success: true,
      message: 'Email sent successfully with template',
      data: emailDoc
    });
  } catch (error) {
    console.error('Send email with template error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error sending email',
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
});

// Helper function to get email template
function getEmailTemplate(templateName, variables) {
  const templates = {
    ticketResolved: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Your ticket has been resolved</h2>
          <p>Hello ${variables.customerName || 'Customer'},</p>
          <p>We are happy to inform you that your ticket <strong>#${variables.ticketId}</strong> has been resolved.</p>
          <p><strong>Resolution:</strong> ${variables.resolution || 'N/A'}</p>
          <p>If you have any further questions, please feel free to reach out.</p>
          <br>
          <p>Best regards,<br>Support Team</p>
        </body>
      </html>
    `,
    followUp: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Follow-up: Ticket ${variables.ticketId}</h2>
          <p>Hello ${variables.customerName || 'Customer'},</p>
          <p>${variables.message || 'Thank you for contacting us.'}</p>
          <br>
          <p>Best regards,<br>Support Team</p>
        </body>
      </html>
    `
  };

  return templates[templateName] || templates.followUp;
}

// Helper function to extract text from HTML
function extractTextFromHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
