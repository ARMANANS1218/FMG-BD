const EmailTicket = require('../email-ticketing/models/Ticket');
const EmailTicketMessage = require('../email-ticketing/models/TicketMessage');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = (io) => {
  const ticketNamespace = io.of('/ticket');

  // Apply authentication middleware
  ticketNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        console.log('⚠️ No token provided for ticket namespace');
        return next();
      }
      
      const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      socket.userId = payload?.id?.toString();
      
      if (!socket.userId) {
        console.log('⚠️ Token verified but no userId in payload');
        return next();
      }

      // Attach user info
      const user = await User.findById(socket.userId).select('-password');
      if (user) {
        socket.userName = user.alias || user.name;
        socket.userRole = user.role;
        socket.organizationId = user.organizationId;
        console.log(`✅ Ticket namespace auth: ${user.alias || user.name} (${user.role})`);
      }
      
      next();
    } catch (err) {
      console.error('Ticket namespace auth error:', err.message);
      next();
    }
  });

  ticketNamespace.on('connection', (socket) => {
    console.log(`📧 Ticket socket connected: ${socket.id} (User: ${socket.userId})`);

    // Join personal room for notifications
    if (socket.userId) {
      const userRoom = `ticket-user:${socket.userId}`;
      socket.join(userRoom);
      console.log(`✅ Socket ${socket.id} joined personal ticket room ${userRoom}`);
      
      // ✅ Join organization-specific room for multi-tenancy isolation
      if (socket.organizationId) {
        const orgRoom = `ticket-org:${socket.organizationId}`;
        socket.join(orgRoom);
        console.log(`✅ Socket ${socket.id} joined organization ticket room ${orgRoom}`);
      }
    }

    // Join ticket room
    socket.on('join-ticket', async ({ ticketId }) => {
      try {
        const ticket = await EmailTicket.findOne({ ticketId, organization: socket.organizationId });
        if (!ticket) {
          socket.emit('error', { message: 'Ticket not found' });
          return;
        }

        socket.join(ticketId);
        console.log(`✅ User ${socket.userId} joined ticket ${ticketId}`);

        ticketNamespace.to(ticketId).emit('user-joined', {
          userId: socket.userId,
          userName: socket.userName,
          ticketId,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Join ticket error:', error);
        socket.emit('error', { message: 'Failed to join ticket' });
      }
    });

    // Leave ticket room
    socket.on('leave-ticket', ({ ticketId }) => {
      socket.leave(ticketId);
      console.log(`✅ User ${socket.userId} left ticket ${ticketId}`);
    });

    // Typing indicator
    socket.on('ticket-typing', ({ ticketId, isTyping }) => {
      socket.to(ticketId).emit('agent-typing', {
        ticketId,
        userId: socket.userId,
        userName: socket.userName,
        isTyping,
        timestamp: new Date()
      });
    });

    // Handle ticket updates (for real-time sync)
    socket.on('ticket-update', (ticket) => {
      ticketNamespace.emit('ticket-updated', ticket);
    });

    socket.on('disconnect', () => {
      console.log(`📧 Ticket socket disconnected: ${socket.id}`);
    });
  });

  // Helper functions to emit events from controllers
  ticketNamespace.emitNewTicket = (ticket) => {
    console.log(`📧 Emitting new-ticket event for: ${ticket.ticketId}`);
    ticketNamespace.emit('new-ticket', ticket);
  };

  ticketNamespace.emitTicketUpdate = (ticket) => {
    console.log(`📧 Emitting ticket-updated event for: ${ticket.ticketId}`);
    ticketNamespace.to(ticket.ticketId).emit('ticket-updated', ticket);
    ticketNamespace.emit('ticket-updated', ticket); // Also broadcast to all
  };

  ticketNamespace.emitNewMessage = (ticketId, message) => {
    console.log(`📧 Emitting new-ticket-message for: ${ticketId}`);
    ticketNamespace.to(ticketId).emit('new-ticket-message', { ticketId, message });
  };

  ticketNamespace.emitTicketAssigned = (ticket, assignedTo) => {
    console.log(`📧 Emitting ticket-assigned for: ${ticket.ticketId} to ${assignedTo._id}`);
    ticketNamespace.to(`ticket-user:${assignedTo._id}`).emit('ticket-assigned', {
      ticketId: ticket.ticketId,
      ticket,
      assignedTo: {
        _id: assignedTo._id,
        name: assignedTo.name,
        email: assignedTo.email
      }
    });
  };

  return ticketNamespace;
};
