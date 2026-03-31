const Query = require('../models/Query');
const Staff = require('../models/Staff');
const Customer = require('../models/Customer');
const QueryEvaluation = require('../models/QueryEvaluation');
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

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatEscalationChainForReport(transferHistory = []) {
  if (!Array.isArray(transferHistory) || transferHistory.length === 0) return '';
  return transferHistory
    .map((t) => {
      const fromRole = t?.fromAgent?.role ? ` (${t.fromAgent.role})` : '';
      const toRole = t?.toAgent?.role ? ` (${t.toAgent.role})` : '';
      const fromName = t?.fromAgentName || t?.fromAgent?.name || 'Unknown';
      const toName = t?.toAgentName || t?.toAgent?.name || 'Unknown';
      return `${fromName}${fromRole} -> ${toName}${toRole}`;
    })
    .join(' | ');
}

function formatEscalationReasonsForReport(transferHistory = []) {
  if (!Array.isArray(transferHistory) || transferHistory.length === 0) return '';
  return transferHistory
    .map((t, idx) => `Step ${idx + 1}: ${t?.reason || 'N/A'}`)
    .join(' | ');
}

function normalizeReportView(view = 'all') {
  const v = String(view || 'all').toLowerCase();
  if (v === 'pending') return 'pending';
  if (v === 'inprogress' || v === 'in_progress' || v === 'in progress' || v === 'on') return 'inprogress';
  if (v === 'my' || v === 'myqueries' || v === 'my_queries' || v === 'my query') return 'my';
  if (v === 'resolved') return 'resolved';
  if (v === 'escalated') return 'escalated';
  return 'all';
}

// Create a new query (Customer)
exports.createQuery = async (req, res) => {
  try {
    const customerId = req.user?.id;
    const { subject, category, priority, initialMessage } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    const petitionId = generatePetition();

    const newQuery = await Query.create({
      petitionId,
      customer: customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      organizationId: customer.organizationId, // ✅ Add organization isolation
      subject,
      category: category || 'Supports',
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
      const availableUsers = await Staff.find({
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
          `🔍 Checking socket: ${
            socket.id
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
    const {
      status,
      category,
      priority,
      assignedTo,
      transferTarget,
      view,
      page,
      limit,
      sort,
      date,
      fromDate,
      toDate,
      petitionId,
    } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (petitionId) {
      filter.petitionId = {
        $regex: `^${String(petitionId).trim()}$`,
        $options: 'i',
      };
    }

    // Date-wise filtering (IST)
    if (date) {
      const start = moment.tz(date, 'Asia/Kolkata').startOf('day');
      const end = start.clone().endOf('day');
      if (start.isValid()) {
        filter.createdAt = { $gte: start.toDate(), $lte: end.toDate() };
      }
    } else if (fromDate || toDate) {
      const range = {};
      if (fromDate) {
        const start = moment.tz(fromDate, 'Asia/Kolkata').startOf('day');
        if (start.isValid()) range.$gte = start.toDate();
      }
      if (toDate) {
        const end = moment.tz(toDate, 'Asia/Kolkata').endOf('day');
        if (end.isValid()) range.$lte = end.toDate();
      }
      if (Object.keys(range).length) filter.createdAt = range;
    }

    // Multi-tenancy scoping (unless SuperAdmin)
    if (req.user?.role !== 'SuperAdmin' && req.user?.organizationId) {
      filter.organizationId = req.user.organizationId;
    }

    // ==================== TIER-BASED LIST VISIBILITY ====================
    // Dev-escalated queries remain visible in list views for all roles.
    // Chat/content access control is enforced in detail and message handlers.
    const userRole = req.user?.role;
    const isAdminRole = ['Admin', 'SuperAdmin'].includes(userRole);
    const isDevRole = userRole === 'Dev';

    const countsFilter = { ...filter };
    const listFilter = { ...filter };

    if (view) {
      const normalizedView = String(view).toLowerCase();
      if (normalizedView === 'pending') {
        listFilter.status = 'Pending';
      } else if (normalizedView === 'inprogress' || normalizedView === 'in_progress') {
        listFilter.status = { $in: ['Accepted', 'In Progress'] };
      } else if (normalizedView === 'resolved') {
        listFilter.status = 'Resolved';
      } else if (normalizedView === 'my' && req.user?.id) {
        listFilter.$or = [
          { resolvedBy: req.user.id, status: 'Resolved' },
          { assignedTo: req.user.id, status: { $in: ['Accepted', 'In Progress'] } },
        ];
      } else if (normalizedView === 'escalated' && req.user?.id) {
        listFilter.$or = [
          { 'transferHistory.fromAgent': req.user.id },
          { 'transferHistory.toAgent': req.user.id },
        ];
      }
    }

    // Build base Mongoose query
    const baseQuery = Query.find(listFilter)
      .select('-messages')
      .populate('customer', 'name email mobile profileImage')
      .populate('assignedTo', 'name email role department workStatus alias tier')
      .lean();

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
      } catch (_) {}
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
      total = await Query.countDocuments(listFilter);
      queries = await baseQuery.skip((pageNum - 1) * pageSize).limit(pageSize);
    } else {
      queries = await baseQuery;
      total = queries.length;
    }

    // Fetch evaluations for the retrieved queries
    const petitionIds = queries.map((q) => q.petitionId);
    const evaluations = await QueryEvaluation.find({
      petitionId: { $in: petitionIds },
    }).lean();
    const evalByPetitionId = new Map(evaluations.map((e) => [e.petitionId, e]));

    // Tier-based message stripping for list view
    const userTier = req.user?.tier;
    // userRole and isAdminRole already declared above for dev escalation filtering
    const isAdminOrSuperAdmin = isAdminRole; // Reuse isAdminRole from above
    const tierOrder = { 'Tier-1': 1, 'Tier-2': 2, 'Tier-3': 3 };
    const userTierNum = tierOrder[userTier] || 0;

    // Attach evaluation to each query and strip messages for tier-blocked queries
    queries = queries.map((q) => {
      const qObj = q;
      const evaluation = evalByPetitionId.get(q.petitionId);
      const result = { ...qObj, evaluation: evaluation || null };

      // Dev-escalated query chat is readable only by Tier-3 Dev roles.
      if (qObj.escalatedToDev && !isDevRole) {
        result.messages = [];
        result._tierBlocked = true;
        result._devEscalated = true;
        result._tierBlockMessage = `This query has been escalated to Dev team. Only Tier-3 Dev agents can read the chat.`;
        return result;
      }

      // Strip messages if query is escalated to a higher tier than the requesting user
      const escalatedTierNum = tierOrder[qObj.escalatedToTier] || 0;
      if (!isAdminOrSuperAdmin && userTierNum > 0 && escalatedTierNum > userTierNum) {
        result.messages = [];
        result._tierBlocked = true;
        result._tierBlockMessage = `This query has been escalated to ${qObj.escalatedToTier}. Messages are restricted.`;
      }

      return result;
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
      const [allCount, pendingCount, acceptedCount, resolvedCount, transferredCount, myQueriesCount] = await Promise.all([
        Query.countDocuments(countsFilter),
        Query.countDocuments({ ...countsFilter, status: 'Pending' }),
        Query.countDocuments({
          ...countsFilter,
          status: { $in: ['Accepted', 'In Progress'] },
        }),
        Query.countDocuments({ ...countsFilter, status: 'Resolved' }),
        Query.countDocuments({ ...countsFilter, status: 'Transferred' }),
        userId
          ? Query.countDocuments({
              ...countsFilter,
              $or: [
                { resolvedBy: userId, status: 'Resolved' },
                { assignedTo: userId, status: { $in: ['Accepted', 'In Progress'] } },
              ],
            })
          : Promise.resolve(0),
      ]);
      
      // Calculate escalated count: queries where user is either fromAgent OR toAgent
      let escalatedCount = 0;
      if (userId) {
        escalatedCount = await Query.countDocuments({
          ...countsFilter,
          $or: [
            { 'transferHistory.fromAgent': userId },
            { 'transferHistory.toAgent': userId },
          ],
        });
      }
      
      overallCounts = {
        total: allCount,
        pending: pendingCount,
        inProgress: acceptedCount,
        accepted: acceptedCount,
        myQueries: myQueriesCount,
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
        inProgress: accepted.length,
        accepted: accepted.length,
        myQueries: queries.filter((q) => {
          const resolvedById =
            typeof q.resolvedBy === 'object' ? q.resolvedBy?._id?.toString?.() : q.resolvedBy?.toString?.();
          const assignedToId =
            typeof q.assignedTo === 'object' ? q.assignedTo?._id?.toString?.() : q.assignedTo?.toString?.();
          const me = userId?.toString?.() || String(userId || '');
          const isResolvedByMe = q.status === 'Resolved' && resolvedById === me;
          const isAssignedToMe =
            ['Accepted', 'In Progress'].includes(q.status) && assignedToId === me;
          return isResolvedByMe || isAssignedToMe;
        }).length,
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
        inProgress: accepted.length,
        accepted: accepted.length,
        myQueries: queries.filter((q) => {
          const resolvedById =
            typeof q.resolvedBy === 'object' ? q.resolvedBy?._id?.toString?.() : q.resolvedBy?.toString?.();
          const assignedToId =
            typeof q.assignedTo === 'object' ? q.assignedTo?._id?.toString?.() : q.assignedTo?.toString?.();
          const me = userId?.toString?.() || String(userId || '');
          const isResolvedByMe = q.status === 'Resolved' && resolvedById === me;
          const isAssignedToMe =
            ['Accepted', 'In Progress'].includes(q.status) && assignedToId === me;
          return isResolvedByMe || isAssignedToMe;
        }).length,
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

// Download day-wise query list report with optional view/status filters and dev remark columns
exports.downloadQueryListReport = async (req, res) => {
  try {
    const role = req.user?.role;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    const allowedRoles = ['QA', 'TL', 'Management', 'Admin', 'SuperAdmin', 'Dev', 'Aggregator'];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        status: false,
        message: 'You are not allowed to download query reports',
      });
    }

    const { date, fromDate, toDate, view = 'all', category, priority, path = 'all' } = req.query;
    const normalizedView = normalizeReportView(view);
    const filter = {};

    if (role !== 'SuperAdmin' && organizationId) {
      filter.organizationId = organizationId;
    }

    if (category && category !== 'all') filter.category = category;
    if (priority && priority !== 'all') filter.priority = priority;

    // Path-based fast-fail DB queries
    if (path === 'tier1_only') {
      filter.status = 'Resolved';
      filter.$or = [
        { transferHistory: { $size: 0 } },
        { transferHistory: { $exists: false } }
      ];
    }

    // Date-wise filtering on createdAt (IST)
    if (date) {
      const start = moment.tz(date, 'Asia/Kolkata').startOf('day');
      const end = start.clone().endOf('day');
      if (start.isValid()) {
        filter.createdAt = { $gte: start.toDate(), $lte: end.toDate() };
      }
    } else if (fromDate || toDate) {
      const range = {};
      if (fromDate) {
        const start = moment.tz(fromDate, 'Asia/Kolkata').startOf('day');
        if (start.isValid()) range.$gte = start.toDate();
      }
      if (toDate) {
        const end = moment.tz(toDate, 'Asia/Kolkata').endOf('day');
        if (end.isValid()) range.$lte = end.toDate();
      }
      if (Object.keys(range).length) filter.createdAt = range;
    }

    // View-based filters
    if (normalizedView === 'pending') {
      filter.status = 'Pending';
    } else if (normalizedView === 'inprogress') {
      filter.status = { $in: ['Accepted', 'In Progress'] };
    } else if (normalizedView === 'resolved') {
      filter.status = 'Resolved';
    } else if (normalizedView === 'escalated') {
      filter['transferHistory.0'] = { $exists: true };
    } else if (normalizedView === 'my') {
      filter.$or = [{ assignedTo: userId }, { resolvedBy: userId }];
    }

    let queries = await Query.find(filter)
      .populate('assignedTo', 'name alias role')
      .populate('resolvedBy', 'name alias role')
      .populate('transferHistory.fromAgent', 'name role')
      .populate('transferHistory.toAgent', 'name role')
      .populate('devResolutionRemark.by', 'name alias role')
      .sort({ createdAt: -1 });

    // For escalated view in my tab semantics: ensure user is involved in chain
    if (normalizedView === 'escalated' && userId) {
      // keep escalated broad by default for Admin/QA/TL/Management per request
      // no extra filtering
    }

    const header = [
      'Petition ID',
      'Created Date',
      'Created Time',
      'Customer Name',
      'Customer Email',
      'Subject',
      'Category',
      'Priority',
      'Current Status',
      'Assigned To',
      'Assigned Role',
      'Resolved By',
      'Resolved At',
      'Escalated',
      'Total Escalations',
      'Escalation Chain',
      'Escalation Reasons',
      'Dev Remark',
      'Dev Remark By',
      'Dev Remark At',
    ];

    const rows = queries.map((q) => {
      const createdAt = q.createdAt ? moment(q.createdAt).tz('Asia/Kolkata') : null;
      const resolvedAt = q.resolvedAt ? moment(q.resolvedAt).tz('Asia/Kolkata') : null;
      const devRemarkAt = q.devResolutionRemark?.updatedAt
        ? moment(q.devResolutionRemark.updatedAt).tz('Asia/Kolkata')
        : null;

      const assignedName = q.assignedToName || q.assignedTo?.alias || q.assignedTo?.name || '';
      const assignedRole = q.assignedToRole || q.assignedTo?.role || '';
      const resolvedByName = q.resolvedByName || q.resolvedBy?.alias || q.resolvedBy?.name || '';
      const devRemarkBy =
        q.devResolutionRemark?.byName ||
        q.devResolutionRemark?.by?.alias ||
        q.devResolutionRemark?.by?.name ||
        '';

      return [
        q.petitionId || '',
        createdAt ? createdAt.format('YYYY-MM-DD') : '',
        createdAt ? createdAt.format('hh:mm A') : '',
        q.customerName || '',
        q.customerEmail || '',
        q.subject || '',
        q.category || '',
        q.priority || '',
        q.status || '',
        assignedName,
        assignedRole,
        resolvedByName,
        resolvedAt ? resolvedAt.toISOString() : '',
        Array.isArray(q.transferHistory) && q.transferHistory.length > 0 ? 'Yes' : 'No',
        Array.isArray(q.transferHistory) ? q.transferHistory.length : 0,
        formatEscalationChainForReport(q.transferHistory),
        formatEscalationReasonsForReport(q.transferHistory),
        q.devResolutionRemark?.message || '',
        devRemarkBy,
        devRemarkAt ? devRemarkAt.toISOString() : '',
      ];
    });

    const csv = [header, ...rows]
      .map((line) => line.map((cell) => csvEscape(cell)).join(','))
      .join('\n');

    const stamp = date || new Date().toISOString().slice(0, 10);
    const filename = `query-list-${normalizedView}-${stamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Download Query List Report Error:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to download query list report',
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
      .populate('assignedTo', 'name email role department workStatus profileImage alias tier')
      .populate('messages.sender', 'name email role profileImage');

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // ==================== TIER-BASED READ BLOCKING ====================
    const userTier = req.user?.tier;
    const userRole = req.user?.role;
    const isAdminOrSuperAdmin = ['Admin', 'SuperAdmin'].includes(userRole);
    const isDevRole = userRole === 'Dev';
    const tierOrder = { 'Tier-1': 1, 'Tier-2': 2, 'Tier-3': 3 };
    const userTierNum = tierOrder[userTier] || 0;
    const escalatedTierNum = tierOrder[query.escalatedToTier] || 0;

    // ==================== DEV ESCALATION BLOCKING ====================
    // If query is escalated to Dev, only Tier-3 Dev role can access full chat.
    if (query.escalatedToDev && !isDevRole) {
      const queryObj = query.toObject();
      delete queryObj.messages;
      return res.status(200).json({
        status: true,
        data: {
          ...queryObj,
          messages: [
            {
              senderName: 'System',
              senderRole: 'System',
              message: 'Escalated to dev and query will be resolved in 24 to 48 hours.',
              timestamp: query.escalatedAt || query.updatedAt,
              isRead: true,
            },
          ],
          _tierBlocked: true,
          _devEscalated: true,
          _tierBlockMessage: `This query has been escalated to Dev team. Only Tier-3 Dev agents can access the full details.`,
        },
      });
    }

    // Lower tiers cannot read queries escalated to higher tiers (e.g., T1->T2, T2->T3).
    // Query metadata (status, petitionId, category, etc.) remains visible but messages are stripped.
    if (!isAdminOrSuperAdmin && userTierNum > 0 && escalatedTierNum > userTierNum) {
      const queryObj = query.toObject();
      delete queryObj.messages;
      return res.status(200).json({
        status: true,
        data: {
          ...queryObj,
          messages: [],
          _tierBlocked: true,
          _tierBlockMessage: `This query has been escalated to ${query.escalatedToTier}. Only that tier and above can read it.`,
        },
      });
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
        devResolutionRemark: query.devResolutionRemark || null,
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
      devResolutionRemark: q.devResolutionRemark || null,
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

    const agent = await Staff.findById(agentId);
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
        message: `Transfer from ${latestTransferMsg.fromAgentName} accepted by ${
          agent.alias || agent.name
        }`,
      });
    } else if (latestTransferMsg && latestTransferMsg.status === 'Accepted') {
      query.messages.push({
        sender: agentId,
        senderName: 'System',
        senderRole: 'System',
        message: `Transferred by ${latestTransferMsg.fromAgentName}; now handled by ${
          agent.alias || agent.name
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

    // Try User (agent/admin) first, then Customer
    let user = await Staff.findById(userId);
    let isCustomerUser = false;
    if (!user) {
      user = await Customer.findById(userId);
      isCustomerUser = true;
    }
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

    // On Dev escalation, only Tier-3 Dev can message.
    if (query.escalatedToDev) {
      const isDevRole = !isCustomerUser && user.role === 'Dev';
      if (!isDevRole) {
        return res.status(403).json({
          status: false,
          message: 'This query has been escalated to Dev team. Only Tier-3 Dev agents can reply to it.',
        });
      }
    }

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
      senderRole: isCustomerUser ? 'Customer' : user.role,
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
      if (!isCustomerUser) {
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

    const currentAgent = await Staff.findById(currentAgentId);
    const toAgent = await Staff.findById(toAgentId);

    if (!currentAgent || !toAgent) {
      return res.status(404).json({ status: false, message: 'Agent not found' });
    }

    // Escalation policy:
    // Tier-1 (Agents): Can only escalate to QA/TL (Tier-2). Cannot transfer to other Agents.
    // Tier-2 (QA/TL): Can escalate to Dev (Tier-3) or de-escalate back to Agents (Tier-1).
    // Tier-3 (Dev): Cannot initiate transfers.
    const allowedInitiators = ['Agent', 'QA', 'TL'];
    const allowedRecipients = ['Agent', 'QA', 'TL', 'Dev'];
    const tierOrder = { 'Tier-1': 1, 'Tier-2': 2, 'Tier-3': 3 };
    const currentTierNum = tierOrder[currentAgent.tier] || 1;
    const toTierNum = tierOrder[toAgent.tier] || 1;
    const isQaOrTl = ['QA', 'TL'].includes(currentAgent.role);
    const isAgent = currentAgent.role === 'Agent';

    if (!allowedInitiators.includes(currentAgent.role)) {
      return res.status(403).json({
        status: false,
        message: 'Only Agent, QA, or TL can initiate transfers',
      });
    }

    if (!allowedRecipients.includes(toAgent.role)) {
      return res.status(400).json({
        status: false,
        message: 'Query can only be transferred to an Agent, QA, TL, or Dev',
      });
    }

    // Agents can only escalate to QA/TL, not to other Agents or Dev
    if (isAgent && toAgent.role === 'Agent') {
      return res.status(403).json({
        status: false,
        message: 'Agents cannot transfer to other Agents. Escalate to QA or TL instead.',
      });
    }
    if (isAgent && toAgent.role === 'Dev') {
      return res.status(403).json({
        status: false,
        message: 'Agents cannot escalate directly to Dev. Escalate to QA or TL first.',
      });
    }

    // Only QA/TL can escalate to Tier-3 (Dev)
    if (toTierNum === 3 && !isQaOrTl) {
      return res.status(403).json({
        status: false,
        message: 'Only QA and TL can escalate to Dev (Tier-3)',
      });
    }

    // Tier-2 (QA/TL) can only move to Tier-1 Agent or Tier-3 Dev (no lateral Tier-2 transfer).
    if (isQaOrTl && ['QA', 'TL'].includes(toAgent.role)) {
      return res.status(403).json({
        status: false,
        message: 'QA and TL can only transfer to Tier-1 Agents or escalate to Tier-3 Dev.',
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
    // Skip busy check when escalating to a higher tier (e.g., Tier-1 → Tier-2/3)
    const isHigherTierEscalation = toTierNum > currentTierNum;

    if (!isHigherTierEscalation) {
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
    } else {
      console.log(`✅ Skipping busy check for higher-tier escalation: ${currentAgent.tier} → ${toAgent.tier}`);
    }

    // Allow transfer to agents who are active, offline, or on break
    // Skip offline/break check when escalating to a higher tier (e.g., Tier-1 → Tier-2/3)
    if (!isHigherTierEscalation && toAgent.workStatus === 'offline') {
      return res.status(400).json({
        status: false,
        message: `Target employee (${toAgent.name}) is currently offline.`,
      });
    }

    if (!isHigherTierEscalation && toAgent.workStatus === 'break') {
      return res.status(400).json({
        status: false,
        message: `Target employee (${toAgent.name}) is currently on break.`,
      });
    }

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // ==================== DEV ESCALATION BLOCKING FOR TRANSFERS ====================
    // If query is escalated to Dev, only Tier-3 Dev can transfer/reassign it.
    if (query.escalatedToDev) {
      const userRole = currentAgent.role;
      const isDevRole = userRole === 'Dev';

      if (!isDevRole) {
        return res.status(403).json({
          status: false,
          message: 'This query has been escalated to Dev team. Only Tier-3 Dev agents can re-assign it.',
        });
      }
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

    // ==================== TIER-BASED ESCALATION TRACKING ====================
    // Determine tier numbers for comparison
    const fromTierNum = tierOrder[currentAgent.tier] || 0;

    // Track escalation: escalatedToDev is true ONLY for Tier-3 (Dev)
    if (toTierNum > fromTierNum && toTierNum >= 2) {
      query.escalatedToTier = toAgent.tier;
      query.escalatedToDev = toTierNum === 3;
      query.escalatedAt = new Date();
      query.escalatedFromTier = currentAgent.tier || 'Tier-1';
    } else if (toAgent.tier && tierOrder[toAgent.tier] >= 2) {
      // Lateral transfer within Tier-2/3 keeps tier tracking
      query.escalatedToTier = toAgent.tier;
      query.escalatedToDev = tierOrder[toAgent.tier] === 3;
      if (!query.escalatedAt) query.escalatedAt = new Date();
      if (!query.escalatedFromTier) query.escalatedFromTier = currentAgent.tier || 'Tier-1';
    }

    // Add system message indicating transfer
    // Customer-facing system message: DO NOT include transfer reason or role
    const isDevEscalation = toAgent.role === 'Dev' || toTierNum === 3;
    query.messages.push({
      sender: currentAgentId,
      senderName: 'System',
      senderRole: 'System',
      message: isDevEscalation
        ? `Escalated to Dev role - Your query will be resolved by the Dev team within 24 to 48 hours.`
        : `Your query has been escalated and will be assisted shortly.`,
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
        message: isDevEscalation
          ? `Escalated to Dev role - Your query will be resolved by the Dev team within 24 to 48 hours.`
          : `Your query has been escalated and will be assisted shortly.`,
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
    const { devRemark } = req.body || {};

    const agent = await Staff.findById(agentId);
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

    const remarkText = typeof devRemark === 'string' ? devRemark.trim() : '';
    if (remarkText) {
      if (agent.role !== 'Dev') {
        return res.status(403).json({
          status: false,
          message: 'Only Dev users can add a dev resolution remark',
        });
      }
      query.devResolutionRemark = {
        message: remarkText,
        by: agentId,
        byName: agent.alias || agent.name,
        createdAt: query.devResolutionRemark?.createdAt || new Date(),
        updatedAt: new Date(),
      };
    }

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

// Add or update dev resolution remark after query resolution
exports.addOrUpdateDevRemark = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { petitionId } = req.params;
    const remark = (req.body?.remark || '').trim();

    if (!remark) {
      return res.status(400).json({
        status: false,
        message: 'Remark is required',
      });
    }

    if (userRole !== 'Dev') {
      return res.status(403).json({
        status: false,
        message: 'Only Dev users can add resolution remarks',
      });
    }

    const query = await Query.findOne({ petitionId });
    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    if (!query.escalatedToDev) {
      return res.status(400).json({
        status: false,
        message: 'Dev remark can only be added for Dev-escalated queries',
      });
    }

    if (query.status !== 'Resolved') {
      return res.status(400).json({
        status: false,
        message: 'Dev remark can be added only after query is resolved',
      });
    }

    const hasAuthority =
      (query.resolvedBy && query.resolvedBy.toString() === userId) ||
      (query.assignedTo && query.assignedTo.toString() === userId);

    if (!hasAuthority) {
      return res.status(403).json({
        status: false,
        message: 'You are not allowed to add remark on this query',
      });
    }

    const devUser = await Staff.findById(userId).select('name alias role');
    const devName = devUser?.alias || devUser?.name || req.user?.name || 'Dev';

    query.devResolutionRemark = {
      message: remark,
      by: userId,
      byName: devName,
      createdAt: query.devResolutionRemark?.createdAt || new Date(),
      updatedAt: new Date(),
    };

    await query.save();

    res.status(200).json({
      status: true,
      message: 'Dev remark saved successfully',
      data: {
        petitionId: query.petitionId,
        devResolutionRemark: query.devResolutionRemark,
      },
    });
  } catch (error) {
    console.error('Add/Update Dev Remark Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to save dev remark',
      error: error.message,
    });
  }
};

// Download escalation report with dev remarks (QA/TL/Management/Admin/Dev)
exports.downloadEscalationRemarksReport = async (req, res) => {
  try {
    const role = req.user?.role;
    const organizationId = req.user?.organizationId;
    const allowedRoles = ['QA', 'TL', 'Management', 'Admin', 'SuperAdmin', 'Dev', 'Aggregator'];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        status: false,
        message: 'You are not allowed to download escalation reports',
      });
    }

    const { date, fromDate, toDate, path = 'all' } = req.query;

    const filter = {
      'transferHistory.0': { $exists: true },
    };

    if (role !== 'SuperAdmin' && organizationId) {
      filter.organizationId = organizationId;
    }

    // Date-wise filtering on createdAt (IST)
    if (date) {
      const start = moment.tz(date, 'Asia/Kolkata').startOf('day');
      const end = start.clone().endOf('day');
      if (start.isValid()) {
        filter.createdAt = { $gte: start.toDate(), $lte: end.toDate() };
      }
    } else if (fromDate || toDate) {
      const range = {};
      if (fromDate) {
        const start = moment.tz(fromDate, 'Asia/Kolkata').startOf('day');
        if (start.isValid()) range.$gte = start.toDate();
      }
      if (toDate) {
        const end = moment.tz(toDate, 'Asia/Kolkata').endOf('day');
        if (end.isValid()) range.$lte = end.toDate();
      }
      if (Object.keys(range).length) filter.createdAt = range;
    }

    // Path filtering based on roles/tiers inside transferHistory if possible
    // Note: Since 'path' is complex, we will fetch and post-filter locally to ensure logic correctness across old vs new schema data
    // Or we apply simple constraints 
    // Usually Dev role implies Tier 3, QA/TL involves Tier 2, etc.

    let queries = await Query.find(filter)
      .populate('transferHistory.fromAgent', 'name role tier')
      .populate('transferHistory.toAgent', 'name role tier')
      .populate('resolvedBy', 'name alias role tier')
      .populate('devResolutionRemark.by', 'name alias role tier')
      .sort({ updatedAt: -1 });

    // In-memory filter for path selection:
    if (path !== 'all') {
      queries = queries.filter(q => {
        const history = q.transferHistory || [];
        
        // Find maximum targeted tier
        let maxTierReached = 1;
        let hitsDev = false;
        
        history.forEach(t => {
           const toRole = t.toAgent?.role || t.toRole || ''; // e.g. "Dev", "TL", "QA"
           const isDev = toRole === 'Dev' || q.devResolutionRemark?.message;
           if (isDev) { hitsDev = true; maxTierReached = 3; }
           else if (['TL', 'QA'].includes(toRole)) { maxTierReached = Math.max(maxTierReached, 2); }
        });

        if (path === 'tier1_tier2') return maxTierReached === 2 && !hitsDev;
        if (path === 'tier1_tier2_dev') return hitsDev; // or maxTierReached >= 3

        return true;
      });
    }

    const header = [
      'Petition ID',
      'Subject',
      'Customer Name',
      'Current Status',
      'Resolved By',
      'Dev Remark',
      'Dev Remark By',
      'Dev Remark At',
      'Escalation Chain',
      'Escalation Reasons',
      'Total Escalations',
      'First Escalated At',
      'Last Escalated At',
    ];

    const rows = queries.map((q) => {
      const chain = formatEscalationChainForReport(q.transferHistory);
      const reasons = formatEscalationReasonsForReport(q.transferHistory);
      const firstEscAt = q.transferHistory?.[0]?.requestedAt || q.transferHistory?.[0]?.transferredAt;
      const lastEscAt =
        q.transferHistory?.[q.transferHistory.length - 1]?.requestedAt ||
        q.transferHistory?.[q.transferHistory.length - 1]?.transferredAt;
      const resolvedByName = q.resolvedByName || q.resolvedBy?.alias || q.resolvedBy?.name || '';
      const devRemarkBy =
        q.devResolutionRemark?.byName ||
        q.devResolutionRemark?.by?.alias ||
        q.devResolutionRemark?.by?.name ||
        '';

      return [
        q.petitionId || '',
        q.subject || '',
        q.customerName || '',
        q.status || '',
        resolvedByName,
        q.devResolutionRemark?.message || '',
        devRemarkBy,
        q.devResolutionRemark?.updatedAt
          ? new Date(q.devResolutionRemark.updatedAt).toISOString()
          : '',
        chain,
        reasons,
        Array.isArray(q.transferHistory) ? q.transferHistory.length : 0,
        firstEscAt ? new Date(firstEscAt).toISOString() : '',
        lastEscAt ? new Date(lastEscAt).toISOString() : '',
      ];
    });

    const csv = [header, ...rows]
      .map((line) => line.map((cell) => csvEscape(cell)).join(','))
      .join('\n');

    const fileDate = new Date().toISOString().slice(0, 10);
    const filename = `escalation-remarks-report-${fileDate}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Download Escalation Remarks Report Error:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to download escalation report',
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

// Get available recipients (for transfer/escalation)
// Updated policy: recipients can be Agent, QA, TL, or Dev
exports.getAvailableAgents = async (req, res) => {
  try {
    const { category } = req.query;
    const requesterId = req.user?.id;
    const requester = requesterId ? await Staff.findById(requesterId) : null;

    const filter = {
      role: { $in: ['Agent', 'QA', 'TL', 'Dev'] },
      workStatus: { $in: ['active', 'offline'] },
    };

    if (category) {
      filter.department = category;
    }

    // ✅ Restrict to same organization as requester
    if (requester?.organizationId) {
      filter.organizationId = requester.organizationId;
    }

    const agents = await Staff.find(filter)
      .select('name email role department workStatus profileImage tier')
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

    const customer = await Customer.findById(customerId);

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

// SLA compliance summary report
exports.getSlaComplianceReport = async (req, res) => {
  try {
    const role = req.user?.role;
    const allowedRoles = ['QA', 'TL', 'Management', 'Admin', 'SuperAdmin', 'Dev', 'Aggregator'];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ status: false, message: 'Not authorized to view SLA report' });
    }

    const { fromDate, toDate, targetSeconds } = req.query;
    const benchmarkSeconds = Number(targetSeconds) || Number(process.env.UK_CHAT_FRT_TARGET_SECONDS) || 60;

    const filter = {};
    if (req.user?.role !== 'SuperAdmin' && req.user?.organizationId) {
      filter.organizationId = req.user.organizationId;
    }

    if (fromDate || toDate) {
      const range = {};
      if (fromDate) range.$gte = new Date(fromDate);
      if (toDate) range.$lte = new Date(toDate);
      filter.createdAt = range;
    }

    const queries = await Query.find(filter)
      .select('petitionId status customerName category firstResponseTimeSeconds firstResponseAt slaTargetSeconds isBreached createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const responded = queries.filter((q) => typeof q.firstResponseTimeSeconds === 'number');
    const withinSla = responded.filter(
      (q) => q.firstResponseTimeSeconds <= (q.slaTargetSeconds || benchmarkSeconds)
    );
    const breached = responded.filter(
      (q) => q.firstResponseTimeSeconds > (q.slaTargetSeconds || benchmarkSeconds)
    );
    const avgFRTSeconds = responded.length
      ? Math.round(
          responded.reduce((sum, q) => sum + (q.firstResponseTimeSeconds || 0), 0) / responded.length
        )
      : 0;

    return res.status(200).json({
      status: true,
      data: {
        benchmarkSeconds,
        totals: {
          totalQueries: queries.length,
          respondedQueries: responded.length,
          withinSla: withinSla.length,
          breached: breached.length,
          slaPercent: responded.length ? Number(((withinSla.length / responded.length) * 100).toFixed(2)) : 0,
          avgFRTSeconds,
        },
        breachedCases: breached.slice(0, 200).map((q) => ({
          petitionId: q.petitionId,
          customerName: q.customerName,
          category: q.category,
          status: q.status,
          firstResponseTimeSeconds: q.firstResponseTimeSeconds,
          targetSeconds: q.slaTargetSeconds || benchmarkSeconds,
          createdAt: q.createdAt,
          firstResponseAt: q.firstResponseAt,
        })),
      },
    });
  } catch (error) {
    console.error('getSlaComplianceReport error:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch SLA report', error: error.message });
  }
};

// SLA live breach alerts (unanswered/active queries past FRT target)
exports.getSlaLiveAlerts = async (req, res) => {
  try {
    const role = req.user?.role;
    const allowedRoles = ['QA', 'TL', 'Management', 'Admin', 'SuperAdmin', 'Dev', 'Aggregator'];
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ status: false, message: 'Not authorized to view SLA alerts' });
    }

    const benchmarkSeconds = Number(req.query.targetSeconds) || Number(process.env.UK_CHAT_FRT_TARGET_SECONDS) || 60;

    const filter = {
      status: { $in: ['Pending', 'Accepted', 'In Progress', 'Transferred'] },
    };
    if (req.user?.role !== 'SuperAdmin' && req.user?.organizationId) {
      filter.organizationId = req.user.organizationId;
    }

    const activeQueries = await Query.find(filter)
      .select('petitionId customerName category status createdAt firstResponseAt firstResponseTimeSeconds slaTargetSeconds')
      .sort({ createdAt: -1 })
      .lean();

    const now = Date.now();
    const alerts = activeQueries
      .map((q) => {
        const target = q.slaTargetSeconds || benchmarkSeconds;
        const elapsedSeconds = Math.max(0, Math.round((now - new Date(q.createdAt).getTime()) / 1000));
        const isBreachedLive = !q.firstResponseAt && elapsedSeconds > target;
        return {
          petitionId: q.petitionId,
          customerName: q.customerName,
          category: q.category,
          status: q.status,
          createdAt: q.createdAt,
          elapsedSeconds,
          targetSeconds: target,
          isBreachedLive,
        };
      })
      .filter((item) => item.isBreachedLive);

    return res.status(200).json({
      status: true,
      data: {
        benchmarkSeconds,
        activeBreaches: alerts,
        totalActiveBreaches: alerts.length,
      },
    });
  } catch (error) {
    console.error('getSlaLiveAlerts error:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch SLA alerts', error: error.message });
  }
};
