const Query = require('../models/Query');
const Room = require('../models/Room');
const Message = require('../models/Message');
const User = require('../models/User');
const QueryEvaluation = require('../models/QueryEvaluation');
const TicketEvaluation = require('../models/TicketEvaluation');
const EmailTicket = require('../email-ticketing/models/Ticket');

/**
 * Get comprehensive dashboard statistics for Agent
 * Returns: active chats, resolved today, pending, response time, calls, emails, screenshots, etc.
 */
exports.getAgentDashboardStats = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📊 [Agent Stats] Fetching for agent:', agentId);

    // 1. Active Chats (Accepted or In Progress queries assigned to agent)
    const activeChatsCount = await Query.countDocuments({
      assignedTo: agentId,
      status: { $in: ['Accepted', 'In Progress', 'Transferred'] },
    });
    console.log('✅ Active chats:', activeChatsCount);

    // 2. Pending Queries (Pending queries not yet assigned)
    const pendingQueriesCount = await Query.countDocuments({
      status: 'Pending',
    });
    console.log('✅ Pending queries:', pendingQueriesCount);

    // 3. Resolved Today (Resolved queries from today)
    const resolvedTodayCount = await Query.countDocuments({
      assignedTo: agentId,
      status: 'Resolved',
      updatedAt: { $gte: today },
    });
    console.log('✅ Resolved today:', resolvedTodayCount);

    // 4. Average Response Time (in minutes - from query acceptance to first response)
    const queriesWithMessages = await Query.find({
      assignedTo: agentId,
      status: 'Resolved',
      updatedAt: { $gte: today },
      messages: { $exists: true, $ne: [] },
    }).select('acceptedAt messages');

    let avgResponseTime = 0;
    if (queriesWithMessages.length > 0) {
      let totalResponseTime = 0;
      queriesWithMessages.forEach((query) => {
        if (query.acceptedAt && query.messages.length > 0) {
          const firstResponse = query.messages[0];
          const responseTime =
            (new Date(firstResponse.timestamp) - new Date(query.acceptedAt)) / 1000 / 60;
          totalResponseTime += Math.max(0, responseTime);
        }
      });
      avgResponseTime = (totalResponseTime / queriesWithMessages.length).toFixed(1);
    }
    console.log('✅ Avg response time:', avgResponseTime);

    // 5. Calls Made (Room records where agent is caller)
    const callsMade = await Room.countDocuments({
      'participants.userId': agentId,
      status: { $in: ['accepted', 'ended'] },
      startedAt: { $gte: today },
    });
    console.log('✅ Calls made:', callsMade);

    // 6. Emails Sent (Messages sent by agent)
    const emailsSent = await Message.countDocuments({
      userId: agentId,
      source: 'email',
      timestamp: { $gte: today },
    });
    console.log('✅ Emails sent:', emailsSent);

    // 7. Screenshots Created
    const screenshotsCreated = 0; // Feature not yet implemented in current schema
    console.log('✅ Screenshots created:', screenshotsCreated);

    // 8. Chat Messages Sent Today (Count from query messages)
    const chatMessagesSent = 0; // Will be calculated from query messages if needed
    console.log('✅ Chat messages sent:', chatMessagesSent);

    // 9. Total Call Duration Today (in minutes)
    const callsToday = await Room.find({
      'participants.userId': agentId,
      status: { $in: ['accepted', 'ended'] },
      startedAt: { $gte: today },
    }).select('duration');

    let totalCallDuration = 0;
    callsToday.forEach((call) => {
      if (call.duration) {
        totalCallDuration += call.duration;
      }
    });
    const totalCallDurationMinutes = Math.floor(totalCallDuration / 60);
    console.log('✅ Total call duration:', totalCallDurationMinutes);

    // 10. High Priority Queries Assigned
    const highPriorityQueries = await Query.countDocuments({
      assignedTo: agentId,
      priority: 'High',
      status: { $in: ['Pending', 'Accepted', 'In Progress'] },
    });
    console.log('✅ High priority queries:', highPriorityQueries);

    // 11. Customer Feedback Rating (Average rating from resolved queries)
    const queriesWithFeedback = await Query.find({
      assignedTo: agentId,
      status: 'Resolved',
      'feedback.rating': { $exists: true, $ne: null },
    }).select('feedback');

    let avgFeedbackRating = 0;
    let totalFeedbackCount = 0;
    if (queriesWithFeedback.length > 0) {
      const totalRating = queriesWithFeedback.reduce((sum, query) => {
        return sum + (query.feedback?.rating || 0);
      }, 0);
      avgFeedbackRating = (totalRating / queriesWithFeedback.length).toFixed(2);
      totalFeedbackCount = queriesWithFeedback.length;
    }
    console.log(
      '✅ Average feedback rating:',
      avgFeedbackRating,
      'from',
      totalFeedbackCount,
      'feedbacks'
    );

    // 12. Total Resolved Queries (All time)
    const totalResolvedQueries = await Query.countDocuments({
      assignedTo: agentId,
      status: 'Resolved',
    });
    console.log('✅ Total resolved queries:', totalResolvedQueries);

    // 13. Escalated queries stats (queries escalated BY or TO this agent)
    const escalatedByMe = await Query.countDocuments({
      'transferHistory.fromAgent': agentId,
    });
    const escalatedToMe = await Query.countDocuments({
      'transferHistory.toAgent': agentId,
    });
    // Get distinct queries to avoid double counting
    const escalatedQueries = await Query.find({
      $or: [{ 'transferHistory.fromAgent': agentId }, { 'transferHistory.toAgent': agentId }],
    }).distinct('_id');
    const totalEscalated = escalatedQueries.length;

    // Open/Pending escalated queries (Transferred status)
    const openEscalatedQueries = await Query.find({
      status: 'Transferred',
      $or: [{ 'transferHistory.fromAgent': agentId }, { 'transferHistory.toAgent': agentId }],
    }).distinct('_id');
    const openEscalatedCount = openEscalatedQueries.length;

    // Accepted/In Progress escalated queries
    const activeEscalatedQueries = await Query.find({
      status: { $in: ['Accepted', 'In Progress'] },
      $or: [{ 'transferHistory.fromAgent': agentId }, { 'transferHistory.toAgent': agentId }],
    }).distinct('_id');
    const activeEscalatedCount = activeEscalatedQueries.length;

    // Resolved escalated queries - only those resolved by current agent
    const resolvedEscalatedQueries = await Query.find({
      status: 'Resolved',
      resolvedBy: agentId,
      $or: [{ 'transferHistory.fromAgent': agentId }, { 'transferHistory.toAgent': agentId }],
    }).distinct('_id');
    const resolvedEscalatedCount = resolvedEscalatedQueries.length;

    console.log('✅ Escalated queries:', {
      total: totalEscalated,
      open: openEscalatedCount,
      active: activeEscalatedCount,
      resolved: resolvedEscalatedCount,
    });

    const responseData = {
      activeChats: activeChatsCount,
      pendingQueries: pendingQueriesCount,
      resolvedToday: resolvedTodayCount,
      totalResolvedQueries,
      avgResponseTime: parseFloat(avgResponseTime),
      callsMade,
      emailsSent,
      screenshotsCreated,
      chatMessagesSent,
      totalCallDuration: totalCallDurationMinutes,
      highPriorityQueries,
      avgFeedbackRating: parseFloat(avgFeedbackRating),
      totalFeedbackCount,
      escalatedQueries: {
        total: totalEscalated,
        open: openEscalatedCount,
        active: activeEscalatedCount,
        resolved: resolvedEscalatedCount,
      },
      timestamp: new Date(),
    };

    console.log('✅ [Agent Stats] Response data:', responseData);

    res.status(200).json({
      status: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ Get Agent Dashboard Stats Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message,
    });
  }
};

/**
 * Get comprehensive dashboard statistics for QA
 * Returns: tickets to review, approved, rejected, quality score, etc.
 */
exports.getQADashboardStats = async (req, res) => {
  try {
    const qaId = req.user?.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Weightage-based metrics for queries (petition evaluations)
    const resolvedQueriesToday = await Query.find({
      status: 'Resolved',
      updatedAt: { $gte: today },
    }).select('_id petitionId');

    const queryEvalsToday = await QueryEvaluation.find({
      evaluatedBy: qaId,
      createdAt: { $gte: today },
    }).select('petitionId queryId');

    const queryEvalSet = new Set(
      queryEvalsToday.map((ev) => (ev.petitionId ? ev.petitionId : ev.queryId?.toString()))
    );

    const pendingQueryReviews = resolvedQueriesToday.filter((q) => {
      const key = q.petitionId || q._id.toString();
      return !queryEvalSet.has(key);
    }).length;

    const reviewedQueriesToday = queryEvalsToday.length;
    const totalQueriesReviewed = await QueryEvaluation.countDocuments({ evaluatedBy: qaId });

    // Weightage-based metrics for tickets (email tickets)
    const closedTicketsToday = await EmailTicket.find({
      status: 'closed',
      updatedAt: { $gte: today },
    }).select('_id ticketId');

    const ticketEvalsToday = await TicketEvaluation.find({
      evaluatedBy: qaId,
      createdAt: { $gte: today },
    }).select('ticketRef ticketId');

    const ticketEvalSet = new Set(
      ticketEvalsToday.map((ev) => (ev.ticketId ? ev.ticketId : ev.ticketRef?.toString()))
    );

    const pendingTicketReviews = closedTicketsToday.filter((t) => {
      const key = t.ticketId || t._id.toString();
      return !ticketEvalSet.has(key);
    }).length;

    const reviewedTicketsToday = ticketEvalsToday.length;
    const totalTicketsReviewed = await TicketEvaluation.countDocuments({ evaluatedBy: qaId });

    // Escalated queries stats (queries escalated BY or TO this user)
    const escalatedByMe = await Query.countDocuments({
      'transferHistory.fromAgent': qaId,
    });
    const escalatedToMe = await Query.countDocuments({
      'transferHistory.toAgent': qaId,
    });
    // Get distinct queries to avoid double counting
    const escalatedQueries = await Query.find({
      $or: [{ 'transferHistory.fromAgent': qaId }, { 'transferHistory.toAgent': qaId }],
    }).distinct('_id');
    const totalEscalated = escalatedQueries.length;

    // Open/Pending escalated queries (Transferred status)
    const openEscalatedQueries = await Query.find({
      status: 'Transferred',
      $or: [{ 'transferHistory.fromAgent': qaId }, { 'transferHistory.toAgent': qaId }],
    }).distinct('_id');
    const openEscalatedCount = openEscalatedQueries.length;

    // Accepted/In Progress escalated queries
    const activeEscalatedQueries = await Query.find({
      status: { $in: ['Accepted', 'In Progress'] },
      $or: [{ 'transferHistory.fromAgent': qaId }, { 'transferHistory.toAgent': qaId }],
    }).distinct('_id');
    const activeEscalatedCount = activeEscalatedQueries.length;

    // Resolved escalated queries - only those resolved by current user
    const resolvedEscalatedQueries = await Query.find({
      status: 'Resolved',
      resolvedBy: qaId,
      $or: [{ 'transferHistory.fromAgent': qaId }, { 'transferHistory.toAgent': qaId }],
    }).distinct('_id');
    const resolvedEscalatedCount = resolvedEscalatedQueries.length;

    // ============================================
    // TEAM-WIDE AGGREGATE STATS (All Agents, TLs, QAs)
    // ============================================

    // Get all users (Agents, TLs, QAs) from the organization
    const organizationId = req.user?.organizationId;
    const teamFilter = organizationId
      ? { role: { $in: ['Agent', 'TL', 'QA'] }, organizationId }
      : { role: { $in: ['Agent', 'TL', 'QA'] } };

    const allTeamMembers = await User.find(teamFilter).select('_id');
    const teamMemberIds = allTeamMembers.map((u) => u._id);

    // Team: Pending queries
    const teamPendingQueries = await Query.countDocuments({
      status: 'Pending',
      ...(organizationId && { organizationId }),
    });

    // Team: Active chats
    const teamActiveChats = await Query.countDocuments({
      status: { $in: ['Accepted', 'In Progress', 'Transferred'] },
      ...(organizationId && { organizationId }),
    });

    // Team: Resolved today
    const teamResolvedToday = await Query.countDocuments({
      status: 'Resolved',
      updatedAt: { $gte: today },
      ...(organizationId && { organizationId }),
    });

    // Team: Total resolved
    const teamTotalResolved = await Query.countDocuments({
      status: 'Resolved',
      ...(organizationId && { organizationId }),
    });

    // Team: Total escalated queries
    const teamEscalatedQueries = await Query.find({
      transferHistory: { $exists: true, $ne: [] },
      ...(organizationId && { organizationId }),
    }).distinct('_id');
    const teamTotalEscalated = teamEscalatedQueries.length;

    // Team: Open escalated
    const teamOpenEscalated = await Query.find({
      status: 'Transferred',
      transferHistory: { $exists: true, $ne: [] },
      ...(organizationId && { organizationId }),
    }).distinct('_id');
    const teamOpenEscalatedCount = teamOpenEscalated.length;

    // Team: Active escalated
    const teamActiveEscalated = await Query.find({
      status: { $in: ['Accepted', 'In Progress'] },
      transferHistory: { $exists: true, $ne: [] },
      ...(organizationId && { organizationId }),
    }).distinct('_id');
    const teamActiveEscalatedCount = teamActiveEscalated.length;

    // Team: Resolved escalated
    const teamResolvedEscalated = await Query.find({
      status: 'Resolved',
      transferHistory: { $exists: true, $ne: [] },
      ...(organizationId && { organizationId }),
    }).distinct('_id');
    const teamResolvedEscalatedCount = teamResolvedEscalated.length;

    // Team: Total reviews done
    const teamTotalQueryReviews = await QueryEvaluation.countDocuments({
      ...(organizationId && { organizationId }),
    });

    const teamTotalTicketReviews = await TicketEvaluation.countDocuments({
      ...(organizationId && { organizationId }),
    });

    const qaReviewMetrics = {
      query: {
        pending: pendingQueryReviews,
        reviewedToday: reviewedQueriesToday,
        totalReviewed: totalQueriesReviewed,
      },
      ticket: {
        pending: pendingTicketReviews,
        reviewedToday: reviewedTicketsToday,
        totalReviewed: totalTicketsReviewed,
      },
    };

    res.status(200).json({
      status: true,
      data: {
        // Personal review metrics (TL/QA specific)
        activeChats: pendingQueryReviews, // Queries pending review
        pendingQueries: pendingQueryReviews + pendingTicketReviews, // Total pending reviews (queries + tickets)
        resolvedToday: reviewedQueriesToday + reviewedTicketsToday, // Total reviewed today
        totalResolvedQueries: totalQueriesReviewed + totalTicketsReviewed, // Total reviews done
        avgResponseTime: 0,
        callsMade: 0,
        emailsSent: 0,
        screenshotsCreated: 0,
        chatMessagesSent: 0,
        totalCallDuration: 0,
        highPriorityQueries: 0, // QA/TL don't use high priority queries stat
        avgFeedbackRating: 0,
        totalFeedbackCount: 0,

        // QA review metrics for front-end use
        queriesReviewedToday: reviewedQueriesToday,
        totalTicketsProcessed: totalQueriesReviewed,
        approvalRate: 0,
        avgQualityScore: 0,
        qaReviewMetrics,

        // Escalated queries stats (personal)
        escalatedQueries: {
          total: totalEscalated,
          open: openEscalatedCount,
          active: activeEscalatedCount,
          resolved: resolvedEscalatedCount,
        },

        // Team-wide aggregate stats
        teamStats: {
          pendingQueries: teamPendingQueries,
          activeChats: teamActiveChats,
          resolvedToday: teamResolvedToday,
          totalResolved: teamTotalResolved,
          escalatedQueries: {
            total: teamTotalEscalated,
            open: teamOpenEscalatedCount,
            active: teamActiveEscalatedCount,
            resolved: teamResolvedEscalatedCount,
          },
          totalQueryReviews: teamTotalQueryReviews,
          totalTicketReviews: teamTotalTicketReviews,
        },

        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Get QA Dashboard Stats Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch QA dashboard statistics',
      error: error.message,
    });
  }
};

/**
 * Get dashboard statistics based on user role
 * Automatically determines role and returns appropriate statistics
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      console.error('❌ No user ID found in token');
      return res.status(401).json({
        status: false,
        message: 'User ID not found in token',
      });
    }

    console.log('📊 Fetching dashboard stats for user:', userId);

    const user = await User.findById(userId).select('role');

    if (!user) {
      console.error('❌ User not found:', userId);
      return res.status(404).json({
        status: false,
        message: 'User not found',
      });
    }

    console.log('👤 User role:', user.role);

    if (user.role === 'Agent') {
      return exports.getAgentDashboardStats(req, res);
    }

    if (user.role === 'QA' || user.role === 'TL') {
      return exports.getQADashboardStats(req, res);
    }

    if (user.role === 'Admin' || user.role === 'Management') {
      return exports.getAdminDashboardStats(req, res);
    }

    return res.status(403).json({
      status: false,
      message: 'Dashboard not available for this role',
    });
  } catch (error) {
    console.error('❌ Get Dashboard Stats Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message,
    });
  }
};

/**
 * Get weekly performance data for charts
 */
exports.getWeeklyPerformance = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select('role');

    // ✅ Fixed: Array must match JavaScript's getDay() order (0=Sun, 1=Mon, ... 6=Sat)
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekData = [];

    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      // Default metrics
      let resolvedCount = 0;
      let reviewCount = 0;
      let handledCount = 0;
      let escalatedCount = 0;

      if (user.role === 'QA' || user.role === 'Agent' || user.role === 'TL') {
        // Queries resolved by this user (use resolvedBy when available)
        resolvedCount = await Query.countDocuments({
          $or: [{ resolvedBy: userId }, { resolvedBy: { $exists: false }, assignedTo: userId }],
          resolvedAt: { $gte: date, $lt: nextDate },
        });

        // Weightage reviews done by this user
        reviewCount = await QueryEvaluation.countDocuments({
          evaluatedBy: userId,
          createdAt: { $gte: date, $lt: nextDate },
        });

        // Queries this user handled during the day
        handledCount = await Query.countDocuments({
          assignedTo: userId,
          status: { $in: ['Accepted', 'In Progress', 'Resolved'] },
          updatedAt: { $gte: date, $lt: nextDate },
        });

        if (user.role === 'QA' || user.role === 'TL') {
          // Escalations handled by QA/TL: resolved by this user that originated from someone else
          escalatedCount = await Query.countDocuments({
            resolvedBy: userId,
            status: 'Resolved',
            updatedAt: { $gte: date, $lt: nextDate },
            transferHistory: { $elemMatch: { fromAgent: { $exists: true, $ne: userId } } },
          });
        } else {
          // Agent view: escalations they initiated OR received
          // 1. Escalations initiated by this agent (outgoing)
          const escalatedByMe = await Query.countDocuments({
            'transferHistory.fromAgent': userId,
            'transferHistory.transferredAt': { $gte: date, $lt: nextDate },
          });

          // 2. Escalations received by this agent (incoming)
          const escalatedToMe = await Query.countDocuments({
            'transferHistory.toAgent': userId,
            'transferHistory.transferredAt': { $gte: date, $lt: nextDate },
          });

          escalatedCount = escalatedByMe + escalatedToMe;
        }
      }

      const dayIndex = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      weekData.push({
        day: daysOfWeek[dayIndex],
        value: resolvedCount, // legacy field for existing charts
        reviews: reviewCount,
        handled: handledCount,
        escalated: escalatedCount,
        date: date.toISOString().split('T')[0],
      });
    }

    res.status(200).json({
      status: true,
      data: weekData,
    });
  } catch (error) {
    console.error('Get Weekly Performance Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch weekly performance',
      error: error.message,
    });
  }
};

/**
 * Get performance trends (last 30 days)
 */
exports.getPerformanceTrends = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select('role');

    const trendsData = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      let resolved = 0;
      let pending = 0;

      if (user.role === 'QA' || user.role === 'Agent' || user.role === 'TL') {
        resolved = await Query.countDocuments({
          assignedTo: userId,
          status: 'Resolved',
          updatedAt: { $gte: date, $lt: nextDate },
        });
        pending = await Query.countDocuments({
          assignedTo: userId,
          status: { $in: ['Accepted', 'In Progress'] },
          createdAt: { $lt: nextDate },
          updatedAt: { $gte: date, $lt: nextDate },
        });
      }

      trendsData.push({
        date: date.toISOString().split('T')[0],
        resolved,
        pending,
      });
    }

    res.status(200).json({
      status: true,
      data: trendsData,
    });
  } catch (error) {
    console.error('Get Performance Trends Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch performance trends',
      error: error.message,
    });
  }
};

/**
 * Get comprehensive Admin Dashboard Statistics
 * Aggregates data from all agents and QA team members
 * Returns: total queries, resolved, calls, emails, feedback ratings, etc.
 */
exports.getAdminDashboardStats = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!['Admin', 'SuperAdmin', 'Management'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized access',
      });
    }

    // Get date filter from query params: today, week, month, all
    const dateFilter = req.query.dateFilter || 'week';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate date range based on filter
    let startDate = new Date(today);
    switch (dateFilter) {
      case 'today':
        startDate = today;
        break;
      case 'week':
        startDate.setDate(today.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(today.getMonth() - 1);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
      default:
        startDate.setDate(today.getDate() - 7); // Default to week
    }

    console.log(
      `📊 [Admin Dashboard] Fetching statistics for filter: ${dateFilter} (from ${startDate.toISOString()})`
    );

    // Get all agents and QA members
    const agents = await User.find({ role: 'Agent' }).select('_id name email is_active');
    const qaMembers = await User.find({ role: 'QA' }).select('_id name email is_active');
    const tlMembers = await User.find({ role: 'TL' }).select('_id name email is_active'); // Added TLs
    const customers = await User.find({ role: 'Customer' }).select('_id name email is_active');

    const agentIds = agents.map((a) => a._id);
    const qaIds = qaMembers.map((q) => q._id);
    const tlIds = tlMembers.map((t) => t._id); // Added TL Ids

    console.log(
      `👥 Found ${agentIds.length} agents, ${qaIds.length} QA members, ${tlIds.length} TLs, ${customers.length} customers`
    );

    // ========== AGENT STATISTICS ==========
    // 1. Total Active Chats (assigned to any agent)
    const totalActiveChats = await Query.countDocuments({
      assignedTo: { $in: agentIds },
      status: { $in: ['Accepted', 'In Progress', 'Transferred'] },
    });

    // 2. Total Pending Queries
    const totalPendingQueries = await Query.countDocuments({
      status: 'Pending',
    });

    // 3. Resolved in date range (filtered)
    const totalResolvedInRange = await Query.countDocuments({
      assignedTo: { $in: agentIds },
      status: 'Resolved',
      updatedAt: { $gte: startDate },
    });

    // 4. Resolved Today (for today metric)
    const totalResolvedToday = await Query.countDocuments({
      assignedTo: { $in: agentIds },
      status: 'Resolved',
      updatedAt: { $gte: today },
    });

    // 5. Total Resolved Queries (all time)
    const totalResolvedQueries = await Query.countDocuments({
      assignedTo: { $in: agentIds },
      status: 'Resolved',
    });

    // 6. Average Response Time (filtered by date range)
    const queriesWithMessages = await Query.find({
      assignedTo: { $in: agentIds },
      status: 'Resolved',
      updatedAt: { $gte: startDate },
      messages: { $exists: true, $ne: [] },
    }).select('acceptedAt messages');

    let avgResponseTime = 0;
    if (queriesWithMessages.length > 0) {
      let totalResponseTime = 0;
      queriesWithMessages.forEach((query) => {
        if (query.acceptedAt && query.messages.length > 0) {
          const firstResponse = query.messages[0];
          const responseTime =
            (new Date(firstResponse.timestamp) - new Date(query.acceptedAt)) / 1000 / 60;
          totalResponseTime += Math.max(0, responseTime);
        }
      });
      avgResponseTime = (totalResponseTime / queriesWithMessages.length).toFixed(1);
    }

    // 6. Total Calls Made (filtered by date range)
    const totalCallsMade = await Room.countDocuments({
      'participants.userId': { $in: agentIds },
      status: { $in: ['accepted', 'ended'] },
      startedAt: { $gte: startDate },
    });

    // 7. Total Emails Sent (filtered by date range)
    const totalEmailsSent = await Message.countDocuments({
      userId: { $in: agentIds },
      source: 'email',
      timestamp: { $gte: startDate },
    });

    // 8. Total Call Duration (filtered by date range, in minutes)
    const callsData = await Room.find({
      'participants.userId': { $in: agentIds },
      status: { $in: ['accepted', 'ended'] },
      startedAt: { $gte: startDate },
    }).select('duration');

    let totalCallDurationMinutes = 0;
    callsData.forEach((call) => {
      if (call.duration) {
        totalCallDurationMinutes += call.duration;
      }
    });
    totalCallDurationMinutes = Math.floor(totalCallDurationMinutes / 60);

    // 9. High Priority Queries (all agents)
    const highPriorityQueries = await Query.countDocuments({
      assignedTo: { $in: agentIds },
      priority: 'High',
      status: { $in: ['Pending', 'Accepted', 'In Progress'] },
    });

    // 10. Average Customer Feedback Rating (filtered by date range)
    const agentFeedbackQueries = await Query.find({
      assignedTo: { $in: agentIds },
      status: 'Resolved',
      updatedAt: { $gte: startDate },
      'feedback.rating': { $exists: true, $ne: null },
    }).select('feedback');

    let avgAgentFeedbackRating = 0;
    let totalAgentFeedbackCount = 0;
    if (agentFeedbackQueries.length > 0) {
      const totalRating = agentFeedbackQueries.reduce((sum, query) => {
        return sum + (query.feedback?.rating || 0);
      }, 0);
      avgAgentFeedbackRating = (totalRating / agentFeedbackQueries.length).toFixed(2);
      totalAgentFeedbackCount = agentFeedbackQueries.length;
    }

    // ========== QA STATISTICS ==========
    // 1. Total QA Tickets Reviewed
    const totalQATicketsReviewed = await Query.countDocuments({
      assignedTo: { $in: qaIds },
      status: { $in: ['Resolved', 'Transferred'] },
    });

    // 2. QA Approval Rate (resolved / total processed)
    const qaApprovedToday = await Query.countDocuments({
      assignedTo: { $in: qaIds },
      status: 'Resolved',
      updatedAt: { $gte: today },
    });

    const qaApprovalRate =
      totalQATicketsReviewed > 0
        ? ((qaApprovedToday / totalQATicketsReviewed) * 100).toFixed(1)
        : 0;

    // 3. QA Feedback Rating
    const qaFeedbackQueries = await Query.find({
      assignedTo: { $in: qaIds },
      status: 'Resolved',
      'feedback.rating': { $exists: true, $ne: null },
    }).select('feedback');

    let avgQAFeedbackRating = 0;
    let totalQAFeedbackCount = 0;
    if (qaFeedbackQueries.length > 0) {
      const totalRating = qaFeedbackQueries.reduce((sum, query) => {
        return sum + (query.feedback?.rating || 0);
      }, 0);
      avgQAFeedbackRating = (totalRating / qaFeedbackQueries.length).toFixed(2);
      totalQAFeedbackCount = qaFeedbackQueries.length;
    }

    // ========== TL STATISTICS ==========
    // 1. Total TL Reviews (approvals/rejections of QA work or direct agent supervision)
    // Note: In this schema, TLs might also resolve stats or manage rooms.
    // Assuming TLs have similar metrics to QA/Agents for now, or we track their team's performance.
    // For specific TL metrics, we'd need to know what they "do" (resolve queries? review tickets?).
    // Implementation below assumes TLs might resolve queries or handle escalations.

    const totalTLEscalations = await Query.countDocuments({
      assignedTo: { $in: tlIds },
      status: { $in: ['Resolved', 'Transferred'] },
    });

    const tlResolvedToday = await Query.countDocuments({
      assignedTo: { $in: tlIds },
      status: 'Resolved',
      updatedAt: { $gte: today },
    });

    // TL Feedback Rating (if they handle queries directly)
    const tlFeedbackQueries = await Query.find({
      assignedTo: { $in: tlIds },
      status: 'Resolved',
      'feedback.rating': { $exists: true, $ne: null },
    }).select('feedback');

    let avgTLFeedbackRating = 0;
    let totalTLFeedbackCount = 0;
    if (tlFeedbackQueries.length > 0) {
      const totalRating = tlFeedbackQueries.reduce((sum, query) => {
        return sum + (query.feedback?.rating || 0);
      }, 0);
      avgTLFeedbackRating = (totalRating / tlFeedbackQueries.length).toFixed(2);
      totalTLFeedbackCount = tlFeedbackQueries.length;
    }

    // Get detailed TL activity
    const detailedTLs = await User.find({ role: 'TL' }).select(
      '_id name email is_active workStatus login_time breakLogs accumulatedActiveTime lastStatusChangeTime'
    );

    const tlActivityCounts = {
      currentlyActive: detailedTLs.filter((t) => t.workStatus === 'active').length,
      onBreak: detailedTLs.filter((t) => t.workStatus === 'break').length,
      offline: detailedTLs.filter((t) => t.workStatus === 'offline').length,
    };

    // Calculate average active time for TLs
    let totalTLActiveTime = 0;
    detailedTLs.forEach((tl) => {
      let activeTime = tl.accumulatedActiveTime || 0;
      if ((tl.workStatus === 'active' || tl.workStatus === 'busy') && tl.lastStatusChangeTime) {
        const now = new Date();
        const currentSessionTime = (now - new Date(tl.lastStatusChangeTime)) / 1000 / 60;
        activeTime += Math.max(0, currentSessionTime);
      }
      totalTLActiveTime += activeTime;
    });
    const avgTLActiveTimeMinutes =
      detailedTLs.length > 0 ? totalTLActiveTime / detailedTLs.length : 0;

    const roundedAvgTLActiveTime = Math.round(avgTLActiveTimeMinutes);
    const tlActiveHours = Math.floor(roundedAvgTLActiveTime / 60);
    const tlActiveMinutes = roundedAvgTLActiveTime % 60;
    const avgTLActiveTimeFormatted = `${tlActiveHours}h ${tlActiveMinutes.toString().padStart(2, '0')}m`;

    // ========== OVERALL STATISTICS ==========
    // 1. User Statistics
    const activeUsers = [...agents, ...qaMembers, ...tlMembers, ...customers].filter(
      (u) => u.is_active
    ).length;
    const totalUsers = agents.length + qaMembers.length + tlMembers.length + customers.length;

    // 2. Query Status Distribution
    const totalQueries = await Query.countDocuments({});
    const openQueries = await Query.countDocuments({
      status: { $in: ['Pending', 'Accepted', 'In Progress'] },
    });
    const resolvedQueryCount = await Query.countDocuments({
      status: 'Resolved',
    });

    // 3. Chat & Communication Stats
    const totalChats = totalQueries;
    const totalCalls = await Room.countDocuments({
      status: { $in: ['accepted', 'ended'] },
    });

    // 4. Overall System Health
    const systemHealth = {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      agentCount: agents.length,
      qaCount: qaMembers.length,
      tlCount: tlMembers.length,
      customerCount: customers.length,
      activeAgents: agents.filter((a) => a.is_active).length,
      activeQA: qaMembers.filter((q) => q.is_active).length,
      activeTL: tlMembers.filter((t) => t.is_active).length,
    };

    // ========== GLOBAL STATISTICS (NEW) ==========
    // Detailed Query Stats
    const [
      queryPending,
      queryAccepted,
      queryInProgress,
      queryResolved,
      queryTransferred,
      queryExpired,
    ] = await Promise.all([
      Query.countDocuments({ status: 'Pending' }),
      Query.countDocuments({ status: 'Accepted' }),
      Query.countDocuments({ status: 'In Progress' }),
      Query.countDocuments({ status: 'Resolved' }),
      Query.countDocuments({ status: 'Transferred' }),
      Query.countDocuments({ status: 'Expired' }),
    ]);

    // Query Trend (Last 7 Days) - New queries created
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const queryTrend = await Query.aggregate([
      {
        $match: {
          createdAt: { $gte: last7Days },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Conversation Trend - Both new and resolved queries per day
    const resolvedTrend = await Query.aggregate([
      {
        $match: {
          status: 'Resolved',
          updatedAt: { $gte: last7Days },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Merge new and resolved trends into conversation trend
    const conversationTrendMap = {};
    queryTrend.forEach((item) => {
      conversationTrendMap[item._id] = { date: item._id, new: item.count, resolved: 0 };
    });
    resolvedTrend.forEach((item) => {
      if (conversationTrendMap[item._id]) {
        conversationTrendMap[item._id].resolved = item.count;
      } else {
        conversationTrendMap[item._id] = { date: item._id, new: 0, resolved: item.count };
      }
    });

    // Fill in missing days with 0 values
    const conversationTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      conversationTrend.push(
        conversationTrendMap[dateStr] || { date: dateStr, new: 0, resolved: 0 }
      );
    }

    // Query Category Stats
    const queryCategoryStats = await Query.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const globalQueryStats = {
      total: totalQueries,
      pending: queryPending,
      accepted: queryAccepted,
      inProgress: queryInProgress,
      resolved: queryResolved,
      transferred: queryTransferred,
      expired: queryExpired,
      open: queryPending + queryAccepted + queryInProgress, // Aggregate for "Open"
      trend: queryTrend.map((item) => ({ date: item._id, count: item.count })),
      conversationTrend, // New and resolved queries per day
      categories: queryCategoryStats.map((item) => ({
        name: item._id || 'Uncategorized',
        value: item.count,
      })),
    };

    // Detailed Ticket Stats
    const [ticketTotal, ticketOpen, ticketPending, ticketClosed, ticketUnassigned] =
      await Promise.all([
        EmailTicket.countDocuments({}),
        EmailTicket.countDocuments({ status: 'open' }),
        EmailTicket.countDocuments({ status: 'pending' }),
        EmailTicket.countDocuments({ status: 'closed' }),
        EmailTicket.countDocuments({ assignedTo: null, status: { $ne: 'closed' } }),
      ]);

    const globalTicketStats = {
      total: ticketTotal,
      open: ticketOpen,
      pending: ticketPending,
      closed: ticketClosed,
      unassigned: ticketUnassigned,
    };

    // ========== DETAILED ACTIVITY STATUS ==========
    // Get detailed agent activity with workStatus
    const detailedAgents = await User.find({ role: 'Agent' }).select(
      '_id name email is_active workStatus login_time breakLogs accumulatedActiveTime lastStatusChangeTime'
    );

    const agentActivityCounts = {
      currentlyActive: detailedAgents.filter((a) => a.workStatus === 'active').length,
      onBreak: detailedAgents.filter((a) => a.workStatus === 'break').length,
      offline: detailedAgents.filter((a) => a.workStatus === 'offline').length,
    };

    // Calculate average active time for agents (ONLY active/busy time)
    let totalAgentActiveTime = 0;
    detailedAgents.forEach((agent) => {
      let activeTime = agent.accumulatedActiveTime || 0;
      if (
        (agent.workStatus === 'active' || agent.workStatus === 'busy') &&
        agent.lastStatusChangeTime
      ) {
        const now = new Date();
        const currentSessionTime = (now - new Date(agent.lastStatusChangeTime)) / 1000 / 60;
        activeTime += Math.max(0, currentSessionTime);
      }
      totalAgentActiveTime += activeTime;
    });
    const avgAgentActiveTimeMinutes =
      detailedAgents.length > 0 ? totalAgentActiveTime / detailedAgents.length : 0;

    // Convert to hours and minutes
    const roundedAvgAgentActiveTime = Math.round(avgAgentActiveTimeMinutes);
    const agentActiveHours = Math.floor(roundedAvgAgentActiveTime / 60);
    const agentActiveMinutes = roundedAvgAgentActiveTime % 60;
    const avgAgentActiveTimeFormatted = `${agentActiveHours}h ${agentActiveMinutes.toString().padStart(2, '0')}m`;

    // Get detailed QA activity with workStatus
    const detailedQA = await User.find({ role: 'QA' }).select(
      '_id name email is_active workStatus login_time breakLogs accumulatedActiveTime lastStatusChangeTime'
    );

    const qaActivityCounts = {
      currentlyActive: detailedQA.filter((q) => q.workStatus === 'active').length,
      onBreak: detailedQA.filter((q) => q.workStatus === 'break').length,
      offline: detailedQA.filter((q) => q.workStatus === 'offline').length,
    };

    // Calculate average active time for QA (ONLY active/busy time)
    let totalQAActiveTime = 0;
    detailedQA.forEach((qa) => {
      let activeTime = qa.accumulatedActiveTime || 0;
      if ((qa.workStatus === 'active' || qa.workStatus === 'busy') && qa.lastStatusChangeTime) {
        const now = new Date();
        const currentSessionTime = (now - new Date(qa.lastStatusChangeTime)) / 1000 / 60;
        activeTime += Math.max(0, currentSessionTime);
      }
      totalQAActiveTime += activeTime;
    });
    const avgQAActiveTimeMinutes =
      detailedQA.length > 0 ? totalQAActiveTime / detailedQA.length : 0;

    // Convert to hours and minutes
    const roundedAvgQAActiveTime = Math.round(avgQAActiveTimeMinutes);
    const qaActiveHours = Math.floor(roundedAvgQAActiveTime / 60);
    const qaActiveMinutes = roundedAvgQAActiveTime % 60;
    const avgQAActiveTimeFormatted = `${qaActiveHours}h ${qaActiveMinutes.toString().padStart(2, '0')}m`;

    const responseData = {
      timestamp: new Date(),
      dateFilter, // Include the applied filter

      // Agent Stats
      agent: {
        totalActiveChats,
        totalPendingQueries,
        resolvedToday: totalResolvedToday,
        resolvedInRange: totalResolvedInRange, // Filtered by date range
        totalResolved: totalResolvedQueries,
        avgResponseTime: parseFloat(avgResponseTime),
        avgFirstResponseTime: parseFloat(avgResponseTime), // Alias for UI compatibility
        avgFullResolutionTime: parseFloat((totalCallDurationMinutes / 60).toFixed(1)), // Estimate in hours
        callsMade: totalCallsMade,
        emailsSent: totalEmailsSent,
        totalCallDuration: totalCallDurationMinutes,
        highPriorityQueries,
        avgFeedbackRating: parseFloat(avgAgentFeedbackRating),
        csatScore: avgAgentFeedbackRating ? Math.round((avgAgentFeedbackRating / 5) * 100) : 0, // Convert to percentage
        totalFeedbackCount: totalAgentFeedbackCount,
        // Detailed activity status
        activityStatus: {
          currentlyActive: agentActivityCounts.currentlyActive,
          onBreak: agentActivityCounts.onBreak,
          offline: agentActivityCounts.offline,
          avgActiveTime: avgAgentActiveTimeFormatted,
          totalAgentCount: detailedAgents.length,
        },
      },

      // QA Stats
      qa: {
        totalTicketsReviewed: totalQATicketsReviewed,
        approvedToday: qaApprovedToday,
        approvalRate: parseFloat(qaApprovalRate),
        avgFeedbackRating: parseFloat(avgQAFeedbackRating),
        totalFeedbackCount: totalQAFeedbackCount,
        // Detailed activity status
        activityStatus: {
          currentlyActive: qaActivityCounts.currentlyActive,
          onBreak: qaActivityCounts.onBreak,
          offline: qaActivityCounts.offline,
          avgActiveTime: avgQAActiveTimeFormatted,
          totalQACount: detailedQA.length,
        },
      },

      // TL Stats
      tl: {
        totalEscalationsResovled: totalTLEscalations, // Using generic name for now
        resolvedToday: tlResolvedToday,
        avgFeedbackRating: parseFloat(avgTLFeedbackRating),
        totalFeedbackCount: totalTLFeedbackCount,
        // Detailed activity status
        activityStatus: {
          currentlyActive: tlActivityCounts.currentlyActive,
          onBreak: tlActivityCounts.onBreak,
          offline: tlActivityCounts.offline,
          avgActiveTime: avgTLActiveTimeFormatted,
          totalTLCount: detailedTLs.length,
        },
      },

      // TL Stats
      tl: {
        totalEscalationsResovled: totalTLEscalations, // Using generic name for now
        resolvedToday: tlResolvedToday,
        avgFeedbackRating: parseFloat(avgTLFeedbackRating),
        totalFeedbackCount: totalTLFeedbackCount,
        // Detailed activity status
        activityStatus: {
          currentlyActive: tlActivityCounts.currentlyActive,
          onBreak: tlActivityCounts.onBreak,
          offline: tlActivityCounts.offline,
          avgActiveTime: avgTLActiveTimeFormatted,
          totalTLCount: detailedTLs.length,
        },
      },

      // Overall / Global Stats
      overall: {
        // New structured stats
        queries: globalQueryStats,
        tickets: globalTicketStats,
        systemHealth,
        communication: {
          totalChats,
          totalCalls,
        },
        // Legacy flat stats for compatibility
        totalQueries,
        openQueries,
        resolvedQueries: resolvedQueryCount,
        totalChats,
        totalCalls,
      },

      // System Health
      systemHealth,

      // Individual team details for additional insights
      teamDetails: {
        agents: detailedAgents.map((a) => ({
          id: a._id,
          name: a.name,
          email: a.email,
          status: a.workStatus,
          isActive: a.is_active,
          loginTime: a.login_time,
          breakLogs: a.breakLogs,
        })),
        qa: detailedQA.map((q) => ({
          id: q._id,
          name: q.name,
          email: q.email,
          status: q.workStatus,
          isActive: q.is_active,
          loginTime: q.login_time,
          breakLogs: q.breakLogs,
        })),
        tl: detailedTLs.map((t) => ({
          id: t._id,
          name: t.name,
          email: t.email,
          status: t.workStatus,
          isActive: t.is_active,
          loginTime: t.login_time,
          breakLogs: t.breakLogs,
        })),
      },
    };

    // ========== TOP AGENTS WITH INDIVIDUAL STATS ==========
    // Get individual stats for each agent for dashboard cards (filtered by date)
    const agentPerformanceList = [];

    for (const agent of agents) {
      const resolvedToday = await Query.countDocuments({
        assignedTo: agent._id,
        status: 'Resolved',
        updatedAt: { $gte: today },
      });

      const resolvedInRange = await Query.countDocuments({
        assignedTo: agent._id,
        status: 'Resolved',
        updatedAt: { $gte: startDate },
      });

      const totalResolved = await Query.countDocuments({
        assignedTo: agent._id,
        status: 'Resolved',
      });

      const activeChats = await Query.countDocuments({
        assignedTo: agent._id,
        status: { $in: ['Accepted', 'In Progress', 'Transferred'] },
      });

      // Agent's average response time (filtered by date range)
      const agentQueries = await Query.find({
        assignedTo: agent._id,
        status: 'Resolved',
        updatedAt: { $gte: startDate },
        messages: { $exists: true, $ne: [] },
      }).select('acceptedAt messages');

      let agentResponseTime = 0;
      if (agentQueries.length > 0) {
        let totalTime = 0;
        agentQueries.forEach((q) => {
          if (q.acceptedAt && q.messages.length > 0) {
            const responseTime =
              (new Date(q.messages[0].timestamp) - new Date(q.acceptedAt)) / 1000 / 60;
            totalTime += Math.max(0, responseTime);
          }
        });
        agentResponseTime = (totalTime / agentQueries.length).toFixed(1);
      }

      // Agent's calls (filtered by date range)
      const callsMadeCount = await Room.countDocuments({
        'participants.userId': agent._id,
        status: { $in: ['accepted', 'ended'] },
        startedAt: { $gte: startDate },
      });

      // Agent's emails sent (filtered by date range)
      const emailsSentCount = await Message.countDocuments({
        userId: agent._id,
        source: 'email',
        timestamp: { $gte: startDate },
      });

      // Agent's feedback rating (filtered by date range)
      const agentFeedback = await Query.find({
        assignedTo: agent._id,
        status: 'Resolved',
        updatedAt: { $gte: startDate },
        'feedback.rating': { $exists: true, $ne: null },
      }).select('feedback');

      let agentAvgRating = 0;
      if (agentFeedback.length > 0) {
        const totalRating = agentFeedback.reduce((sum, q) => sum + (q.feedback?.rating || 0), 0);
        agentAvgRating = (totalRating / agentFeedback.length).toFixed(2);
      }

      // Calculate success rate (resolved / total assigned)
      const totalAssigned = await Query.countDocuments({
        assignedTo: agent._id,
      });
      const successRate = totalAssigned > 0 ? Math.round((totalResolved / totalAssigned) * 100) : 0;

      agentPerformanceList.push({
        name: agent.name,
        email: agent.email,
        status: agent.workStatus || 'offline',
        resolvedToday,
        resolvedInRange, // Filtered by date range
        totalResolved,
        activeChats,
        avgResponseTime: parseFloat(agentResponseTime),
        callsMade: callsMadeCount,
        emailsSent: emailsSentCount,
        avgFeedbackRating: parseFloat(agentAvgRating),
        successRate, // Percentage of queries resolved
      });
    }

    // ========== TOP QA MEMBERS WITH INDIVIDUAL STATS ==========
    const qaPerformanceList = [];

    for (const qa of qaMembers) {
      const approvedToday = await Query.countDocuments({
        assignedTo: qa._id,
        status: 'Resolved',
        updatedAt: { $gte: today },
      });

      const approvedInRange = await Query.countDocuments({
        assignedTo: qa._id,
        status: 'Resolved',
        updatedAt: { $gte: startDate },
      });

      const totalReviewed = await Query.countDocuments({
        assignedTo: qa._id,
        status: { $in: ['Resolved', 'Transferred'] },
      });

      const pendingReviews = await Query.countDocuments({
        assignedTo: qa._id,
        status: { $in: ['Pending', 'Accepted', 'In Progress'] },
      });

      const rejectedToday = await Query.countDocuments({
        assignedTo: qa._id,
        status: 'Rejected',
        updatedAt: { $gte: today },
      });

      const approvalRate =
        totalReviewed > 0 ? ((approvedToday / totalReviewed) * 100).toFixed(1) : 0;

      const escalations = await Query.countDocuments({
        assignedTo: qa._id,
        status: 'Escalated',
      });

      // QA's feedback rating
      const qaFeedback = await Query.find({
        assignedTo: qa._id,
        status: 'Resolved',
        'feedback.rating': { $exists: true, $ne: null },
      }).select('feedback');

      let qaAvgRating = 0;
      if (qaFeedback.length > 0) {
        const totalRating = qaFeedback.reduce((sum, q) => sum + (q.feedback?.rating || 0), 0);
        qaAvgRating = (totalRating / qaFeedback.length).toFixed(2);
      }

      qaPerformanceList.push({
        name: qa.name,
        email: qa.email,
        status: qa.workStatus || 'offline',
        approvedToday,
        rejectedToday,
        pendingReviews,
        approvalRate: parseFloat(approvalRate),
        escalationsHandled: escalations,
        avgFeedbackRating: parseFloat(qaAvgRating),
      });
    }

    // ========== TOP TL MEMBERS WITH INDIVIDUAL STATS ==========
    const tlPerformanceList = [];
    for (const tl of tlMembers) {
      const resolvedToday = await Query.countDocuments({
        assignedTo: tl._id,
        status: 'Resolved',
        updatedAt: { $gte: today },
      });

      const totalResolved = await Query.countDocuments({
        assignedTo: tl._id,
        status: 'Resolved',
      });

      // TL's feedback rating
      const tlFeedback = await Query.find({
        assignedTo: tl._id,
        status: 'Resolved',
        'feedback.rating': { $exists: true, $ne: null },
      }).select('feedback');

      let tlAvgRating = 0;
      if (tlFeedback.length > 0) {
        const totalRating = tlFeedback.reduce((sum, q) => sum + (q.feedback?.rating || 0), 0);
        tlAvgRating = (totalRating / tlFeedback.length).toFixed(2);
      }

      tlPerformanceList.push({
        name: tl.name,
        email: tl.email,
        status: tl.workStatus || 'offline',
        resolvedToday,
        totalResolved,
        avgFeedbackRating: parseFloat(tlAvgRating),
      });
    }

    // Add top performers to response (sorted by feedback rating)
    const topAgents = agentPerformanceList.sort(
      (a, b) => b.avgFeedbackRating - a.avgFeedbackRating
    );
    const topQA = qaPerformanceList.sort((a, b) => b.avgFeedbackRating - a.avgFeedbackRating);
    const topTL = tlPerformanceList.sort((a, b) => b.avgFeedbackRating - a.avgFeedbackRating);

    responseData.agent.topAgents = topAgents;
    responseData.qa.topQA = topQA;
    responseData.tl.topTL = topTL;

    console.log('✅ [Admin Dashboard] Stats calculated successfully:', responseData);

    res.status(200).json({
      status: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ Get Admin Dashboard Stats Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch admin dashboard statistics',
      error: error.message,
    });
  }
};

/**
 * Get detailed performance metrics for each agent
 * Returns: individual agent stats, feedback, call duration, emails, etc.
 */
exports.getAgentPerformanceList = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!['Admin', 'SuperAdmin', 'Management'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized access',
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📊 [Agent Performance] Fetching all agents performance...');

    const agents = await User.find({ role: 'Agent' }).select(
      '_id name email workStatus is_active login_time'
    );

    const agentPerformanceList = await Promise.all(
      agents.map(async (agent) => {
        // Resolved queries today
        const resolvedToday = await Query.countDocuments({
          assignedTo: agent._id,
          status: 'Resolved',
          updatedAt: { $gte: today },
        });

        // Total resolved queries
        const totalResolved = await Query.countDocuments({
          assignedTo: agent._id,
          status: 'Resolved',
        });

        // Active chats
        const activeChats = await Query.countDocuments({
          assignedTo: agent._id,
          status: { $in: ['Accepted', 'In Progress', 'Transferred'] },
        });

        // Average response time
        const queriesWithMessages = await Query.find({
          assignedTo: agent._id,
          status: 'Resolved',
          updatedAt: { $gte: today },
          messages: { $exists: true, $ne: [] },
        }).select('acceptedAt messages');

        let avgResponseTime = 0;
        if (queriesWithMessages.length > 0) {
          let totalResponseTime = 0;
          queriesWithMessages.forEach((query) => {
            if (query.acceptedAt && query.messages.length > 0) {
              const firstResponse = query.messages[0];
              const responseTime =
                (new Date(firstResponse.timestamp) - new Date(query.acceptedAt)) / 1000 / 60;
              totalResponseTime += Math.max(0, responseTime);
            }
          });
          avgResponseTime = (totalResponseTime / queriesWithMessages.length).toFixed(1);
        }

        // Calls made
        const callsMade = await Room.countDocuments({
          'participants.userId': agent._id,
          status: { $in: ['accepted', 'ended'] },
          startedAt: { $gte: today },
        });

        // Total call duration
        const callsData = await Room.find({
          'participants.userId': agent._id,
          status: { $in: ['accepted', 'ended'] },
          startedAt: { $gte: today },
        }).select('duration');

        let totalCallDuration = 0;
        callsData.forEach((call) => {
          if (call.duration) {
            totalCallDuration += call.duration;
          }
        });
        totalCallDuration = Math.floor(totalCallDuration / 60);

        // Emails sent
        const emailsSent = await Message.countDocuments({
          userId: agent._id,
          source: 'email',
          timestamp: { $gte: today },
        });

        // Customer feedback
        const feedbackQueries = await Query.find({
          assignedTo: agent._id,
          status: 'Resolved',
          'feedback.rating': { $exists: true, $ne: null },
        }).select('feedback customerName');

        let avgFeedbackRating = 0;
        if (feedbackQueries.length > 0) {
          const totalRating = feedbackQueries.reduce((sum, query) => {
            return sum + (query.feedback?.rating || 0);
          }, 0);
          avgFeedbackRating = (totalRating / feedbackQueries.length).toFixed(2);
        }

        // High priority queries
        const highPriorityQueries = await Query.countDocuments({
          assignedTo: agent._id,
          priority: 'High',
          status: { $in: ['Pending', 'Accepted', 'In Progress'] },
        });

        return {
          agent: {
            id: agent._id,
            name: agent.name,
            email: agent.email,
            status: agent.workStatus,
            isActive: agent.is_active,
            loginTime: agent.login_time,
          },
          stats: {
            resolvedToday,
            totalResolved,
            activeChats,
            avgResponseTime: parseFloat(avgResponseTime),
            callsMade,
            totalCallDuration,
            emailsSent,
            highPriorityQueries,
            avgFeedbackRating: parseFloat(avgFeedbackRating),
            feedbackCount: feedbackQueries.length,
          },
          feedbackDetails: feedbackQueries.map((q) => ({
            feedbackRating: q.feedback?.rating,
            feedbackComment: q.feedback?.comment,
            customerName: q.customerName,
            queryId: q._id,
            date: q.updatedAt,
          })),
        };
      })
    );

    console.log('✅ [Agent Performance] Data retrieved successfully');

    res.status(200).json({
      status: true,
      data: agentPerformanceList,
    });
  } catch (error) {
    console.error('❌ Get Agent Performance List Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch agent performance list',
      error: error.message,
    });
  }
};

/**
 * Get detailed performance metrics for each QA member
 * Returns: individual QA stats, feedback, approval rate, etc.
 */
exports.getQAPerformanceList = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!['Admin', 'SuperAdmin', 'Management'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized access',
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📊 [QA Performance] Fetching all QA members performance...');

    const qaMembers = await User.find({ role: 'QA' }).select(
      '_id name email workStatus is_active login_time'
    );

    const qaPerformanceList = await Promise.all(
      qaMembers.map(async (qa) => {
        // Tickets reviewed
        const ticketsReviewed = await Query.countDocuments({
          assignedTo: qa._id,
          status: { $in: ['Resolved', 'Transferred'] },
        });

        // Approved today (Resolved)
        const approvedToday = await Query.countDocuments({
          assignedTo: qa._id,
          status: 'Resolved',
          updatedAt: { $gte: today },
        });

        // Rejected today (Transferred)
        const rejectedToday = await Query.countDocuments({
          assignedTo: qa._id,
          status: 'Transferred',
          updatedAt: { $gte: today },
        });

        // Approval rate
        const approvalRate =
          ticketsReviewed > 0 ? ((approvedToday / ticketsReviewed) * 100).toFixed(1) : 0;

        // Pending reviews
        const pendingReviews = await Query.countDocuments({
          assignedTo: qa._id,
          status: { $in: ['Pending', 'Accepted', 'In Progress'] },
        });

        // Average response time (QA focus: time to review)
        const reviewedQueries = await Query.find({
          assignedTo: qa._id,
          status: { $in: ['Resolved', 'Transferred'] },
          updatedAt: { $gte: today },
        }).select('acceptedAt updatedAt');

        let avgReviewTime = 0;
        if (reviewedQueries.length > 0) {
          let totalReviewTime = 0;
          reviewedQueries.forEach((query) => {
            if (query.acceptedAt && query.updatedAt) {
              const reviewTime =
                (new Date(query.updatedAt) - new Date(query.acceptedAt)) / 1000 / 60;
              totalReviewTime += Math.max(0, reviewTime);
            }
          });
          avgReviewTime = (totalReviewTime / reviewedQueries.length).toFixed(1);
        }

        // High priority escalations handled
        const escalationsHandled = await Query.countDocuments({
          assignedTo: qa._id,
          priority: 'High',
          status: { $in: ['Resolved', 'Transferred'] },
        });

        // Customer feedback
        const feedbackQueries = await Query.find({
          assignedTo: qa._id,
          status: 'Resolved',
          'feedback.rating': { $exists: true, $ne: null },
        }).select('feedback customerName');

        let avgFeedbackRating = 0;
        if (feedbackQueries.length > 0) {
          const totalRating = feedbackQueries.reduce((sum, query) => {
            return sum + (query.feedback?.rating || 0);
          }, 0);
          avgFeedbackRating = (totalRating / feedbackQueries.length).toFixed(2);
        }

        return {
          qa: {
            id: qa._id,
            name: qa.name,
            email: qa.email,
            status: qa.workStatus,
            isActive: qa.is_active,
            loginTime: qa.login_time,
          },
          stats: {
            ticketsReviewed,
            approvedToday,
            rejectedToday,
            approvalRate: parseFloat(approvalRate),
            pendingReviews,
            avgReviewTime: parseFloat(avgReviewTime),
            escalationsHandled,
            avgFeedbackRating: parseFloat(avgFeedbackRating),
            feedbackCount: feedbackQueries.length,
          },
          feedbackDetails: feedbackQueries.map((q) => ({
            feedbackRating: q.feedback?.rating,
            feedbackComment: q.feedback?.comment,
            customerName: q.customerName,
            queryId: q._id,
            date: q.updatedAt,
          })),
        };
      })
    );

    console.log('✅ [QA Performance] Data retrieved successfully');

    res.status(200).json({
      status: true,
      data: qaPerformanceList,
    });
  } catch (error) {
    console.error('❌ Get QA Performance List Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch QA performance list',
      error: error.message,
    });
  }
};

/**
 * Get agent's customer feedback data (recent and trends)
 */
exports.getAgentFeedback = async (req, res) => {
  try {
    const agentId = req.user?.id;
    console.log('📊 [Agent Feedback] Fetching for agent:', agentId);

    // Get all queries with feedback for this agent (no date restriction)
    const queriesWithFeedback = await Query.find({
      assignedTo: agentId,
      status: 'Resolved',
      'feedback.rating': { $exists: true, $ne: null },
    })
      .select('feedback customerName petitionId updatedAt')
      .sort({ 'feedback.submittedAt': -1 })
      .limit(10);

    console.log(`Found ${queriesWithFeedback.length} queries with feedback`);

    // Get ALL feedback grouped by date (no date filtering)
    const feedbackTrend = await Query.aggregate([
      {
        $match: {
          assignedTo: agentId,
          status: 'Resolved',
          'feedback.rating': { $exists: true, $ne: null },
        },
      },
      {
        $addFields: {
          feedbackDate: {
            $ifNull: ['$feedback.submittedAt', '$updatedAt'],
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$feedbackDate',
            },
          },
          avgRating: { $avg: '$feedback.rating' },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    console.log('📈 All feedback dates from DB:', JSON.stringify(feedbackTrend, null, 2));

    // Take the last 7 dates (or fewer if less data exists)
    const recentDates = feedbackTrend.slice(-7);
    const displayTrend = recentDates.map((item) => {
      const date = new Date(item._id + 'T00:00:00');
      return {
        date: item._id,
        day: date.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + date.getDate(),
        avgRating: parseFloat(item.avgRating.toFixed(2)),
      };
    });

    console.log('📊 Display trend (last 7 dates):', JSON.stringify(displayTrend, null, 2));

    // Calculate overall average
    const overallAvg =
      queriesWithFeedback.length > 0
        ? (
            queriesWithFeedback.reduce((sum, q) => sum + (q.feedback?.rating || 0), 0) /
            queriesWithFeedback.length
          ).toFixed(2)
        : 0;

    const responseData = {
      recentFeedback: queriesWithFeedback.map((q) => ({
        rating: q.feedback?.rating,
        comment: q.feedback?.comment || '',
        customerName: q.customerName || 'Anonymous',
        petitionId: q.petitionId,
        submittedAt: q.feedback?.submittedAt,
      })),
      trend: displayTrend,
      overallAverage: parseFloat(overallAvg),
      totalFeedbackCount: queriesWithFeedback.length,
    };

    console.log('✅ [Agent Feedback] Response:', JSON.stringify(responseData, null, 2));

    res.status(200).json({
      status: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ Get Agent Feedback Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch agent feedback',
      error: error.message,
    });
  }
};

/**
 * Get admin's comprehensive customer feedback data
 * Returns: All feedback with rating distribution, trends, and CSAT scores
 */
exports.getAdminFeedback = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!['Admin', 'SuperAdmin', 'Management'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized access',
      });
    }

    // Get date filter from query params: today, week, month, all
    const dateFilter = req.query.dateFilter || 'week';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate date range based on filter
    let startDate = new Date(today);
    switch (dateFilter) {
      case 'today':
        startDate = today;
        break;
      case 'week':
        startDate.setDate(today.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(today.getMonth() - 1);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
      default:
        startDate.setDate(today.getDate() - 7); // Default to week
    }

    console.log(
      `📊 [Admin Feedback] Fetching feedback data for filter: ${dateFilter} (from ${startDate.toISOString()})...`
    );

    // Get all agents
    const agents = await User.find({ role: 'Agent' }).select('_id name email');
    const agentIds = agents.map((a) => a._id);

    // Get all queries with feedback (filtered by date)
    const queriesWithFeedback = await Query.find({
      status: 'Resolved',
      'feedback.rating': { $exists: true, $ne: null },
      updatedAt: { $gte: startDate },
    })
      .select('feedback customerName petitionId updatedAt assignedTo')
      .sort({ 'feedback.submittedAt': -1 })
      .populate('assignedTo', 'name email')
      .limit(100);

    console.log(`Found ${queriesWithFeedback.length} queries with feedback`);

    // Calculate rating distribution
    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    queriesWithFeedback.forEach((q) => {
      const rating = Math.round(q.feedback?.rating || 0);
      if (rating >= 1 && rating <= 5) {
        ratingDistribution[rating]++;
      }
    });

    // Get ALL feedback grouped by date (filtered by date range)
    const feedbackTrend = await Query.aggregate([
      {
        $match: {
          status: 'Resolved',
          'feedback.rating': { $exists: true, $ne: null },
          updatedAt: { $gte: startDate },
        },
      },
      {
        $addFields: {
          feedbackDate: {
            $ifNull: ['$feedback.submittedAt', '$updatedAt'],
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$feedbackDate',
            },
          },
          avgRating: { $avg: '$feedback.rating' },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Fill in missing days with 0
    const trendData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayData = feedbackTrend.find((item) => item._id === dateStr);

      trendData.push({
        date: dateStr,
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        csat: dayData ? Math.round((dayData.avgRating / 5) * 100) : 0,
        avgRating: dayData ? parseFloat(dayData.avgRating.toFixed(2)) : 0,
        count: dayData ? dayData.count : 0,
      });
    }

    // Get agent-wise feedback stats (filtered by date range)
    const agentFeedbackStats = await Query.aggregate([
      {
        $match: {
          assignedTo: { $in: agentIds },
          status: 'Resolved',
          'feedback.rating': { $exists: true, $ne: null },
          updatedAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: '$assignedTo',
          avgRating: { $avg: '$feedback.rating' },
          totalFeedback: { $sum: 1 },
        },
      },
      {
        $sort: { avgRating: -1 },
      },
    ]);

    // Populate agent details
    const agentFeedbackData = [];
    for (const stat of agentFeedbackStats) {
      const agent = agents.find((a) => a._id.toString() === stat._id.toString());
      if (agent) {
        agentFeedbackData.push({
          agentId: agent._id,
          name: agent.name,
          email: agent.email,
          avgRating: parseFloat(stat.avgRating.toFixed(2)),
          csat: Math.round((stat.avgRating / 5) * 100),
          totalFeedback: stat.totalFeedback,
        });
      }
    }

    // Calculate overall average
    const overallAvg =
      queriesWithFeedback.length > 0
        ? (
            queriesWithFeedback.reduce((sum, q) => sum + (q.feedback?.rating || 0), 0) /
            queriesWithFeedback.length
          ).toFixed(2)
        : 0;

    const overallCSAT = Math.round((overallAvg / 5) * 100);

    const responseData = {
      overall: {
        avgRating: parseFloat(overallAvg),
        csat: overallCSAT,
        totalFeedback: queriesWithFeedback.length,
      },
      ratingDistribution,
      trend: trendData,
      agentStats: agentFeedbackData,
      recentFeedback: queriesWithFeedback.slice(0, 20).map((q) => ({
        rating: q.feedback?.rating,
        comment: q.feedback?.comment || '',
        customerName: q.customerName || 'Anonymous',
        petitionId: q.petitionId,
        submittedAt: q.feedback?.submittedAt || q.updatedAt,
        agent: q.assignedTo ? { name: q.assignedTo.name, email: q.assignedTo.email } : null,
      })),
    };

    console.log('✅ [Admin Feedback] Response generated successfully');

    res.status(200).json({
      status: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ Get Admin Feedback Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch admin feedback',
      error: error.message,
    });
  }
};
