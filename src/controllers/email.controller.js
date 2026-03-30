const Email = require('../models/Email');
const Ticket = require('../models/Ticket');
const transporter = require('../config/emailConfig');
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

    const finalRecipientEmail = recipientEmail || to;

    if (!finalRecipientEmail || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: recipientEmail (or to), subject, body'
      });
    }

    const userId = req.user.id; 
    
    const Staff = require('../models/Staff');
    const sender = await Staff.findById(userId);
    if (!sender) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const senderEmail = sender.email;
    const senderName = sender.name || sender.user_name || 'Support';

    if (ticketId) {
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found'
        });
      }
    }

    const fromName = senderName || process.env.SMTP_FROM_NAME || 'Support';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || process.env.SMTP_USERNAME;
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: finalRecipientEmail,
      subject: subject,
      text: body,
      html: htmlBody || body,
    };
    
    if (attachments && attachments.length > 0) {
       mailOptions.attachments = attachments.map(att => ({
          filename: att.name || att.filename,
          content: att.content || att.buffer
       }));
    }

    const info = await transporter.sendMail(mailOptions);

    const emailDoc = await Email.create({
      ticketId: ticketId || null,
      senderId: userId,
      senderEmail,
      senderName,
      recipientEmail: finalRecipientEmail,
      recipientName,
      subject,
      body,
      htmlBody: htmlBody || body,
      messageId: info.messageId,
      status: 'sent',
      type: 'outgoing',
      sentAt: new Date()
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

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    const emails = await Email.find({ ticketId }).sort({ createdAt: -1 });

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

    const emailDoc = await Email.findByIdAndUpdate(
      emailId,
      { status: 'read', readAt: new Date(), readBy: userId },
      { new: true }
    );

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

    const emailDoc = await Email.findById(emailId);
    if (!emailDoc) {
      return res.status(404).json({
        success: false,
        message: 'Email not found'
      });
    }

    if (emailDoc.senderId && emailDoc.senderId.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this email'
      });
    }

    await Email.findByIdAndDelete(emailId);

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
    const count = await Email.countDocuments({ type: 'incoming', status: { $ne: 'read' } });

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

    const queryFilter = {};
    if (ticketId) queryFilter.ticketId = ticketId;
    if (senderEmail) queryFilter.senderEmail = senderEmail;
    if (recipientEmail) queryFilter.recipientEmail = recipientEmail;
    if (subject) queryFilter.subject = { $regex: subject, $options: 'i' };
    if (status) queryFilter.status = status;
    if (type) queryFilter.type = type;

    const emails = await Email.find(queryFilter).sort({ createdAt: -1 });

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

    if (emailDoc.type === 'incoming' && emailDoc.status !== 'read') {
      await Email.findByIdAndUpdate(
        emailId,
        { status: 'read', readAt: new Date(), readBy: req.user._id }
      );
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
 * @desc    Webhook for incoming emails from Outlook/Other (Replaced Brevo)
 * @route   POST /api/v1/email/webhook/incoming
 * @access  Public
 */
exports.brevoWebhook = asyncHandler(async (req, res) => {
  try {
    const { event, data } = req.body;

    console.log('📧 Webhook received:', event);

    switch (event) {
      case 'incomingEmail':
        await Email.create({
          ticketId: data.ticketId || null,
          senderEmail: data.from,
          senderName: data.fromName,
          recipientEmail: process.env.SMTP_USERNAME,
          subject: data.subject,
          body: data.text,
          htmlBody: data.html,
          messageId: data.messageId,
          type: 'incoming',
          status: 'delivered',
          sentAt: new Date(data.date),
          receivedAt: new Date()
        });
        break;

      case 'delivered':
        await Email.updateOne(
          { messageId: data.messageId },
          { status: 'delivered', sentAt: new Date() }
        );
        break;

      case 'opened':
        await Email.updateOne(
          { messageId: data.messageId },
          { status: 'read', readAt: new Date() }
        );
        break;

      case 'clicked':
        console.log('📎 Email link clicked:', data.messageId);
        break;

      case 'bounce':
      case 'complaint':
      case 'error':
        await Email.updateOne(
          { messageId: data.messageId },
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

    const templateHtml = getEmailTemplate(templateName, templateVariables);     
    
    const senderName = req.user.name || 'Support';
    const senderEmail = req.user.email || process.env.SMTP_USERNAME;

    const fromName = senderName || process.env.SMTP_FROM_NAME || 'Support';     
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || process.env.SMTP_USERNAME;

    const bodyText = extractTextFromHtml(templateHtml);

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipientEmail,
      subject: subject,
      text: bodyText,
      html: templateHtml,
    };

    if (attachments && attachments.length > 0) {
       mailOptions.attachments = attachments.map(att => ({
          filename: att.name || att.filename,
          content: att.content || att.buffer
       }));
    }

    const info = await transporter.sendMail(mailOptions);

    const emailDoc = await Email.create({
      ticketId,
      senderId: req.user._id,
      senderEmail,
      senderName,
      recipientEmail,
      recipientName,
      subject,
      body: bodyText,
      htmlBody: templateHtml,
      messageId: info.messageId,
      status: 'sent',
      type: 'outgoing',
      sentAt: new Date()
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
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
