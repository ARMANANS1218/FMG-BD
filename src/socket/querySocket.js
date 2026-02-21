const Query = require('../models/Query');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

module.exports = (io) => {
  const queryNamespace = io.of('/query');

  // Apply authentication middleware to the namespace
  queryNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        console.log('⚠️ No token provided for query namespace');
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
        socket.userName = user.name;
        socket.userRole = user.role;
        socket.organizationId = user.organizationId; // ✅ Add organizationId to socket
        console.log(
          `✅ Query namespace auth: ${user.name} (${user.role}) - Org: ${user.organizationId}`
        );
      }

      next();
    } catch (err) {
      console.error('Query namespace auth error:', err.message);
      next(); // Allow connection but log error
    }
  });

  queryNamespace.on('connection', (socket) => {
    console.log(`User connected to query namespace: ${socket.id}`);
    console.log(`Socket userId:`, socket.userId);
    console.log(`Socket auth token:`, socket.handshake.auth?.token ? 'Present' : 'Missing');

    // If socket has been authenticated and has a userId (set in middleware), join a personal room
    try {
      console.log(
        `🔍 DEBUG: Socket ${socket.id} auth state - userId: ${socket.userId}, orgId: ${socket.organizationId}`
      );

      if (socket.userId) {
        const userRoom = `user:${socket.userId}`;
        socket.join(userRoom);
        console.log(`✅ Socket ${socket.id} joined personal room ${userRoom}`);

        // ✅ Join organization-specific room for multi-tenancy isolation
        if (socket.organizationId) {
          const orgRoom = `org:${socket.organizationId}`;
          socket.join(orgRoom);
          console.log(`✅ Socket ${socket.id} joined organization room ${orgRoom}`);
          console.log(`🔍 DEBUG: Socket rooms after join:`, Array.from(socket.rooms));
        } else {
          console.warn(`⚠️ Socket ${socket.id} has NO organizationId - cannot join org room`);
        }
      } else {
        console.log(`⚠️ Socket ${socket.id} has NO userId - cannot join personal room`);
      }
    } catch (err) {
      console.error(`❌ Error joining personal room:`, err);
    }

    // Join query room
    socket.on('join-query', async ({ petitionId, userId }) => {
      try {
        const query = await Query.findOne({ petitionId });
        if (!query) {
          socket.emit('error', { message: 'Query not found' });
          return;
        }

        // Prefer authenticated socket userId if available
        const effectiveUserId = socket.userId || userId;

        // Authorization: Only customer and assigned agent can join (handle guest queries where customer can be null)
        const isCustomer = query.customer ? query.customer.toString() === effectiveUserId : false;
        const isAssignedAgent = query.assignedTo && query.assignedTo.toString() === effectiveUserId;

        if (!isCustomer && !isAssignedAgent) {
          console.log(`❌ User ${effectiveUserId} not authorized to join query ${petitionId}`);
          socket.emit('error', {
            message: 'Not authorized to view this query',
          });
          return;
        }

        socket.join(petitionId);
        console.log(`✅ User ${effectiveUserId} joined query ${petitionId}`);

        // Emit to room that user joined
        queryNamespace.to(petitionId).emit('user-joined', {
          userId: effectiveUserId,
          petitionId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('Join query error:', error);
        socket.emit('error', { message: 'Failed to join query' });
      }
    });

    // Send message in query
    socket.on('send-query-message', async ({ petitionId, userId, message }) => {
      try {
        const effectiveUserId = socket.userId || userId;
        const user = await User.findById(effectiveUserId);
        if (!user) {
          socket.emit('error', { message: 'User not found' });
          return;
        }

        const query = await Query.findOne({ petitionId });
        if (!query) {
          socket.emit('error', { message: 'Query not found' });
          return;
        }

        // Check authorization
        const isCustomer = query.customer.toString() === effectiveUserId;
        const isAssignedAgent = query.assignedTo && query.assignedTo.toString() === effectiveUserId;

        if (!isCustomer && !isAssignedAgent) {
          socket.emit('error', { message: 'Not authorized' });
          return;
        }

        const newMessage = {
          sender: effectiveUserId,
          senderName: user.alias || user.name,
          senderRole: user.role,
          message,
          timestamp: new Date(),
        };

        query.messages.push(newMessage);
        query.lastActivityAt = new Date();

        // Update status to In Progress if it was Accepted
        if (query.status === 'Accepted') {
          query.status = 'In Progress';
        }

        await query.save();

        // Ensure the sender is in the room for subsequent events
        try {
          socket.join(petitionId);
        } catch (e) {
          /* noop */
        }

        // Get the saved message with its _id from the database
        const savedQuery = await Query.findOne({ petitionId });
        const savedMessage = savedQuery.messages[savedQuery.messages.length - 1];

        // Broadcast message to all users in the query room with complete data
        const queryRoomSockets = await queryNamespace.in(petitionId).fetchSockets();
        console.log(`🔍 Query namespace sockets in room ${petitionId}:`, queryRoomSockets.length);

        queryNamespace.to(petitionId).emit('new-query-message', {
          petitionId,
          message: {
            _id: savedMessage._id,
            sender: savedMessage.sender,
            senderName: savedMessage.senderName,
            senderRole: savedMessage.senderRole,
            message: savedMessage.message,
            timestamp: savedMessage.timestamp,
          },
          queryStatus: savedQuery.status,
        });

        // Also send to widget namespace for customer-facing widget
        const io = queryNamespace.server;
        if (io && user.role !== 'Customer') {
          // Only send agent messages to widget (customer messages already handled by widget namespace)
          const widgetNamespace = io.of('/widget');
          const roomSockets = await widgetNamespace.in(petitionId).fetchSockets();
          console.log(`🔍 Widget sockets in room ${petitionId}:`, roomSockets.length);

          widgetNamespace.to(petitionId).emit('new-message', {
            message: savedMessage.message,
            senderName: savedMessage.senderName,
            senderRole: savedMessage.senderRole,
            timestamp: savedMessage.timestamp,
            sender: 'agent',
          });
          console.log(`📤 Sent agent message to /widget namespace for petition ${petitionId}`, {
            roomClients: roomSockets.length,
            message: savedMessage.message?.substring(0, 50),
            senderName: savedMessage.senderName,
            agentRole: savedMessage.senderRole,
          });
        }

        console.log(`✅ Message broadcasted to room ${petitionId}:`, savedMessage);
      } catch (error) {
        console.error('Send query message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator (for users in /query namespace - agents/customers)
    socket.on('typing', ({ petitionId, userId, userName, isTyping }) => {
      socket.to(petitionId).emit('user-typing', {
        petitionId,
        userId,
        userName,
        isTyping,
      });
    });

    // Agent typing indicator (relay to widget namespace)
    socket.on('agent-typing', ({ petitionId, agentName, isTyping }) => {
      // Broadcast to agents in query namespace
      socket.to(petitionId).emit('agent-typing', {
        petitionId,
        agentName,
        isTyping,
      });

      // Also relay to widget namespace for website customers
      const io = queryNamespace.server;
      if (io) {
        io.of('/widget').to(petitionId).emit('agent-typing', {
          petitionId,
          agentName,
          isTyping,
        });
      }
    });

    // Customer typing from widget (relay to agents in query namespace)
    socket.on('customer-typing', ({ petitionId, userName, isTyping }) => {
      // Relay to agents in query namespace
      queryNamespace.to(petitionId).emit('user-typing', {
        petitionId,
        userId: 'widget-customer',
        userName: userName || 'Customer',
        isTyping,
      });
    });

    // Accept query
    socket.on('accept-query', async ({ petitionId, agentId }) => {
      try {
        const agent = await User.findById(agentId);
        if (!agent) {
          socket.emit('error', { message: 'Agent not found' });
          return;
        }

        // Only Agents or TL can accept queries
        const allowedAcceptors = ['Agent', 'TL'];
        if (!allowedAcceptors.includes(agent.role)) {
          socket.emit('error', {
            message: 'Only Agents or TL can accept queries',
          });
          return;
        }

        const query = await Query.findOne({ petitionId });
        if (!query) {
          socket.emit('error', { message: 'Query not found' });
          return;
        }

        if (query.status !== 'Pending' && query.status !== 'Transferred') {
          socket.emit('error', { message: 'Query already accepted' });
          return;
        }

        // If there is a transfer request, enforce that only the intended recipient can accept
        if (
          query.status === 'Transferred' &&
          Array.isArray(query.transferHistory) &&
          query.transferHistory.length > 0
        ) {
          const latestTransfer = query.transferHistory[query.transferHistory.length - 1];
          if (
            latestTransfer?.status === 'Requested' &&
            latestTransfer.toAgent?.toString() !== agentId
          ) {
            socket.emit('error', {
              message: 'You are not authorized to accept this transfer',
            });
            return;
          }
          // Mark transfer accepted
          latestTransfer.status = 'Accepted';
          latestTransfer.acceptedAt = new Date();
        }

        // If accepting a transferred query, set to 'In Progress' directly
        // If accepting a new pending query, set to 'Accepted'
        query.status = query.status === 'Transferred' ? 'In Progress' : 'Accepted';
        const agentDisplayName = agent.alias || agent.name;
        query.assignedTo = agentId;
        query.assignedToName = agentDisplayName;
        query.assignedToRole = agent.role;
        query.assignedAt = new Date();
        query.messages.push({
          sender: agentId,
          senderName: 'System',
          senderRole: 'System',
          message: `${agentDisplayName} has accepted this query`,
        });

        // ✅ Set agent status to BUSY (actively handling a query)
        agent.workStatus = 'busy';
        await agent.save();
        await query.save();

        // Populate before broadcasting
        await query.populate('assignedTo', 'name email role department workStatus');
        await query.populate('customer', 'name email mobile');

        console.log('✅ Query accepted via socket, assignedTo:', query.assignedTo);

        // Broadcast to all clients in query namespace
        queryNamespace.emit('query-accepted', {
          petitionId,
          assignedTo: {
            id: agent._id,
            name: agentDisplayName,
            role: agent.role,
            alias: agent.alias,
          },
          query,
        });

        // ✅ Emit status change to agent's personal room (for UniversalAppbar)
        const userRoom = `user:${agentId}`;
        queryNamespace.to(userRoom).emit('work-status-changed', {
          status: 'busy',
          timestamp: new Date(),
        });
        console.log(`📡 Emitted work-status-changed (busy) to ${userRoom}`);

        // Also notify widget namespace so customer can see assigned agent
        const io = queryNamespace.server;
        if (io) {
          io.of('/widget').to(petitionId).emit('query-accepted', {
            petitionId,
            agentName: agentDisplayName,
            agentRole: agent.role,
            status: query.status,
          });
          console.log(`📤 Sent query-accepted to /widget namespace for petition ${petitionId}`);
        }
      } catch (error) {
        console.error('Accept query error:', error);
        socket.emit('error', { message: 'Failed to accept query' });
      }
    });

    // Transfer query
    socket.on('transfer-query', async ({ petitionId, fromAgentId, toAgentId, reason }) => {
      try {
        const fromAgent = await User.findById(fromAgentId);
        const toAgent = await User.findById(toAgentId);

        if (!fromAgent || !toAgent) {
          socket.emit('error', { message: 'Agent not found' });
          return;
        }

        // Updated policy
        const allowedInitiators = ['Agent', 'QA', 'TL'];
        const allowedRecipients = ['Agent', 'QA'];
        if (!allowedInitiators.includes(fromAgent.role)) {
          socket.emit('error', {
            message: 'Only Agent, QA, or TL can initiate transfers',
          });
          return;
        }
        if (!allowedRecipients.includes(toAgent.role)) {
          socket.emit('error', {
            message: 'Query can only be transferred to an Agent or QA',
          });
          return;
        }

        const query = await Query.findOne({ petitionId });
        if (!query) {
          socket.emit('error', { message: 'Query not found' });
          return;
        }

        // Only the currently assigned agent can transfer the query
        if (!query.assignedTo || query.assignedTo.toString() !== fromAgentId) {
          socket.emit('error', {
            message: 'You are not assigned to this query',
          });
          return;
        }

        query.transferHistory.push({
          fromAgent: fromAgentId,
          fromAgentName: fromAgent.alias || fromAgent.name,
          toAgent: toAgentId,
          toAgentName: toAgent.alias || toAgent.name,
          reason,
        });

        query.status = 'Transferred';
        query.assignedTo = null;
        query.assignedToName = null;
        query.assignedToRole = null;

        query.messages.push({
          sender: fromAgentId,
          senderName: 'System',
          senderRole: 'System',
          message: `Query transferred from ${fromAgent.alias || fromAgent.name} to ${
            toAgent.alias || toAgent.name
          }`,
        });

        await query.save();

        // ✅ Update Sender Status: Check if current agent has any other active queries
        const activeQueriesCount = await Query.countDocuments({
          assignedTo: fromAgentId,
          status: { $in: ['Accepted', 'In Progress'] },
        });

        if (activeQueriesCount === 0) {
          fromAgent.workStatus = 'active';
          await fromAgent.save({ validateModifiedOnly: true });
          console.log(
            `✅ Agent ${fromAgent.name} status updated to ACTIVE (No other active queries)`
          );

          // ✅ Emit status change to agent's personal room
          const userRoom = `user:${fromAgentId}`;
          queryNamespace.to(userRoom).emit('work-status-changed', {
            status: 'active',
            timestamp: new Date(),
          });
          console.log(`📡 Emitted work-status-changed (active) to ${userRoom}`);
        } else {
          console.log(
            `ℹ️ Agent ${fromAgent.name} remains BUSY (Has ${activeQueriesCount} other active queries)`
          );
        }

        // Broadcast to all clients that transfer has been initiated
        queryNamespace.emit('query-transferred', {
          petitionId,
          from: {
            id: fromAgent._id,
            name: fromAgent.alias || fromAgent.name,
          },
          to: {
            id: toAgent._id,
            name: toAgent.alias || toAgent.name,
          },
          query,
        });

        // Also notify widget namespace about the transfer
        const io = queryNamespace.server;
        if (io) {
          io.of('/widget')
            .to(petitionId)
            .emit('query-transferred', {
              petitionId,
              fromAgentName: fromAgent.alias || fromAgent.name,
              toAgentName: toAgent.alias || toAgent.name,
              status: query.status,
            });
          console.log(`📤 Sent query-transferred to /widget namespace for petition ${petitionId}`);
        }

        // Also notify the specific target agent (by their personal room) about the transfer request
        try {
          const targetRoom = `user:${toAgentId}`;
          queryNamespace.to(targetRoom).emit('transfer-request', {
            petitionId,
            from: {
              id: fromAgent._id,
              name: fromAgent.alias || fromAgent.name,
            },
            to: { id: toAgent._id, name: toAgent.alias || toAgent.name },
            reason,
            query,
          });
          console.log(`Emitted transfer-request to room ${targetRoom} for petition ${petitionId}`);
        } catch (err) {
          console.error('Failed to emit transfer-request to target agent room:', err);
        }
      } catch (error) {
        console.error('Transfer query error:', error);
        socket.emit('error', { message: 'Failed to transfer query' });
      }
    });

    // Resolve query
    socket.on('resolve-query', async ({ petitionId, agentId }) => {
      try {
        const agent = await User.findById(agentId);
        if (!agent) {
          socket.emit('error', { message: 'Agent not found' });
          return;
        }

        const query = await Query.findOne({ petitionId });
        if (!query) {
          socket.emit('error', { message: 'Query not found' });
          return;
        }

        query.status = 'Resolved';
        query.resolvedAt = new Date();
        query.resolvedBy = agentId;
        query.resolvedByName = agent.alias || agent.name;
        query.isActive = false;

        // System message is added in the controller to prevent duplicates

        // ✅ Check if agent has any other active queries
        const activeQueriesCount = await Query.countDocuments({
          assignedTo: agentId,
          status: { $in: ['Accepted', 'In Progress'] },
          petitionId: { $ne: petitionId }, // Exclude current query
        });

        // Only set to active if no other queries are being handled
        if (activeQueriesCount === 0) {
          agent.workStatus = 'active';
          await agent.save();
          console.log(`✅ Agent ${agent.name} status updated to ACTIVE (No other active queries)`);
        } else {
          console.log(
            `ℹ️ Agent ${agent.name} remains BUSY (Has ${activeQueriesCount} other active queries)`
          );
        }

        await query.save();

        // Broadcast to all clients in the query room
        queryNamespace.to(petitionId).emit('query-resolved', {
          petitionId,
          resolvedBy: {
            id: agent._id,
            name: agent.alias || agent.name,
          },
          query,
        });

        // ✅ Emit status change to agent's personal room (for UniversalAppbar)
        const userRoom = `user:${agentId}`;
        queryNamespace.to(userRoom).emit('work-status-changed', {
          status: agent.workStatus,
          timestamp: new Date(),
        });
        console.log(`📡 Emitted work-status-changed (${agent.workStatus}) to ${userRoom}`);

        // Also notify widget namespace (for customer-facing widget)
        const io = queryNamespace.server;
        if (io) {
          io.of('/widget')
            .to(petitionId)
            .emit('query-resolved', {
              petitionId,
              resolvedBy: {
                id: agent._id,
                name: agent.alias || agent.name,
              },
              status: 'Resolved',
            });
          console.log(`📡 Emitted query-resolved to /widget namespace for petition ${petitionId}`);

          // Request feedback from customer via widget namespace
          io.of('/widget').to(petitionId).emit('request-feedback', {
            petitionId,
          });
          console.log(
            `📝 Emitted request-feedback to /widget namespace for petition ${petitionId}`
          );
        }

        // Request feedback from customer in query namespace (for authenticated customers)
        queryNamespace.to(petitionId).emit('request-feedback', {
          petitionId,
        });
      } catch (error) {
        console.error('Resolve query error:', error);
        socket.emit('error', { message: 'Failed to resolve query' });
      }
    });

    // Request camera snapshot from customer (initiators: assigned Agent/QA/TL)
    socket.on('request-camera-snapshot', async ({ petitionId }) => {
      try {
        if (!socket.userId) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        const user = await User.findById(socket.userId);
        if (!user) return socket.emit('error', { message: 'User not found' });

        const query = await Query.findOne({ petitionId });
        if (!query) return socket.emit('error', { message: 'Query not found' });

        // Only assigned Agent/QA/TL can request snapshot
        const allowed = ['Agent', 'QA', 'TL'];
        const isAssigned = query.assignedTo && query.assignedTo.toString() === socket.userId;
        if (!allowed.includes(user.role) || !isAssigned) {
          return socket.emit('error', {
            message: 'Not authorized to request snapshot',
          });
        }

        // Relay snapshot request to all clients in the petition room (customer app)
        queryNamespace.to(petitionId).emit('request-camera-snapshot', {
          petitionId,
          requester: {
            id: user._id,
            name: user.alias || user.name,
            role: user.role,
          },
          timestamp: new Date(),
        });

        // Also notify widget namespace so website widget customers receive it
        const io = queryNamespace.server;
        if (io) {
          io.of('/widget')
            .to(petitionId)
            .emit('request-camera-snapshot', {
              petitionId,
              requesterName: user.alias || user.name,
              requesterRole: user.role,
              timestamp: new Date(),
            });
        }
      } catch (error) {
        console.error('request-camera-snapshot error:', error);
        socket.emit('error', { message: 'Failed to request snapshot' });
      }
    });

    // Submit customer feedback for resolved query
    socket.on('submit-feedback', async ({ petitionId, rating, comment }) => {
      try {
        console.log('📝 Receiving feedback for petition:', petitionId, {
          rating,
          comment,
        });

        const query = await Query.findOne({ petitionId });
        if (!query) {
          return socket.emit('error', { message: 'Query not found' });
        }

        if (query.status !== 'Resolved') {
          return socket.emit('error', {
            message: 'Can only provide feedback for resolved queries',
          });
        }

        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
          return socket.emit('error', {
            message: 'Rating must be between 1 and 5',
          });
        }

        // Update query with feedback
        query.feedback = {
          rating: rating,
          comment: comment || '',
          submittedAt: new Date(),
        };
        await query.save();

        console.log('✅ Feedback saved for petition:', petitionId);

        // Notify agents in the query room
        queryNamespace.to(petitionId).emit('feedback-received', {
          petitionId,
          rating,
          comment,
          timestamp: new Date(),
        });

        // Confirm to customer
        socket.emit('feedback-submitted', {
          petitionId,
          success: true,
        });
      } catch (error) {
        console.error('submit-feedback error:', error);
        socket.emit('error', { message: 'Failed to submit feedback' });
      }
    });

    // Leave query room
    socket.on('leave-query', ({ petitionId, userId }) => {
      socket.leave(petitionId);
      console.log(`User ${userId} left query ${petitionId}`);

      queryNamespace.to(petitionId).emit('user-left', {
        userId,
        petitionId,
        timestamp: new Date(),
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected from query namespace: ${socket.id}`);
    });
  });

  return queryNamespace;
};
