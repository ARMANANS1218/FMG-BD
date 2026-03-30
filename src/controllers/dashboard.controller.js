const Query = require('../models/Query');
const Room = require('../models/Room');
const Message = require('../models/Message');
const Staff = require('../models/Staff');
const Attendance = require('../models/Attendance');
const QueryEvaluation = require('../models/QueryEvaluation');
const TicketEvaluation = require('../models/TicketEvaluation');
const EmailTicket = require('../email-ticketing/models/Ticket');
const moment = require('moment-timezone');

/**
 * Get comprehensive dashboard statistics for Agent
 * Returns: active chats, resolved today, pending, response time, calls, emails, screenshots, etc.
 */
exports.getAgentDashboardStats = async (req, res) => {
  try {
    const agentId = req.user?.id;
    // IST start of day
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

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
      userRole: req.user?.role || 'Agent',
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
    // IST start of day
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

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

    const allTeamMembers = await Staff.find(teamFilter).select('_id');
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
        userRole: req.user?.role || 'QA',
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

    const user = await Staff.findById(userId).select('role');

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

    if (user.role === 'QA' || user.role === 'TL' || user.role === 'Dev') {
      return exports.getQADashboardStats(req, res);
    }

    // Management role gets lightweight summary dashboard
    if (user.role === 'Management') {
      return exports.getManagementDashboardSummary(req, res);
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
 * Get lightweight management dashboard summary
 * Returns only fields currently rendered by ManagementDashboard UI
 */
exports.getManagementDashboardSummary = async (req, res) => {
  try {
    const { role, organizationId } = req.user || {};

    if (!['Management', 'Admin'].includes(role)) {
      return res.status(403).json({
        status: false,
        message: 'Access denied for management dashboard summary',
      });
    }

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const todayStart = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const tomorrowStart = moment(todayStart).add(1, 'day').toDate();

    const targetRoles = ['Agent', 'QA', 'TL'];
    const userFilter = { organizationId, role: { $in: targetRoles } };

    const employees = await Staff.find(userFilter)
      .select('_id name role workStatus is_active isBlocked profileImage')
      .sort({ createdAt: -1 })
      .lean();

    const agentIds = employees.filter((e) => e.role === 'Agent').map((e) => e._id);
    const qaIds = employees.filter((e) => e.role === 'QA').map((e) => e._id);
    const tlIds = employees.filter((e) => e.role === 'TL').map((e) => e._id);

    const [
      activeChats,
      resolvedToday,
      pendingQueries,
      totalResolved,
      totalEscalatedAgent,
      todayEscalatedAgent,
      totalEscalatedQA,
      todayEscalatedQA,
      escalatedResolvedQA,
      totalResolvedQA,
      totalEscalatedTL,
      todayEscalatedTL,
      escalatedResolvedTL,
      totalResolvedTL,
      attendanceToday,
    ] = await Promise.all([
      Query.countDocuments({ organizationId, status: { $in: ['Accepted', 'In Progress', 'Transferred'] } }),
      Query.countDocuments({ organizationId, status: 'Resolved', updatedAt: { $gte: todayStart } }),
      Query.countDocuments({ organizationId, status: 'Pending' }),
      Query.countDocuments({ organizationId, status: 'Resolved' }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: agentIds } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: agentIds }, updatedAt: { $gte: todayStart } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: qaIds } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: qaIds }, updatedAt: { $gte: todayStart } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: qaIds }, status: 'Resolved' }),
      Query.countDocuments({ organizationId, status: 'Resolved', resolvedBy: { $in: qaIds } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: tlIds } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: tlIds }, updatedAt: { $gte: todayStart } }),
      Query.countDocuments({ organizationId, 'transferHistory.fromAgent': { $in: tlIds }, status: 'Resolved' }),
      Query.countDocuments({ organizationId, status: 'Resolved', resolvedBy: { $in: tlIds } }),
      Attendance.aggregate([
        {
          $match: {
            organizationId,
            date: { $gte: todayStart, $lt: tomorrowStart },
          },
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const roleCounts = {
      Agent: agentIds.length,
      QA: qaIds.length,
      TL: tlIds.length,
    };

    const workforce = {
      activeEmployees: employees.filter((e) => e.is_active && e.workStatus === 'active').length,
      blockedEmployees: employees.filter((e) => e.isBlocked).length,
      offlineEmployees: employees.filter((e) => e.workStatus === 'offline').length,
    };

    const presentCount = attendanceToday
      .filter((a) => ['Present', 'Late', 'On Time'].includes(a._id))
      .reduce((sum, a) => sum + a.count, 0);
    const halfDayCount = attendanceToday
      .filter((a) => a._id === 'Half Day')
      .reduce((sum, a) => sum + a.count, 0);

    const totalEmployees = employees.length;
    const attendanceMarked = attendanceToday.reduce((sum, a) => sum + a.count, 0);
    const absentCount = Math.max(0, totalEmployees - attendanceMarked);

    const systemHealth = {
      totalUsers: totalEmployees,
      agentCount: roleCounts.Agent || 0,
      qaCount: roleCounts.QA || 0,
      tlCount: roleCounts.TL || 0,
    };

    return res.status(200).json({
      status: true,
      data: {
        systemHealth,
        workforce: {
          activeEmployees: workforce.activeEmployees,
          blockedEmployees: workforce.blockedEmployees,
          offlineEmployees: workforce.offlineEmployees,
        },
        attendanceOverview: {
          present: presentCount,
          absent: absentCount,
          halfDay: halfDayCount,
        },
        agent: {
          totalActiveChats: activeChats,
          resolvedToday,
          totalPendingQueries: pendingQueries,
          totalResolved,
          totalEscalated: totalEscalatedAgent,
          todayEscalated: todayEscalatedAgent,
        },
        overall: {
          queries: {
            resolved: totalResolved,
          },
        },
        qa: {
          totalPending: pendingQueries,
          totalResolved: totalResolvedQA,
          totalEscalated: totalEscalatedQA,
          todayEscalated: todayEscalatedQA,
          escalatedResolved: escalatedResolvedQA,
          totalTicketsReviewed: totalResolvedQA,
          approvedToday: resolvedToday,
        },
        tl: {
          totalPending: pendingQueries,
          totalResolved: totalResolvedTL,
          totalEscalated: totalEscalatedTL,
          todayEscalated: todayEscalatedTL,
          escalatedResolved: escalatedResolvedTL,
        },
        employees,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Get Management Dashboard Summary Error:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch management dashboard summary',
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
    const user = await Staff.findById(userId).select('role');

    // ✅ Fixed: Array must match JavaScript's getDay() order (0=Sun, 1=Mon, ... 6=Sat)
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekData = [];

    // Use IST for "today"
    const todayIST = moment().tz('Asia/Kolkata').startOf('day');

    for (let i = 6; i >= 0; i--) {
      // Clone and subtract days
      const dateMoment = todayIST.clone().subtract(i, 'days');
      const nextDateMoment = dateMoment.clone().add(1, 'days');

      const date = dateMoment.toDate();
      const nextDate = nextDateMoment.toDate();

      // Default metrics
      let resolvedCount = 0;
      let reviewCount = 0;
      let handledCount = 0;
      let escalatedCount = 0;

      if (user.role === 'QA' || user.role === 'Agent' || user.role === 'TL' || user.role === 'Dev') {
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
    const user = await Staff.findById(userId).select('role');

    const trendsData = [];
    // IST today
    const todayIST = moment().tz('Asia/Kolkata').startOf('day');

    for (let i = 29; i >= 0; i--) {
      const dateMoment = todayIST.clone().subtract(i, 'days');
      const nextDateMoment = dateMoment.clone().add(1, 'days');

      const date = dateMoment.toDate();
      const nextDate = nextDateMoment.toDate();

      let resolved = 0;
      let pending = 0;

      if (user.role === 'QA' || user.role === 'Agent' || user.role === 'TL' || user.role === 'Dev') {
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
    const dateFilter = req.query.dateFilter || 'week';
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const todayMoment = moment(today);
    const organizationId = req.user?.organizationId;

    let startDate;
    switch (dateFilter) {
      case 'today':
        startDate = todayMoment.toDate();
        break;
      case 'week':
        startDate = todayMoment.clone().subtract(7, 'days').toDate();
        break;
      case 'month':
        startDate = todayMoment.clone().subtract(1, 'months').toDate();
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate = todayMoment.clone().subtract(7, 'days').toDate();
    }

    // Legacy compatibility: older records may not have organization fields populated.
    // Include those docs so Month/All-Time dashboards don't silently drop historical data.
    const queryOrgFilter = organizationId
      ? {
          $or: [
            { organizationId },
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        }
      : {};
    const userOrgFilter = organizationId
      ? {
          $or: [
            { organizationId },
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        }
      : {};
    const emailTicketOrgFilter = organizationId
      ? {
          $or: [
            { organization: organizationId },
            { organization: { $exists: false } },
            { organization: null },
          ],
        }
      : {};

    const Customer = require('../models/Customer');

    const [agents, qaMembers, tlMembers, customerCount] = await Promise.all([
      Staff.find({ role: 'Agent', ...userOrgFilter })
        .select(
          '_id name email is_active workStatus login_time breakLogs accumulatedActiveTime lastStatusChangeTime'
        )
        .lean(),
      Staff.find({ role: 'QA', ...userOrgFilter })
        .select(
          '_id name email is_active workStatus login_time breakLogs accumulatedActiveTime lastStatusChangeTime'
        )
        .lean(),
      Staff.find({ role: 'TL', ...userOrgFilter }).select('_id name email is_active workStatus').lean(),
      Customer.countDocuments(organizationId ? { organizationId } : {}),
    ]);

    const agentIds = agents.map((a) => a._id);
    const qaIds = qaMembers.map((q) => q._id);
    const tlIds = tlMembers.map((t) => t._id);
    const now = new Date();
    const last7Days = todayMoment.clone().subtract(7, 'days').toDate();

    const [
      totalActiveChats,
      totalPendingQueries,
      totalResolvedInRange,
      totalResolvedToday,
      totalResolvedQueries,
      totalCallsMade,
      totalEmailsSent,
      highPriorityQueries,
      totalQATicketsReviewed,
      qaApprovedToday,
      totalQueries,
      openQueries,
      resolvedQueryCount,
      totalCalls,
      queryPending,
      queryAccepted,
      queryInProgress,
      queryResolved,
      queryTransferred,
      queryExpired,
      ticketTotal,
      ticketOpen,
      ticketPending,
      ticketClosed,
      ticketUnassigned,
      totalEscalatedAgent,
      todayEscalatedAgent,
      totalEscalatedQA,
      totalEscalatedTL,
      todayEscalatedQA,
      todayEscalatedTL,
      escalatedResolvedQA,
      escalatedResolvedTL,
      totalResolvedQA,
      totalResolvedTL,
      queryTrend,
      resolvedTrend,
      queryCategoryStats,
      callDurationAgg,
      avgResponseAgg,
      agentFeedbackAgg,
      qaFeedbackAgg,
      topAgentAgg,
      topQAAgg,
    ] = await Promise.all([
      Query.countDocuments({
        ...queryOrgFilter,
        assignedTo: { $in: agentIds },
        status: { $in: ['Accepted', 'In Progress', 'Transferred'] },
      }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Pending' }),
      Query.countDocuments({
        ...queryOrgFilter,
        resolvedBy: { $in: agentIds },
        status: 'Resolved',
        updatedAt: { $gte: startDate },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        resolvedBy: { $in: agentIds },
        status: 'Resolved',
        updatedAt: { $gte: today },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        resolvedBy: { $in: agentIds },
        status: 'Resolved',
      }),
      Room.countDocuments({
        'participants.userId': { $in: agentIds },
        status: { $in: ['accepted', 'ended'] },
        startedAt: { $gte: startDate },
      }),
      Message.countDocuments({
        userId: { $in: agentIds },
        source: 'email',
        timestamp: { $gte: startDate },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        assignedTo: { $in: agentIds },
        priority: 'High',
        status: { $in: ['Pending', 'Accepted', 'In Progress'] },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        assignedTo: { $in: qaIds },
        status: { $in: ['Resolved', 'Transferred'] },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        assignedTo: { $in: qaIds },
        status: 'Resolved',
        updatedAt: { $gte: today },
      }),
      Query.countDocuments({ ...queryOrgFilter }),
      Query.countDocuments({
        ...queryOrgFilter,
        status: { $in: ['Pending', 'Accepted', 'In Progress'] },
      }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Resolved' }),
      Room.countDocuments({ status: { $in: ['accepted', 'ended'] } }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Pending' }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Accepted' }),
      Query.countDocuments({ ...queryOrgFilter, status: 'In Progress' }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Resolved' }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Transferred' }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Expired' }),
      EmailTicket.countDocuments(emailTicketOrgFilter),
      EmailTicket.countDocuments({ ...emailTicketOrgFilter, status: 'open' }),
      EmailTicket.countDocuments({ ...emailTicketOrgFilter, status: 'pending' }),
      EmailTicket.countDocuments({ ...emailTicketOrgFilter, status: 'closed' }),
      EmailTicket.countDocuments({ ...emailTicketOrgFilter, assignedTo: null, status: { $ne: 'closed' } }),
      Query.countDocuments({ ...queryOrgFilter, 'transferHistory.fromAgent': { $in: agentIds } }),
      Query.countDocuments({
        ...queryOrgFilter,
        'transferHistory.fromAgent': { $in: agentIds },
        updatedAt: { $gte: today },
      }),
      Query.countDocuments({ ...queryOrgFilter, 'transferHistory.fromAgent': { $in: qaIds } }),
      Query.countDocuments({ ...queryOrgFilter, 'transferHistory.fromAgent': { $in: tlIds } }),
      Query.countDocuments({
        ...queryOrgFilter,
        'transferHistory.fromAgent': { $in: qaIds },
        updatedAt: { $gte: today },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        'transferHistory.fromAgent': { $in: tlIds },
        updatedAt: { $gte: today },
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        'transferHistory.fromAgent': { $in: qaIds },
        status: 'Resolved',
      }),
      Query.countDocuments({
        ...queryOrgFilter,
        'transferHistory.fromAgent': { $in: tlIds },
        status: 'Resolved',
      }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Resolved', resolvedBy: { $in: qaIds } }),
      Query.countDocuments({ ...queryOrgFilter, status: 'Resolved', resolvedBy: { $in: tlIds } }),
      Query.aggregate([
        { $match: { ...queryOrgFilter, createdAt: { $gte: last7Days } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Query.aggregate([
        { $match: { ...queryOrgFilter, status: 'Resolved', updatedAt: { $gte: last7Days } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Query.aggregate([
        { $match: queryOrgFilter },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Room.aggregate([
        {
          $match: {
            'participants.userId': { $in: agentIds },
            status: { $in: ['accepted', 'ended'] },
            startedAt: { $gte: startDate },
          },
        },
        { $group: { _id: null, totalDurationSeconds: { $sum: { $ifNull: ['$duration', 0] } } } },
      ]),
      Query.aggregate([
        {
          $match: {
            ...queryOrgFilter,
            assignedTo: { $in: agentIds },
            status: 'Resolved',
            updatedAt: { $gte: startDate },
            acceptedAt: { $exists: true, $ne: null },
            'messages.0.timestamp': { $exists: true },
          },
        },
        // For very wide ranges, cap analyzed docs to keep endpoint responsive.
        ...(dateFilter === 'all' || dateFilter === 'month'
          ? [{ $sort: { updatedAt: -1 } }, { $limit: 5000 }]
          : []),
        {
          $project: {
            responseMinutes: {
              $divide: [
                { $subtract: [{ $arrayElemAt: ['$messages.timestamp', 0] }, '$acceptedAt'] },
                1000 * 60,
              ],
            },
          },
        },
        { $match: { responseMinutes: { $gte: 0 } } },
        { $group: { _id: null, avgResponseTime: { $avg: '$responseMinutes' } } },
      ]),
      Query.aggregate([
        {
          $match: {
            ...queryOrgFilter,
            assignedTo: { $in: agentIds },
            status: 'Resolved',
            updatedAt: { $gte: startDate },
            'feedback.rating': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$feedback.rating' },
            totalFeedback: { $sum: 1 },
          },
        },
      ]),
      Query.aggregate([
        {
          $match: {
            ...queryOrgFilter,
            assignedTo: { $in: qaIds },
            status: 'Resolved',
            'feedback.rating': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$feedback.rating' },
            totalFeedback: { $sum: 1 },
          },
        },
      ]),
      Query.aggregate([
        { $match: { ...queryOrgFilter, assignedTo: { $in: agentIds } } },
        {
          $group: {
            _id: '$assignedTo',
            totalAssigned: { $sum: 1 },
            resolvedToday: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'Resolved'] },
                      { $gte: ['$updatedAt', today] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            resolvedInRange: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'Resolved'] },
                      { $gte: ['$updatedAt', startDate] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalResolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
            activeChats: {
              $sum: {
                $cond: [{ $in: ['$status', ['Accepted', 'In Progress', 'Transferred']] }, 1, 0],
              },
            },
            feedbackSum: { $sum: { $ifNull: ['$feedback.rating', 0] } },
            feedbackCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$feedback.rating', null] },
                      { $gte: ['$updatedAt', startDate] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Query.aggregate([
        { $match: { ...queryOrgFilter, assignedTo: { $in: qaIds } } },
        {
          $group: {
            _id: '$assignedTo',
            approvedToday: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'Resolved'] },
                      { $gte: ['$updatedAt', today] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            rejectedToday: {
              $sum: {
                $cond: [
                  {
                    $and: [{ $eq: ['$status', 'Rejected'] }, { $gte: ['$updatedAt', today] }],
                  },
                  1,
                  0,
                ],
              },
            },
            pendingReviews: {
              $sum: {
                $cond: [{ $in: ['$status', ['Pending', 'Accepted', 'In Progress']] }, 1, 0],
              },
            },
            totalReviewed: {
              $sum: { $cond: [{ $in: ['$status', ['Resolved', 'Transferred']] }, 1, 0] },
            },
            escalationsHandled: { $sum: { $cond: [{ $eq: ['$status', 'Escalated'] }, 1, 0] } },
            feedbackSum: { $sum: { $ifNull: ['$feedback.rating', 0] } },
            feedbackCount: {
              $sum: {
                $cond: [{ $ne: ['$feedback.rating', null] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const totalCallDurationSeconds = callDurationAgg?.[0]?.totalDurationSeconds || 0;
    const totalCallDurationMinutes = Math.floor(totalCallDurationSeconds / 60);
    const avgResponseTime = Number((avgResponseAgg?.[0]?.avgResponseTime || 0).toFixed(1));
    const avgAgentFeedbackRating = Number((agentFeedbackAgg?.[0]?.avgRating || 0).toFixed(2));
    const totalAgentFeedbackCount = agentFeedbackAgg?.[0]?.totalFeedback || 0;
    const avgQAFeedbackRating = Number((qaFeedbackAgg?.[0]?.avgRating || 0).toFixed(2));
    const totalQAFeedbackCount = qaFeedbackAgg?.[0]?.totalFeedback || 0;

    const qaApprovalRate =
      totalQATicketsReviewed > 0 ? Number(((qaApprovedToday / totalQATicketsReviewed) * 100).toFixed(1)) : 0;

    const activeUsers = [...agents, ...qaMembers, ...tlMembers].filter((u) => u.is_active).length;
    const totalUsers = agents.length + qaMembers.length + tlMembers.length;
    const totalChats = totalQueries;

    const systemHealth = {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      agentCount: agents.length,
      qaCount: qaMembers.length,
      tlCount: tlMembers.length,
      activeAgents: agents.filter((a) => a.is_active).length,
      activeQA: qaMembers.filter((q) => q.is_active).length,
      customerCount,
    };

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

    const conversationTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = moment(today).subtract(i, 'days').toDate();
      const dateStr = date.toISOString().split('T')[0];
      conversationTrend.push(
        conversationTrendMap[dateStr] || { date: dateStr, new: 0, resolved: 0 }
      );
    }

    const globalQueryStats = {
      total: totalQueries,
      pending: queryPending,
      accepted: queryAccepted,
      inProgress: queryInProgress,
      resolved: queryResolved,
      transferred: queryTransferred,
      expired: queryExpired,
      open: queryPending + queryAccepted + queryInProgress,
      trend: queryTrend.map((item) => ({ date: item._id, count: item.count })),
      conversationTrend,
      categories: queryCategoryStats.map((item) => ({
        name: item._id || 'Uncategorized',
        value: item.count,
      })),
    };

    const globalTicketStats = {
      total: ticketTotal,
      open: ticketOpen,
      pending: ticketPending,
      closed: ticketClosed,
      unassigned: ticketUnassigned,
    };

    const computeAvgActiveTime = (users) => {
      if (!users?.length) return '0h 0m';
      const totalMins = users.reduce((sum, user) => {
        let activeTime = user.accumulatedActiveTime || 0;
        if (
          (user.workStatus === 'active' || user.workStatus === 'busy') &&
          user.lastStatusChangeTime
        ) {
          const currentSessionTime = (now - new Date(user.lastStatusChangeTime)) / 1000 / 60;
          activeTime += Math.max(0, currentSessionTime);
        }
        return sum + activeTime;
      }, 0);
      const avgMins = totalMins / users.length;
      return `${Math.floor(avgMins / 60)}h ${Math.floor(avgMins % 60)}m`;
    };

    const agentActivityCounts = {
      currentlyActive: agents.filter((a) => a.workStatus === 'active').length,
      onBreak: agents.filter((a) => a.workStatus === 'break').length,
      offline: agents.filter((a) => a.workStatus === 'offline').length,
    };

    const qaActivityCounts = {
      currentlyActive: qaMembers.filter((q) => q.workStatus === 'active').length,
      onBreak: qaMembers.filter((q) => q.workStatus === 'break').length,
      offline: qaMembers.filter((q) => q.workStatus === 'offline').length,
    };

    const totalOnBreak = agentActivityCounts.onBreak + qaActivityCounts.onBreak;
    const avgAgentActiveTimeFormatted = computeAvgActiveTime(agents);
    const avgQAActiveTimeFormatted = computeAvgActiveTime(qaMembers);

    const agentMap = new Map(agents.map((a) => [String(a._id), a]));
    const qaMap = new Map(qaMembers.map((q) => [String(q._id), q]));

    const topAgents = topAgentAgg
      .map((row) => {
        const user = agentMap.get(String(row._id));
        const feedbackCount = row.feedbackCount || 0;
        const avgFeedbackRating = feedbackCount > 0 ? Number((row.feedbackSum / feedbackCount).toFixed(2)) : 0;
        const successRate = row.totalAssigned > 0 ? Math.round((row.totalResolved / row.totalAssigned) * 100) : 0;
        return {
          name: user?.name || 'Unknown',
          email: user?.email || '',
          status: user?.workStatus || 'offline',
          resolvedToday: row.resolvedToday || 0,
          resolvedInRange: row.resolvedInRange || 0,
          totalResolved: row.totalResolved || 0,
          activeChats: row.activeChats || 0,
          avgResponseTime: avgResponseTime,
          callsMade: 0,
          emailsSent: 0,
          avgFeedbackRating,
          successRate,
        };
      })
      .sort((a, b) => b.avgFeedbackRating - a.avgFeedbackRating);

    const topQA = topQAAgg
      .map((row) => {
        const user = qaMap.get(String(row._id));
        const feedbackCount = row.feedbackCount || 0;
        const avgFeedbackRating = feedbackCount > 0 ? Number((row.feedbackSum / feedbackCount).toFixed(2)) : 0;
        const approvalRate = row.totalReviewed > 0 ? Number(((row.approvedToday / row.totalReviewed) * 100).toFixed(1)) : 0;
        return {
          name: user?.name || 'Unknown',
          email: user?.email || '',
          status: user?.workStatus || 'offline',
          approvedToday: row.approvedToday || 0,
          rejectedToday: row.rejectedToday || 0,
          pendingReviews: row.pendingReviews || 0,
          approvalRate,
          escalationsHandled: row.escalationsHandled || 0,
          avgFeedbackRating,
        };
      })
      .sort((a, b) => b.avgFeedbackRating - a.avgFeedbackRating);

    const responseData = {
      timestamp: new Date(),
      dateFilter,
      agent: {
        totalActiveChats,
        totalPendingQueries,
        resolvedToday: totalResolvedToday,
        resolvedInRange: totalResolvedInRange,
        totalResolved: totalResolvedQueries,
        avgResponseTime,
        avgFirstResponseTime: avgResponseTime,
        avgFullResolutionTime: Number((totalCallDurationMinutes / 60).toFixed(1)),
        callsMade: totalCallsMade,
        emailsSent: totalEmailsSent,
        totalCallDuration: totalCallDurationMinutes,
        highPriorityQueries,
        totalEscalated: totalEscalatedAgent,
        todayEscalated: todayEscalatedAgent,
        avgFeedbackRating: avgAgentFeedbackRating,
        csatScore: avgAgentFeedbackRating ? Math.round((avgAgentFeedbackRating / 5) * 100) : 0,
        totalFeedbackCount: totalAgentFeedbackCount,
        activityStatus: {
          currentlyActive: agentActivityCounts.currentlyActive,
          onBreak: agentActivityCounts.onBreak,
          offline: agentActivityCounts.offline,
          avgActiveTime: avgAgentActiveTimeFormatted,
          totalAgentCount: agents.length,
        },
        topAgents,
      },
      qa: {
        totalTicketsReviewed: totalQATicketsReviewed,
        approvedToday: qaApprovedToday,
        approvalRate: qaApprovalRate,
        avgFeedbackRating: avgQAFeedbackRating,
        totalFeedbackCount: totalQAFeedbackCount,
        totalEscalated: totalEscalatedQA,
        todayEscalated: todayEscalatedQA,
        escalatedResolved: escalatedResolvedQA,
        totalResolved: totalResolvedQA,
        activityStatus: {
          currentlyActive: qaActivityCounts.currentlyActive,
          onBreak: qaActivityCounts.onBreak,
          offline: qaActivityCounts.offline,
          avgActiveTime: avgQAActiveTimeFormatted,
          totalQACount: qaMembers.length,
        },
        topQA,
      },
      tl: {
        totalEscalated: totalEscalatedTL,
        todayEscalated: todayEscalatedTL,
        escalatedResolved: escalatedResolvedTL,
        totalResolved: totalResolvedTL,
      },
      overall: {
        queries: globalQueryStats,
        tickets: globalTicketStats,
        systemHealth,
        communication: {
          totalChats,
          totalCalls,
        },
        totalQueries,
        openQueries,
        resolvedQueries: resolvedQueryCount,
        totalChats,
        totalCalls,
      },
      systemHealth: {
        ...systemHealth,
        onBreak: totalOnBreak,
      },
      teamDetails: {
        agents: agents.map((a) => ({
          id: a._id,
          name: a.name,
          email: a.email,
          status: a.workStatus,
          isActive: a.is_active,
          loginTime: a.login_time,
          breakLogs: a.breakLogs,
        })),
        qa: qaMembers.map((q) => ({
          id: q._id,
          name: q.name,
          email: q.email,
          status: q.workStatus,
          isActive: q.is_active,
          loginTime: q.login_time,
          breakLogs: q.breakLogs,
        })),
      },
    };

    console.log('✅ [Admin Dashboard] Stats calculated successfully (optimized)');

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📊 [Agent Performance] Fetching all agents performance...');

    const agents = await Staff.find({ role: 'Agent' }).select(
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📊 [QA Performance] Fetching all QA members performance...');

    const qaMembers = await Staff.find({ role: 'QA' }).select(
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
    const agents = await Staff.find({ role: 'Agent' }).select('_id name email');
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
