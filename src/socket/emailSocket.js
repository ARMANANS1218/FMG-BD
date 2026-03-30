const Email = require('../models/Email');
const User = require('../models/User');

/**
 * Email Socket Namespace
 * Handles real-time email communication between Agent, QA, and Customer
 */
module.exports = (io) => {
  const emailNamespace = io.of('/email');

  emailNamespace.on('connection', (socket) => {
    console.log(`📧 Email socket connected: ${socket.userId}`);

    // Join user's personal room for email notifications
    socket.on('join-email-room', (userId) => {
      socket.join(`email-user:${userId}`);
      console.log(`✅ User ${userId} joined email room`);
    });

    // Send email event (with real-time notification)
    socket.on('send-email', async (data) => {
      try {
        const {
          ticketId,
          from,
          to,
          subject,
          body,
          recipientRole = 'customer' // 'customer', 'agent', 'qa'
        } = data;

        if (!from || !to || !subject || !body) {
          socket.emit('email-error', { message: 'Missing required fields' });
          return;
        }

        // Find recipient user by email
        const recipient = await User.findOne({ email: to });
        if (!recipient) {
          socket.emit('email-error', { message: 'Recipient not found' });
          return;
        }

        // Create email document in database
        const emailDoc = await Email.create({
          ticketId,
          senderEmail: from,
          senderName: socket.name || 'User',
          recipientEmail: to,
          recipientName: recipient.name || recipient.user_name,
          subject,
          body,
          type: 'outgoing',
          status: 'sent',
          createdAt: new Date(),
        });

        // Emit real-time notification to recipient
        emailNamespace.to(`email-user:${recipient._id}`).emit('new-email', {
          _id: emailDoc._id,
          from,
          subject,
          body: body.substring(0, 100) + '...',
          createdAt: emailDoc.createdAt,
          type: 'incoming',
          status: 'sent',
        });

        // Confirm send to sender
        socket.emit('email-sent', {
          _id: emailDoc._id,
          to,
          subject,
          status: 'sent',
          createdAt: emailDoc.createdAt,
        });

        console.log(`✅ Email sent from ${from} to ${to}`);
      } catch (error) {
        console.error('Email socket error:', error);
        socket.emit('email-error', { message: error.message });
      }
    });

    // Receive email (when customer sends email to agent/qa)
    socket.on('receive-email', async (data) => {
      try {
        const {
          ticketId,
          from, // sender
          to,   // recipient
          subject,
          body,
          senderRole = 'customer' // who is sending
        } = data;

        // Find recipient
        const recipient = await User.findOne({ email: to });
        if (!recipient) {
          socket.emit('email-error', { message: 'Recipient not found' });
          return;
        }

        // Create incoming email document
        const emailDoc = await Email.create({
          ticketId,
          senderEmail: from,
          recipientEmail: to,
          subject,
          body,
          type: 'incoming',
          status: 'received',
          createdAt: new Date(),
        });

        // Notify recipient in real-time
        emailNamespace.to(`email-user:${recipient._id}`).emit('incoming-email', {
          _id: emailDoc._id,
          from,
          subject,
          body: body.substring(0, 100) + '...',
          createdAt: emailDoc.createdAt,
          fullBody: body,
          type: 'incoming',
        });

        console.log(`📨 Incoming email received: ${from} -> ${to}`);
      } catch (error) {
        console.error('Receive email error:', error);
        socket.emit('email-error', { message: error.message });
      }
    });

    // Mark email as read
    socket.on('mark-email-read', async (emailId) => {
      try {
        await Email.findByIdAndUpdate(emailId, { status: 'read' });
        socket.emit('email-marked-read', { emailId });
      } catch (error) {
        console.error('Mark read error:', error);
      }
    });

    // Delete email
    socket.on('delete-email', async (emailId) => {
      try {
        await Email.findByIdAndDelete(emailId);
        socket.emit('email-deleted', { emailId });
      } catch (error) {
        console.error('Delete email error:', error);
      }
    });

    // Get emails for user
    socket.on('get-user-emails', async (userId) => {
      try {
        const emails = await Email.find({
          $or: [
            { recipientEmail: { $regex: `.*@.*` } }, // All emails
          ]
        }).sort({ createdAt: -1 }).limit(50);

        socket.emit('user-emails', emails);
      } catch (error) {
        console.error('Get emails error:', error);
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`📧 Email socket disconnected: ${socket.userId}`);
    });
  });
};
