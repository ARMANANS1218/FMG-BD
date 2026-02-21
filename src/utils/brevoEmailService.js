const nodemailer = require('nodemailer');
const Email = require('../models/Email');
const Ticket = require('../models/Ticket');

class BrevoEmailService {
  constructor() {
    // Initialize Brevo SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
      port: process.env.BREVO_SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.BREVO_SMTP_LOGIN,
        pass: process.env.BREVO_SMTP_PASSWORD,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });

    // Verify connection (commented out - causes error on port 587)
    // this.transporter.verify((error, success) => {
    //   if (error) {
    //     console.error('❌ Brevo SMTP Connection Error:', error);
    //   } else {
    //     console.log('✅ Brevo SMTP Connected Successfully');
    //   }
    // });
  }

  /**
   * Send email to customer
   * @param {Object} emailData - { ticketId, senderId, senderEmail, senderName, recipientEmail, recipientName, subject, body, htmlBody, attachments }
   * @returns {Promise<Object>} Email document
   */
  async sendEmail(emailData) {
    try {
      const {
        ticketId,
        senderId,
        senderEmail,
        senderName,
        recipientEmail,
        recipientName,
        subject,
        body,
        htmlBody,
        attachments = []
      } = emailData;

      // Validate ticket exists if ticketId is provided
      if (ticketId) {
        const ticket = await Ticket.findById(ticketId);
        if (!ticket) {
          throw new Error(`Ticket not found: ${ticketId}`);
        }
      }

      // Create email document first (draft)
      const emailDoc = await Email.create({
        ticketId: ticketId || null,
        senderId,
        senderEmail,
        senderName,
        recipientEmail,
        recipientName,
        subject,
        body,
        htmlBody: htmlBody || this.generateHtmlFromText(body, senderName),
        type: 'outgoing',
        status: 'draft',
        attachments
      });

      // Prepare mail options
      const mailOptions = {
        from: `${senderName || 'CRM'} <${senderEmail}>`,
        to: `${recipientName || 'Customer'} <${recipientEmail}>`,
        subject: subject,
        text: body,
        html: emailDoc.htmlBody,
        attachments: attachments.map(att => ({
          filename: att.fileName,
          url: att.fileUrl,
          // OR for local files:
          // path: att.fileUrl
        }))
      };

      // Send through Brevo
      const info = await this.transporter.sendMail(mailOptions);

      // Update email status to sent
      emailDoc.status = 'sent';
      emailDoc.sentAt = new Date();
      emailDoc.messageId = info.messageId;
      emailDoc.brevoMessageId = info.messageId;
      await emailDoc.save();

      console.log('✅ Email sent successfully:', {
        messageId: info.messageId,
        to: recipientEmail,
        subject: subject
      });

      return emailDoc;
    } catch (error) {
      console.error('❌ Email send error:', error.message);

      // Save email with error status
      if (emailData.ticketId) {
        const errorEmailDoc = await Email.create({
          ...emailData,
          type: 'outgoing',
          status: 'failed',
          error: {
            code: error.code,
            message: error.message,
            timestamp: new Date()
          }
        });
        return errorEmailDoc;
      }

      throw error;
    }
  }

  /**
   * Generate HTML email from plain text
   * @param {string} text - Plain text body
   * @param {string} senderName - Sender name for signature
   * @returns {string} HTML content
   */
  generateHtmlFromText(text, senderName) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .content { background-color: #f9f9f9; padding: 15px; border-radius: 5px; }
            .signature { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="content">
                ${text.replace(/\n/g, '<br>')}
            </div>
            <div class="signature">
                <p>Best regards,<br>${senderName || 'CRM Team'}</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Get all emails for a ticket
   * @param {string} ticketId - Ticket ID
   * @returns {Promise<Array>} Array of emails
   */
  async getTicketEmails(ticketId) {
    try {
      const emails = await Email.find({ ticketId })
        .populate('senderId', 'name email')
        .sort({ createdAt: -1 })
        .exec();

      return emails;
    } catch (error) {
      console.error('❌ Error fetching ticket emails:', error.message);
      throw error;
    }
  }

  /**
   * Mark email as read
   * @param {string} emailId - Email document ID
   * @param {string} userId - User ID who read it
   * @returns {Promise<Object>} Updated email document
   */
  async markEmailAsRead(emailId, userId) {
    try {
      const emailDoc = await Email.findByIdAndUpdate(
        emailId,
        {
          $addToSet: {
            readBy: {
              userId: userId,
              readAt: new Date()
            }
          },
          status: 'read'
        },
        { new: true }
      );

      return emailDoc;
    } catch (error) {
      console.error('❌ Error marking email as read:', error.message);
      throw error;
    }
  }

  /**
   * Delete email (soft delete for audit trail)
   * @param {string} emailId - Email document ID
   * @returns {Promise<Object>} Deleted email document
   */
  async deleteEmail(emailId) {
    try {
      const emailDoc = await Email.findByIdAndDelete(emailId);
      return emailDoc;
    } catch (error) {
      console.error('❌ Error deleting email:', error.message);
      throw error;
    }
  }

  /**
   * Save incoming email from customer
   * @param {Object} incomingEmailData - Email data from webhook/IMAP
   * @returns {Promise<Object>} Saved email document
   */
  async saveIncomingEmail(incomingEmailData) {
    try {
      const {
        ticketId,
        senderEmail,
        senderName,
        subject,
        body,
        htmlBody,
        messageId,
        receivedAt
      } = incomingEmailData;

      // Check if email already exists (prevent duplicates)
      const existingEmail = await Email.findOne({ messageId });
      if (existingEmail) {
        console.log('⚠️ Email already exists:', messageId);
        return existingEmail;
      }

      const emailDoc = await Email.create({
        ticketId,
        senderId: null, // Incoming from customer
        senderEmail,
        senderName,
        recipientEmail: process.env.BREVO_SMTP_LOGIN,
        subject,
        body,
        htmlBody,
        type: 'incoming',
        status: 'received',
        messageId,
        brevoMessageId: messageId,
        receivedAt: receivedAt || new Date()
      });

      console.log('✅ Incoming email saved:', {
        messageId: messageId,
        from: senderEmail,
        subject: subject
      });

      return emailDoc;
    } catch (error) {
      console.error('❌ Error saving incoming email:', error.message);
      throw error;
    }
  }

  /**
   * Get unread email count for user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Count of unread emails
   */
  async getUnreadEmailCount(userId) {
    try {
      const count = await Email.countDocuments({
        status: 'received',
        readBy: { $not: { $elemMatch: { userId } } }
      });

      return count;
    } catch (error) {
      console.error('❌ Error getting unread count:', error.message);
      throw error;
    }
  }

  /**
   * Search emails by criteria
   * @param {Object} criteria - Search criteria { ticketId, senderEmail, recipientEmail, subject, status }
   * @returns {Promise<Array>} Array of matching emails
   */
  async searchEmails(criteria) {
    try {
      const query = {};

      if (criteria.ticketId) query.ticketId = criteria.ticketId;
      if (criteria.senderEmail) query.senderEmail = new RegExp(criteria.senderEmail, 'i');
      if (criteria.recipientEmail) query.recipientEmail = new RegExp(criteria.recipientEmail, 'i');
      if (criteria.subject) query.subject = new RegExp(criteria.subject, 'i');
      if (criteria.status) query.status = criteria.status;
      if (criteria.type) query.type = criteria.type;

      const emails = await Email.find(query)
        .populate('senderId', 'name email')
        .sort({ createdAt: -1 })
        .limit(50);

      return emails;
    } catch (error) {
      console.error('❌ Error searching emails:', error.message);
      throw error;
    }
  }
}

module.exports = new BrevoEmailService();
