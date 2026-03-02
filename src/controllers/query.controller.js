const Query = require('../models/Query');
const User = require('../models/User');
const Booking = require('../models/Booking');
const QueryEvaluation = require('../models/QueryEvaluation');
const Organization = require('../models/Organization');
const generatePetition = require('../utils/generatePetation');
const moment = require('moment-timezone');

// Helper: shape escalation chain from transferHistory
function buildEscalationChain(query) {
  if (!query || !Array.isArray(query.transferHistory)) return [];
  return query.transferHistory.map((t, idx) => ({
    step: idx + 1,
    from: {
      id: t.fromAgent?._id || t.fromAgent,
      name: t.fromAgentName,
      role: t.fromAgent && t.fromAgent.role ? t.fromAgent.role : undefined,
    },
    to: {
      id: t.toAgent?._id || t.toAgent,
      name: t.toAgentName,
      role: t.toAgent && t.toAgent.role ? t.toAgent.role : undefined,
    },
    status: t.status,
    reason: t.reason || null,
    requestedAt: t.requestedAt || t.transferredAt,
    acceptedAt: t.acceptedAt || null,
  }));
}

// Create a new query (Customer)
exports.createQuery = async (req, res) => {
  try {
    const customerId = req.user?.id;
    const { subject, category, priority, initialMessage, bookingId } = req.body;

    const customer = await User.findById(customerId);
    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    const petitionId = generatePetition();

    const newQuery = await Query.create({
      petitionId,
      contactId: customerId, // Contact ID is the User ID
      customer: customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      organizationId: customer.organizationId, // ✅ Add organization isolation
      subject,
      category: category || 'Other',
      bookingId: bookingId || null,
      priority: priority || 'Medium',
      status: 'Pending',
      messages: initialMessage
        ? [
          {
            sender: customerId,
            senderName: customer.name,
            senderRole: 'Customer',
            message: initialMessage,
          },
        ]
        : [],
    });

    // Emit socket event to notify agents/QA of the SAME ORGANIZATION only
    const io = req.app.get('io');
    if (io && customer.organizationId) {
      const eventData = {
        petitionId: newQuery.petitionId,
        customerName: newQuery.customerName,
        subject: newQuery.subject,
        category: newQuery.category,
        priority: newQuery.priority,
        organizationId: customer.organizationId.toString(),
        timestamp: new Date(),
      };

      const orgRoom = `org:${customer.organizationId}`;

      // 🎯 1. Find all "Available" agents in DB (Active status + Correct Role)
      // For NEW queries: Only notify Agents (not TL/QA - they only handle escalations)
      const availableUsers = await User.find({
        organizationId: customer.organizationId,
        role: 'Agent', // ✅ Only Agents get new query notifications
        workStatus: 'active',
      }).distinct('_id');

      const availableUserIds = availableUsers.map((id) => id.toString());

      // 🎯 2. Find all "Busy" agents (Active Queries: Accepted or In Progress)
      const busyAgents = await Query.find({
        organizationId: customer.organizationId,
        status: { $in: ['Accepted', 'In Progress'] },
        assignedTo: { $ne: null },
      }).distinct('assignedTo');

      const busyAgentIds = busyAgents.map((id) => id.toString());

      // 🎯 3. Determine Final Target List (Available - Busy)
      const targetUserIds = availableUserIds.filter((id) => !busyAgentIds.includes(id));

      console.log(`🎯 Notification Targets Calculation:`, {
        totalActive: availableUserIds.length,
        availableUserIds,
        totalBusy: busyAgentIds.length,
        busyAgentIds,
        finalTargets: targetUserIds.length,
        targetUserIds,
      });

      // 🎯 4. Get all sockets in the organization room
      const queryNamespace = io.of('/query');
      const roomSockets = await queryNamespace.in(orgRoom).fetchSockets();

      console.log(`🔌 Sockets in room ${orgRoom}: ${roomSockets.length}`);

      // 🎯 5. Emit ONLY to targeted users
      let sentCount = 0;
      for (const socket of roomSockets) {
        const socketUserId = socket.userId ? socket.userId.toString() : 'unknown';

        console.log(
          `🔍 Checking socket: ${socket.id
          } | User: ${socketUserId} | Target? ${targetUserIds.includes(socketUserId)}`
        );

        // Check if this socket belongs to a targeted user
        if (targetUserIds.includes(socketUserId)) {
          // 🛡️ DOUBLE CHECK: Explicitly verify if this specific user is busy
          // This handles race conditions where they might have just accepted a query
          const isTrulyBusy = await Query.exists({
            assignedTo: socketUserId,
            status: { $in: ['Accepted', 'In Progress'] },
          });

          if (isTrulyBusy) {
            console.log(`🚫 Skipped busy agent (Double Check): ${socketUserId}`);
            continue;
          }

          socket.emit('new-pending-query', eventData);
          sentCount++;
          console.log(`✅ Sent notification to user: ${socketUserId}`);
        } else {
          console.log(`⏩ Skipped (not in target list): ${socketUserId}`);
        }
      }

      console.log(
        `📊 Notification Summary: Sent to ${sentCount}/${roomSockets.length} sockets in ${orgRoom}`
      );
    } else {
      console.warn('⚠️ Socket.io instance not found or customer has no organizationId');
    }

    res.status(201).json({
      status: true,
      message: 'Query created successfully',
      data: newQuery,
    });
  } catch (error) {
    console.error('Create Query Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to create query',
      error: error.message,
    });
  }
};

// Get all queries for customer
exports.getCustomerQueries = async (req, res) => {
  try {
    const customerId = req.user?.id;
    const { status } = req.query;

    const filter = { customer: customerId };
    if (status) {
      filter.status = status;
    }

    const queries = await Query.find(filter)
      .populate('assignedTo', 'name email role department alias')
      .sort({ createdAt: -1 });

    // Separate queries by status
    const pending = queries.filter((q) => q.status === 'Pending');
    const accepted = queries.filter((q) =>
      ['Accepted', 'In Progress', 'Transferred'].includes(q.status)
    );
    const resolved = queries.filter((q) => q.status === 'Resolved');
    const expired = queries.filter((q) => q.status === 'Expired');

    res.status(200).json({
      status: true,
      data: {
        all: queries,
        pending,
        accepted,
        resolved,
        expired,
        counts: {
          total: queries.length,
          pending: pending.length,
          accepted: accepted.length,
          resolved: resolved.length,
          expired: expired.length,
        },
      },
    });
  } catch (error) {
    console.error('Get Customer Queries Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch queries',
      error: error.message,
    });
  }
};

// Get all queries for Agent/QA
exports.getAllQueries = async (req, res) => {
  try {
    const { status, category, assignedTo, transferTarget, page, limit, sort } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (assignedTo) filter.assignedTo = assignedTo;

    // Multi-tenancy scoping (unless SuperAdmin)
    if (req.user?.role !== 'SuperAdmin' && req.user?.organizationId) {
      filter.organizationId = req.user.organizationId;
    }

    // Build base Mongoose query
    const baseQuery = Query.find(filter)
      .populate('customer', 'name email mobile profileImage')
      .populate('assignedTo', 'name email role department workStatus alias');

    // Sorting: allow sort=createdAt:desc,status:asc etc.
    let sortSpec = { createdAt: -1 };
    if (sort) {
      try {
        // sort param format: field:dir,field2:dir2
        const parsed = {};
        sort.split(',').forEach((pair) => {
          const [f, d] = pair.split(':');
          if (f) parsed[f] = d === 'asc' ? 1 : -1;
        });
        if (Object.keys(parsed).length) sortSpec = parsed;
      } catch (_) { }
    }
    baseQuery.sort(sortSpec);

    // Pagination defaults (optional)
    const usePagination = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(limit || '20', 10), 1), 100); // cap at 100
    let total = 0;
    let queries;

    if (transferTarget === 'me' && req.user?.id) {
      // Need to filter after fetching transferHistory; do minimal projection
      // First get all matching docs (could optimize via aggregation if very large)
      const raw = await baseQuery.clone();
      const uid = req.user.id.toString();
      const filtered = raw.filter((q) => {
        if (q.status !== 'Transferred' || !q.transferHistory?.length) return false;
        const latest = q.transferHistory[q.transferHistory.length - 1];
        return latest.status === 'Requested' && latest.toAgent?.toString() === uid;
      });
      total = filtered.length;
      if (usePagination) {
        const start = (pageNum - 1) * pageSize;
        queries = filtered.slice(start, start + pageSize);
      } else {
        queries = filtered;
      }
    } else if (usePagination) {
      total = await Query.countDocuments(filter);
      queries = await baseQuery.skip((pageNum - 1) * pageSize).limit(pageSize);
    } else {
      queries = await baseQuery;
      total = queries.length;
    }

    // Fetch evaluations for the retrieved queries
    const petitionIds = queries.map((q) => q.petitionId);
    const evaluations = await QueryEvaluation.find({
      petitionId: { $in: petitionIds },
    }).populate('evaluatedBy', 'name email');

    // Attach evaluation to each query
    queries = queries.map((q) => {
      const qObj = q.toObject ? q.toObject() : q;
      const evaluation = evaluations.find((e) => e.petitionId === q.petitionId);
      return { ...qObj, evaluation: evaluation || null };
    });

    // Separate queries by status
    const pending = queries.filter((q) => q.status === 'Pending');
    const accepted = queries.filter((q) => ['Accepted', 'In Progress'].includes(q.status));
    const resolved = queries.filter((q) => q.status === 'Resolved');
    const transferred = queries.filter((q) => q.status === 'Transferred');

    // Overall counts (without pagination slice) for UI summary
    let overallCounts;
    const userId = req.user?.id;

    if (usePagination && transferTarget !== 'me') {
      // Query DB for counts quickly
      const [pendingCount, acceptedCount, resolvedCount, transferredCount] = await Promise.all([
        Query.countDocuments({ ...filter, status: 'Pending' }),
        Query.countDocuments({
          ...filter,
          status: { $in: ['Accepted', 'In Progress'] },
        }),
        Query.countDocuments({ ...filter, status: 'Resolved' }),
        Query.countDocuments({ ...filter, status: 'Transferred' }),
      ]);

      // Calculate escalated count: queries where user is either fromAgent OR toAgent
      let escalatedCount = 0;
      if (userId) {
        const escalatedByMe = await Query.countDocuments({
          ...filter,
          'transferHistory.fromAgent': userId,
        });
        const escalatedToMe = await Query.countDocuments({
          ...filter,
          'transferHistory.toAgent': userId,
        });
        // Use Set to avoid double counting if user appears in both
        const escalatedQueries = await Query.find({
          ...filter,
          $or: [
            { 'transferHistory.fromAgent': userId },
            { 'transferHistory.toAgent': userId },
          ],
        }).distinct('_id');
        escalatedCount = escalatedQueries.length;
      }

      overallCounts = {
        total,
        pending: pendingCount,
        accepted: acceptedCount,
        resolved: resolvedCount,
        transferred: transferredCount,
        escalated: escalatedCount,
      };
    } else if (transferTarget === 'me') {
      // For transferTarget filtering we already have 'total'
      // Calculate escalated from loaded queries
      let escalatedCount = 0;
      if (userId) {
        escalatedCount = queries.filter((q) => {
          if (q.transferHistory && q.transferHistory.length > 0) {
            return q.transferHistory.some((t) => {
              const fromId = t.fromAgent?._id?.toString() || t.fromAgent?.toString();
              const toId = t.toAgent?._id?.toString() || t.toAgent?.toString();
              return fromId === userId.toString() || toId === userId.toString();
            });
          }
          return false;
        }).length;
      }

      overallCounts = {
        total,
        pending: pending.length, // local slice
        accepted: accepted.length,
        resolved: resolved.length,
        transferred: transferred.length,
        escalated: escalatedCount,
      };
    } else {
      // Calculate escalated from loaded queries
      let escalatedCount = 0;
      if (userId) {
        escalatedCount = queries.filter((q) => {
          if (q.transferHistory && q.transferHistory.length > 0) {
            return q.transferHistory.some((t) => {
              const fromId = t.fromAgent?._id?.toString() || t.fromAgent?.toString();
              const toId = t.toAgent?._id?.toString() || t.toAgent?.toString();
              return fromId === userId.toString() || toId === userId.toString();
            });
          }
          return false;
        }).length;
      }

      overallCounts = {
        total,
        pending: pending.length,
        accepted: accepted.length,
        resolved: resolved.length,
        transferred: transferred.length,
        escalated: escalatedCount,
      };
    }

    res.status(200).json({
      status: true,
      pagination: usePagination
        ? {
          page: pageNum,
          limit: pageSize,
          total,
          pages: Math.ceil(total / pageSize),
        }
        : null,
      data: {
        all: queries,
        pending,
        accepted,
        resolved,
        transferred,
        counts: overallCounts,
      },
    });
  } catch (error) {
    console.error('Get All Queries Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch queries',
      error: error.message,
    });
  }
};

// Get single query by petitionId
exports.getQueryByPetitionId = async (req, res) => {
  try {
    const { petitionId } = req.params;

    const query = await Query.findOne({ petitionId })
      .populate('customer', 'name email mobile profileImage')
      .populate('assignedTo', 'name email role department workStatus profileImage alias')
      .populate('messages.sender', 'name email role profileImage');

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    res.status(200).json({
      status: true,
      data: query,
    });
  } catch (error) {
    console.error('Get Query Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch query',
      error: error.message,
    });
  }
};

// New: Get escalation chain for a query (QA/TL visibility + any assigned agent)
exports.getEscalationChain = async (req, res) => {
  try {
    const { petitionId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const query = await Query.findOne({ petitionId })
      .populate('transferHistory.fromAgent', 'name role')
      .populate('transferHistory.toAgent', 'name role');

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Authorization: QA, TL, Admin can view any; assigned agent can view; customer cannot
    const isAssignedAgent = query.assignedTo && query.assignedTo.toString() === userId;
    const privilegedRoles = ['QA', 'TL', 'Admin', 'SuperAdmin'];
    if (!isAssignedAgent && !privilegedRoles.includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Not authorized to view escalation chain',
      });
    }

    const chain = buildEscalationChain(query);

    res.status(200).json({
      status: true,
      data: {
        petitionId: query.petitionId,
        currentStatus: query.status,
        activeAssignee: query.assignedTo
          ? {
            id: query.assignedTo,
            name: query.assignedToName,
            role: query.assignedToRole,
          }
          : null,
        chain,
        totalTransfers: chain.length,
      },
    });
  } catch (error) {
    console.error('Get Escalation Chain Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch escalation chain',
      error: error.message,
    });
  }
};

// New: Get recent escalations for dashboard (QA/TL visibility)
exports.getRecentEscalations = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const orgId = req.user?.organizationId;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

    if (!['QA', 'TL', 'Admin', 'SuperAdmin'].includes(userRole)) {
      return res.status(403).json({ status: false, message: 'Not authorized' });
    }

    const filter = { 'transferHistory.0': { $exists: true } };
    if (orgId) filter.organizationId = orgId;

    const queries = await Query.find(filter)
      .select(
        'petitionId subject category priority status assignedTo assignedToName assignedToRole transferHistory updatedAt createdAt'
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .populate('transferHistory.fromAgent', 'name role')
      .populate('transferHistory.toAgent', 'name role');

    const data = queries.map((q) => ({
      petitionId: q.petitionId,
      subject: q.subject,
      category: q.category,
      priority: q.priority,
      currentStatus: q.status,
      activeAssignee: q.assignedTo
        ? { id: q.assignedTo, name: q.assignedToName, role: q.assignedToRole }
        : null,
      lastUpdated: q.updatedAt,
      chain: buildEscalationChain(q),
      totalTransfers: Array.isArray(q.transferHistory) ? q.transferHistory.length : 0,
    }));

    res.status(200).json({ status: true, data });
  } catch (error) {
    console.error('Get Recent Escalations Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch recent escalations',
      error: error.message,
    });
  }
};

// Accept/Assign query (Agent/QA)
exports.acceptQuery = async (req, res) => {
  try {
    console.log('Accept Query - Start:', {
      agentId: req.user?.id,
      petitionId: req.params.petitionId,
      user: req.user,
    });

    const agentId = req.user?.id;
    const { petitionId } = req.params;

    if (!agentId) {
      console.error('Accept Query - No agent ID found in req.user');
      return res.status(401).json({ status: false, message: 'User not authenticated' });
    }

    const agent = await User.findById(agentId);
    console.log('Accept Query - Agent found:', agent ? agent.name : 'Not found');

    if (!agent) {
      return res.status(404).json({ status: false, message: 'Agent not found' });
    }

    const query = await Query.findOne({ petitionId });
    console.log('Accept Query - Query found:', query ? query.petitionId : 'Not found');

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    if (query.status !== 'Pending' && query.status !== 'Transferred') {
      console.log('Accept Query - Query already accepted, status:', query.status);
      return res.status(400).json({
        status: false,
        message: 'Query already accepted by someone else',
      });
    }

    // If this query has a pending transfer request, ensure this agent is the target
    const latestTransfer = query.transferHistory?.length
      ? query.transferHistory[query.transferHistory.length - 1]
      : null;
    if (query.status === 'Transferred' && latestTransfer && latestTransfer.status === 'Requested') {
      // Allow only the intended recipient to accept
      if (latestTransfer.toAgent?.toString() !== agentId) {
        console.log('Accept Query - Not the intended recipient of transfer request');
        return res.status(403).json({
          status: false,
          message: 'You are not authorized to accept this transfer',
        });
      }

      // Mark transfer as accepted
      latestTransfer.status = 'Accepted';
      latestTransfer.acceptedAt = new Date();

      // Set query to In Progress and assign
      query.status = 'In Progress';
      query.assignedTo = agentId;
      query.assignedToName = agent.alias || agent.name;
      query.assignedToRole = agent.role;
      query.assignedAt = new Date();
    } else {
      // Regular accept flow for pending queries
      query.status = query.status === 'Transferred' ? 'In Progress' : 'Accepted';
      query.assignedTo = agentId;
      query.assignedToName = agent.alias || agent.name;
      query.assignedToRole = agent.role;
      query.assignedAt = new Date();

      // ==================== FMCG SLA TRACKING ====================
      // Calculate First Response Time (FRT) in seconds
      if (query.createdAt) {
        const frtSeconds = Math.floor((new Date() - new Date(query.createdAt)) / 1000);
        if (!query.interactionMetrics) query.interactionMetrics = {};
        query.interactionMetrics.firstResponseTime = frtSeconds;

        // Check for SLA Breach (default 60s if not found in Org)
        const org = await Organization.findById(query.organizationId);
        const frtLimit = org?.fmcgSettings?.slaTargets?.frt || 60;
        if (frtSeconds > frtLimit) {
          query.slaBreach = true;
          query.autoTags.push('SLA Breach - FRT');
        }

        // Set SLA Clock for Resolution (Handle Time Target)
        const ahtLimit = org?.fmcgSettings?.slaTargets?.aht || 600;
        query.interactionMetrics.slaClock = new Date(Date.now() + ahtLimit * 1000);
      }
    }

    // ========== ACCUMULATE ACTIVE TIME BEFORE GOING BUSY ==========
    // If agent was active, accumulate time before switching to busy
    if (agent.workStatus === 'active' && agent.lastStatusChangeTime) {
      const now = new Date();
      const activeDuration = (now - new Date(agent.lastStatusChangeTime)) / 1000 / 60;
      agent.accumulatedActiveTime =
        (agent.accumulatedActiveTime || 0) + Math.max(0, activeDuration);
      console.log(
        `✅ Accumulated ${Math.floor(activeDuration)}min before going busy. Total: ${Math.floor(
          agent.accumulatedActiveTime
        )}min`
      );
    }

    // ✅ Set agent status to BUSY when accepting a query
    agent.workStatus = 'busy';
    agent.lastStatusChangeTime = new Date(); // Track when busy started
    await agent.save({ validateModifiedOnly: true });
    console.log(`✅ Agent ${agent.name} status updated to BUSY`);

    console.log('🔧 Before Save - assignedTo details:', {
      agentId,
      agentIdType: typeof agentId,
      assignedToValue: query.assignedTo,
      assignedToType: typeof query.assignedTo,
      assignedToConstructor: query.assignedTo?.constructor?.name,
    });

    // Add system message (with transfer context if applicable)
    const latestTransferMsg = query.transferHistory?.length
      ? query.transferHistory[query.transferHistory.length - 1]
      : null;
    if (latestTransferMsg && latestTransferMsg.status === 'Requested') {
      latestTransferMsg.status = 'Accepted';
      latestTransferMsg.acceptedAt = new Date();
      query.messages.push({
        sender: agentId,
        senderName: 'System',
        senderRole: 'System',
        message: `Transfer from ${latestTransferMsg.fromAgentName} accepted by ${agent.alias || agent.name
          }`,
      });
    } else if (latestTransferMsg && latestTransferMsg.status === 'Accepted') {
      query.messages.push({
        sender: agentId,
        senderName: 'System',
        senderRole: 'System',
        message: `Transferred by ${latestTransferMsg.fromAgentName}; now handled by ${agent.alias || agent.name
          }`,
      });
    } else {
      query.messages.push({
        sender: agentId,
        senderName: 'System',
        senderRole: 'System',
        message: `${agent.alias || agent.name} has accepted this query`,
      });
    }

    await query.save();

    console.log('✅ After Save - assignedTo details:', {
      assignedToValue: query.assignedTo,
      assignedToType: typeof query.assignedTo,
      assignedToString: query.assignedTo?.toString(),
    });

    // Populate the query before sending response
    await query.populate('assignedTo', 'name email role department workStatus alias');
    await query.populate('customer', 'name email mobile');

    console.log('Accept Query - Success, assignedTo:', query.assignedTo);

    // Emit socket event to notify all connected clients
    const io = req.app.get('io');
    if (io) {
      const queryNamespace = io.of('/query');
      queryNamespace.emit('query-accepted', {
        petitionId,
        status: query.status,
        agentName: agent.alias || agent.name,
        assignedTo: {
          _id: agent._id,
          name: agent.alias || agent.name,
          role: agent.role,
        },
        query,
      });
      console.log('📡 Emitted query-accepted event for', petitionId);

      // Notify customer widget that an agent accepted the query
      io.of('/widget')
        .to(petitionId)
        .emit('new-message', {
          message: `${agent.alias || agent.name} has accepted your query and will assist you now.`,
          senderName: 'System',
          senderRole: 'System',
          timestamp: new Date(),
          sender: 'system',
        });
    }

    res.status(200).json({
      status: true,
      message: 'Query accepted successfully',
      data: query,
    });
  } catch (error) {
    console.error('Accept Query Error:', error);
    console.error('Error Stack:', error.stack);
    res.status(500).json({
      status: false,
      message: 'Failed to accept query',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

// Send message in query
exports.sendQueryMessage = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { petitionId } = req.params;
    const { message } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }
    // ✅ Validate message content
    if (!message || !String(message).trim()) {
      return res.status(400).json({ status: false, message: 'Message text is required' });
    }
    const trimmedMessage = String(message).trim();

    // Check if user is authorized to send message in this query
    // Convert both to strings for reliable comparison
    const isCustomer = String(query.customer) === String(userId);
    const isAssignedAgent = query.assignedTo && String(query.assignedTo) === String(userId);

    console.log('📝 Send Message Authorization Debug:', {
      petitionId,
      userId,
      userIdType: typeof userId,
      userRole: user.role,
      customerIdInQuery: query.customer ? query.customer.toString() : null,
      customerIdType: query.customer ? query.customer.constructor?.name : null,
      assignedToInQuery: query.assignedTo ? query.assignedTo.toString() : 'null',
      assignedToType: typeof query.assignedTo,
      assignedToIsObjectId: query.assignedTo?.constructor?.name,
      isCustomer,
      isAssignedAgent,
      queryStatus: query.status,
      comparison1: query.assignedTo ? query.assignedTo.toString() : null,
      comparison2: userId,
      areEqual: query.assignedTo ? query.assignedTo.toString() === userId : false,
    });

    if (!isCustomer && !isAssignedAgent) {
      console.log('❌ Authorization failed - Not customer or assigned agent');
      return res.status(403).json({
        status: false,
        message: 'Not authorized to send message in this query',
      });
    }

    query.messages.push({
      sender: userId,
      senderName: user.alias || user.name,
      senderRole: user.role,
      message: trimmedMessage,
      timestamp: new Date(),
    });

    query.lastActivityAt = new Date();

    // Update status to In Progress if it was Accepted
    if (query.status === 'Accepted') {
      query.status = 'In Progress';
    }

    await query.save();

    // Get the saved message with its _id
    const savedQuery = await Query.findOne({ petitionId });
    const latestMessage = savedQuery.messages[savedQuery.messages.length - 1];

    // Emit socket events: to agent namespace (/query) and customer widget namespace (/widget)
    const io = req.app.get('io');
    if (io) {
      // Agent/QA/customer app listeners
      io.of('/query')
        .to(petitionId)
        .emit('new-query-message', {
          petitionId,
          message: {
            _id: latestMessage._id,
            sender: latestMessage.sender,
            senderName: latestMessage.senderName,
            senderRole: latestMessage.senderRole,
            message: latestMessage.message,
            timestamp: latestMessage.timestamp,
          },
          queryStatus: savedQuery.status,
        });
      console.log(`📤 Emitted new-query-message to /query room ${petitionId}`);

      // Customer-facing widget listeners (only for agent messages)
      if (user.role !== 'Customer') {
        io.of('/widget').to(petitionId).emit('new-message', {
          message: latestMessage.message,
          senderName: latestMessage.senderName,
          senderRole: latestMessage.senderRole,
          timestamp: latestMessage.timestamp,
          sender: 'agent',
        });
        console.log(`📤 Emitted agent message to /widget room ${petitionId}`);
      }
    }

    res.status(200).json({
      status: true,
      message: 'Message sent successfully',
      data: query,
    });
  } catch (error) {
    console.error('Send Message Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
};

// Transfer query to another agent / QA (initiators: Agent, QA, TL)
exports.transferQuery = async (req, res) => {
  try {
    const currentAgentId = req.user?.id;
    const { petitionId } = req.params;
    const { toAgentId, reason } = req.body;

    const currentAgent = await User.findById(currentAgentId);
    const toAgent = await User.findById(toAgentId);

    if (!currentAgent || !toAgent) {
      return res.status(404).json({ status: false, message: 'Agent not found' });
    }

    // Updated policy:
    // Initiators: Agent, QA, TL can initiate a transfer
    // Recipients: Agent or QA (TL typically supervises, excluded as target unless business decides otherwise)
    const allowedInitiators = ['Agent', 'QA', 'TL'];
    // Include TL as eligible escalation recipient
    const allowedRecipients = ['Agent', 'QA', 'TL'];

    if (!allowedInitiators.includes(currentAgent.role)) {
      return res.status(403).json({
        status: false,
        message: 'Only Agent, QA, or TL can initiate transfers',
      });
    }
    if (!allowedRecipients.includes(toAgent.role)) {
      return res.status(400).json({
        status: false,
        message: 'Query can only be transferred to an Agent or QA',
      });
    }

    // Check if target recipient is available - be lenient with workStatus check
    console.log('🔄 Target Agent Status Check:', {
      toAgentId,
      toAgentName: toAgent.name,
      workStatus: toAgent.workStatus,
      break: toAgent.break,
    });

    // 🛡️ BUSY CHECK: Prevent transfer if agent is busy handling another query

    // Check 1: Active queries in DB (The Source of Truth)
    const activeQuery = await Query.findOne({
      assignedTo: toAgentId,
      status: { $in: ['Accepted', 'In Progress'] },
    }).select('petitionId');

    if (activeQuery) {
      return res.status(400).json({
        status: false,
        message: `Target employee (${toAgent.name}) already has an active query (${activeQuery.petitionId}) in progress`,
      });
    }

    // Check 2: Explicit 'busy' status (Only if active query check passes)
    // If DB says busy but no active query found -> It's a stuck status, so we ALLOW transfer and auto-correct
    if (toAgent.workStatus === 'busy') {
      console.log(`⚠️ Auto-correcting stuck 'busy' status for ${toAgent.name} during transfer.`);
      toAgent.workStatus = 'active';
      await toAgent.save();
    }

    // Allow transfer to agents who are active, offline, or on break
    if (toAgent.workStatus === 'offline') {
      return res.status(400).json({
        status: false,
        message: `Target employee (${toAgent.name}) is currently offline.`,
      });
    }

    if (toAgent.workStatus === 'break') {
      return res.status(400).json({
        status: false,
        message: `Target employee (${toAgent.name}) is currently on break.`,
      });
    }

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    console.log('🔄 Transfer Query Check:', {
      petitionId,
      currentAgentId,
      queryStatus: query.status,
      queryAssignedTo: query.assignedTo?.toString() || 'null',
      canTransfer: query.assignedTo?.toString() === currentAgentId,
    });

    // Only allow transfer if the current user is assigned to the query
    // If assignedTo is null (Transferred status), they must accept it first before transferring
    if (!query.assignedTo) {
      return res.status(400).json({
        status: false,
        message: 'Please accept this transferred query first before transferring it again',
      });
    }

    if (query.assignedTo.toString() !== currentAgentId) {
      return res.status(403).json({
        status: false,
        message: 'You are not assigned to this query',
      });
    }

    // Add transfer history as a REQUEST
    const transferEntry = {
      fromAgent: currentAgentId,
      fromAgentName: currentAgent.alias || currentAgent.name,
      toAgent: toAgentId,
      toAgentName: toAgent.alias || toAgent.name,
      reason,
      status: 'Requested',
      requestedAt: new Date(),
    };

    query.transferHistory.push(transferEntry);

    // Mark query as Transferred and clear assignment until recipient accepts
    query.status = 'Transferred';
    query.assignedTo = null;
    query.assignedToName = null;
    query.assignedToRole = null;

    // Add system message indicating transfer
    // Customer-facing system message: DO NOT include transfer reason or role
    query.messages.push({
      sender: currentAgentId,
      senderName: 'System',
      senderRole: 'System',
      message: `Your query has been escalated and will be assisted shortly.`,
    });

    await query.save();

    // ✅ Update Sender Status: Check if current agent has any other active queries
    const activeQueriesCount = await Query.countDocuments({
      assignedTo: currentAgentId,
      status: { $in: ['Accepted', 'In Progress'] },
    });

    if (activeQueriesCount === 0) {
      currentAgent.workStatus = 'active';
      await currentAgent.save({ validateModifiedOnly: true });
      console.log(
        `✅ Agent ${currentAgent.name} status updated to ACTIVE (No other active queries)`
      );

      // ✅ Emit status change to agent's personal room
      const userRoom = `user:${currentAgentId}`;
      const queryNamespace = req.app.get('io').of('/query');
      queryNamespace.to(userRoom).emit('work-status-changed', {
        status: 'active',
        timestamp: new Date(),
      });
      console.log(`📡 Emitted work-status-changed (active) to ${userRoom}`);
    } else {
      console.log(
        `ℹ️ Agent ${currentAgent.name} remains BUSY (Has ${activeQueriesCount} other active queries)`
      );
    }

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      const queryNamespace = io.of('/query');

      // Notify all that a transfer was requested (UI can reflect it)
      queryNamespace.emit('query-transfer-requested', {
        petitionId,
        from: {
          id: currentAgent._id,
          name: currentAgent.alias || currentAgent.name,
          role: currentAgent.role,
        },
        to: {
          id: toAgent._id,
          name: toAgent.alias || toAgent.name,
          role: toAgent.role,
        },
        reason,
        query,
      });

      // Send transfer request to target agent's personal room
      const targetRoom = `user:${toAgentId}`;
      queryNamespace.to(targetRoom).emit('transfer-request', {
        petitionId,
        from: {
          id: currentAgent._id,
          name: currentAgent.alias || currentAgent.name,
          role: currentAgent.role,
        },
        to: {
          id: toAgent._id,
          name: toAgent.alias || toAgent.name,
          role: toAgent.role,
        },
        reason,
        query,
      });

      console.log('📡 Emitted transfer-request to room:', targetRoom, 'for petition:', petitionId);
      console.log('📡 Target agent:', toAgent.name, 'ID:', toAgentId);

      // Notify customer widget about transfer with a system message
      // Widget notification: hide transfer reason and role for customers
      const widgetPayload = {
        message: `Your query has been escalated and will be assisted shortly.`,
        senderName: 'System',
        senderRole: 'System',
        timestamp: new Date(),
        sender: 'system',
      };
      io.of('/widget').to(petitionId).emit('new-message', widgetPayload);
    }

    res.status(200).json({
      status: true,
      message: 'Transfer request submitted successfully',
      data: query,
    });
  } catch (error) {
    console.error('Transfer Query Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to transfer query',
      error: error.message,
    });
  }
};

// Resolve query
exports.resolveQuery = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { petitionId } = req.params;

    const agent = await User.findById(agentId);
    if (!agent) {
      return res.status(404).json({ status: false, message: 'Agent not found' });
    }

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    if (query.assignedTo.toString() !== agentId) {
      return res.status(403).json({ status: false, message: 'You are not assigned to this query' });
    }

    query.status = 'Resolved';
    query.resolvedAt = new Date();
    query.resolvedBy = agentId;
    query.resolvedByName = agent.alias || agent.name;
    query.isActive = false;

    // Add system message
    query.messages.push({
      sender: agentId,
      senderName: 'System',
      senderRole: 'System',
      message: `Query resolved by ${agent.alias || agent.name}`,
    });

    // ✅ Check if agent has any other active queries
    const activeQueriesCount = await Query.countDocuments({
      assignedTo: agentId,
      status: { $in: ['Accepted', 'In Progress'] },
      petitionId: { $ne: petitionId }, // Exclude current query
    });

    // ========== ACCUMULATE BUSY TIME BEFORE GOING BACK TO ACTIVE ==========
    // Only set to active if no other queries are being handled
    if (activeQueriesCount === 0) {
      // If agent was busy, accumulate time before switching to active
      if (agent.workStatus === 'busy' && agent.lastStatusChangeTime) {
        const now = new Date();
        const busyDuration = (now - new Date(agent.lastStatusChangeTime)) / 1000 / 60;
        agent.accumulatedActiveTime =
          (agent.accumulatedActiveTime || 0) + Math.max(0, busyDuration);
        console.log(
          `✅ Accumulated ${Math.floor(busyDuration)}min of busy time. Total: ${Math.floor(
            agent.accumulatedActiveTime
          )}min`
        );
      }

      agent.workStatus = 'active';
      agent.lastStatusChangeTime = new Date(); // Reset for new active session
      await agent.save({ validateModifiedOnly: true });
      console.log(`✅ Agent ${agent.name} status updated to ACTIVE (No other active queries)`);
    } else {
      console.log(
        `ℹ️ Agent ${agent.name} remains BUSY (Has ${activeQueriesCount} other active queries)`
      );
    }

    await query.save();

    // Emit socket event to notify widget
    const io = req.app.get('io');
    if (io) {
      // Notify /query namespace
      io.of('/query')
        .to(petitionId)
        .emit('query-resolved', {
          petitionId,
          resolvedBy: { id: agent._id, name: agent.alias || agent.name },
          query,
        });

      // Notify /widget namespace (for customer)
      io.of('/widget')
        .to(petitionId)
        .emit('query-resolved', {
          petitionId,
          resolvedBy: { id: agent._id, name: agent.alias || agent.name },
          status: 'Resolved',
        });

      console.log(`📡 Emitted query-resolved to both namespaces for petition ${petitionId}`);
    }

    res.status(200).json({
      status: true,
      message: 'Query resolved successfully',
      data: query,
    });
  } catch (error) {
    console.error('Resolve Query Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to resolve query',
      error: error.message,
    });
  }
};

// Submit feedback (Customer)
exports.submitFeedback = async (req, res) => {
  try {
    const customerId = req.user?.id;
    const { petitionId } = req.params;
    const { rating, comment } = req.body;

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    if (query.customer.toString() !== customerId) {
      return res.status(403).json({ status: false, message: 'Not authorized' });
    }

    if (query.status !== 'Resolved') {
      return res.status(400).json({
        status: false,
        message: 'Query must be resolved before submitting feedback',
      });
    }

    query.feedback = {
      rating,
      comment,
      submittedAt: new Date(),
    };

    await query.save();

    res.status(200).json({
      status: true,
      message: 'Feedback submitted successfully',
      data: query,
    });
  } catch (error) {
    console.error('Submit Feedback Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to submit feedback',
      error: error.message,
    });
  }
};

// Get available recipients (for transfer)
// Updated policy: recipients can be Agent or QA
exports.getAvailableAgents = async (req, res) => {
  try {
    const { category } = req.query;
    const requesterId = req.user?.id;
    const requester = requesterId ? await User.findById(requesterId) : null;

    const filter = {
      role: { $in: ['Agent', 'QA'] },
      workStatus: { $in: ['active', 'offline'] },
    };

    if (category) {
      filter.department = category;
    }

    // ✅ Restrict to same organization as requester
    if (requester?.organizationId) {
      filter.organizationId = requester.organizationId;
    }

    const agents = await User.find(filter)
      .select('name email role department workStatus profileImage')
      .sort({ workStatus: 1, name: 1 });

    res.status(200).json({
      status: true,
      data: agents,
    });
  } catch (error) {
    console.error('Get Available Agents Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch agents',
      error: error.message,
    });
  }
};

// Auto-expire old queries (cron job function)
exports.expireOldQueries = async () => {
  try {
    const now = new Date();

    const result = await Query.updateMany(
      {
        status: { $in: ['Pending', 'Accepted', 'In Progress'] },
        expiresAt: { $lt: now },
      },
      {
        $set: {
          status: 'Expired',
          isActive: false,
        },
      }
    );

    console.log(`Expired ${result.modifiedCount} queries`);
    return result;
  } catch (error) {
    console.error('Expire Queries Error:', error);
    throw error;
  }
};

/**
 * Handle GDPR Data Retention (Automatic Cleanup)
 * Retention logic: 6/12/24 months based on compliance.dataRetentionTimer
 */
exports.handleGdprDataRetention = async () => {
  try {
    const now = new Date();

    // Find customers whose data retention period has passed
    // We'll mask/anonymize data instead of hard deletion to maintain reporting integrity
    const customersToAnonymize = await User.find({
      role: 'Customer',
      lastUpdatedDate: { $lt: moment().subtract(6, 'months').toDate() } // Default 6 months check
    });

    let count = 0;
    for (const customer of customersToAnonymize) {
      const retentionMonths = customer.dataRetentionTimer || 6;
      const expiryDate = moment(customer.lastUpdatedDate).add(retentionMonths, 'months').toDate();

      if (expiryDate < now) {
        // Anonymize personal info
        customer.name = 'GDPR Anonymized';
        customer.email = `anonymized_${customer._id}@fmcg-support.uk`;
        customer.mobile = '+440000000000';
        customer.address = { street: 'Anonymized', city: 'Anonymized' };
        customer.isBlocked = true;
        customer.blockedReason = 'GDPR Data Retention Expired';
        await customer.save();
        count++;
      }
    }

    console.log(`GDPR Cleanup: Anonymized ${count} customer records.`);
    return count;
  } catch (error) {
    console.error('GDPR Retention Error:', error);
    throw error;
  }
};

// Reopen expired or resolved query
exports.reopenQuery = async (req, res) => {
  try {
    const customerId = req.user?.id;
    const { petitionId } = req.params;
    const { message } = req.body;

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    if (query.customer.toString() !== customerId) {
      return res.status(403).json({ status: false, message: 'Not authorized' });
    }

    if (!['Resolved', 'Expired'].includes(query.status)) {
      return res.status(400).json({
        status: false,
        message: 'Only resolved or expired queries can be reopened',
      });
    }

    const customer = await User.findById(customerId);

    query.status = 'Pending';
    query.isActive = true;
    query.assignedTo = null;
    query.assignedToName = null;
    query.assignedToRole = null;
    query.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Add reopen message
    if (message) {
      query.messages.push({
        sender: customerId,
        senderName: customer.name,
        senderRole: 'Customer',
        message,
      });
    }

    query.messages.push({
      sender: customerId,
      senderName: 'System',
      senderRole: 'System',
      message: 'Query has been reopened by customer',
    });

    await query.save();

    res.status(200).json({
      status: true,
      message: 'Query reopened successfully',
      data: query,
    });
  } catch (error) {
    console.error('Reopen Query Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to reopen query',
      error: error.message,
    });
  }
};

// Update Query Details (Agent/Admin) - e.g. Link PNR, Change Category
exports.updateQueryDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { petitionId } = req.params;
    const {
      category,
      subCategory,
      priority,
      bookingId,
      subject,
      concernDescription,
      status,
      // FMCG Fields
      severityLevel,
      healthAndSafetyRisk,
      regulatoryRiskFlag,
      escalationRequired,
      productInfo,
      interactionMetrics,
      escalationDetails,
      compliance,
      refundAmount,
      remarks,
      tatShared
    } = req.body;

    // Check authorization
    if (!['Agent', 'QA', 'TL', 'Admin', 'SuperAdmin'].includes(userRole)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Update Basic Fields
    if (category) query.category = category;
    if (subCategory !== undefined) query.subCategory = subCategory;
    if (priority) query.priority = priority;
    if (subject) query.subject = subject;
    if (concernDescription !== undefined) query.concernDescription = concernDescription;
    if (remarks !== undefined) query.remarks = remarks;
    if (tatShared !== undefined) query.tatShared = tatShared;
    if (refundAmount !== undefined) query.refundAmount = refundAmount;

    // FMCG Specific Logic
    if (severityLevel) query.severityLevel = severityLevel;
    if (healthAndSafetyRisk !== undefined) query.healthAndSafetyRisk = healthAndSafetyRisk;
    if (regulatoryRiskFlag !== undefined) query.regulatoryRiskFlag = regulatoryRiskFlag;
    if (escalationRequired !== undefined) query.escalationRequired = escalationRequired;

    // Nested Objects Update (Merging)
    if (productInfo) {
      query.productInfo = { ...query.productInfo, ...productInfo };
    }
    if (interactionMetrics) {
      query.interactionMetrics = { ...query.interactionMetrics, ...interactionMetrics };
    }
    if (escalationDetails) {
      query.escalationDetails = { ...query.escalationDetails, ...escalationDetails };
    }
    if (compliance) {
      query.compliance = { ...query.compliance, ...compliance };
    }

    // ==================== REFUND APPROVAL WORKFLOW ====================
    if (refundAmount !== undefined) {
      const org = await Organization.findById(query.organizationId);
      const threshold = org?.fmcgSettings?.refundThreshold || 50;

      if (refundAmount > threshold) {
        if (!query.compliance) query.compliance = {};
        query.compliance.tlApprovalStatus = 'Pending';
        query.status = 'Pending Internal'; // Move to pending internal for approval
        query.autoTags.push('High Refund - TL Approval Req');
      }
    }

    // Status management
    if (status && ['Pending', 'Accepted', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Transferred', 'Pending Customer', 'Pending Internal', 'Escalated'].includes(status)) {
      query.status = status;
    }

    // Handle Booking Linking (Legacy)
    if (bookingId) {
      const booking = await Booking.findById(bookingId);
      if (booking) {
        query.bookingId = booking._id;
      }
    }

    await query.save();

    res.status(200).json({
      status: true,
      message: 'Query details updated successfully',
      data: query
    });

  } catch (error) {
    console.error('Update Query Details Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update query details',
      error: error.message
    });
  }
};

// Delete a query by petitionId
exports.deleteQuery = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { petitionId } = req.params;

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Authorization: Customers can delete their own queries; Agents/QA/Admin can delete any
    const isOwner = String(query.customer) === String(userId);
    const isPrivileged = ['Agent', 'QA', 'Admin'].includes(userRole);
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({
        status: false,
        message: 'Not authorized to delete this query',
      });
    }

    await Query.deleteOne({ _id: query._id });

    return res.status(200).json({
      status: true,
      message: 'Query deleted successfully',
      data: { petitionId },
    });
  } catch (error) {
    console.error('Delete Query Error:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to delete query',
      error: error.message,
    });
  }
};
