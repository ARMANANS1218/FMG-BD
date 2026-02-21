const Query = require('../models/Query');
const Ticket = require('../models/Ticket');
const EmailTicket = require('../email-ticketing/models/Ticket');
const User = require('../models/User');

/**
 * Get combined agent performance (Tickets + Queries)
 * For TL Dashboard - Agent Performance Reports
 */
exports.getAgentPerformance = async (req, res) => {
  try {
    const { agentId, startDate, endDate, role } = req.query;
    const userRole = req.user?.role;

    // Authorization: Only TL, QA, Admin, SuperAdmin, Management can access
    if (!['TL', 'QA', 'Admin', 'SuperAdmin', 'Management'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized access',
      });
    }

    // Date filtering
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // If specific agent requested, or filter by role (Agent, TL, QA)
    let agentFilter;
    if (agentId) {
      agentFilter = { _id: agentId };
    } else if (role) {
      agentFilter = { role: role };
    } else {
      agentFilter = { role: 'Agent' };
    }
    const agents = await User.find(agentFilter).select(
      '_id name email alias is_active role profileImage'
    );

    const performanceData = await Promise.all(
      agents.map(async (agent) => {
        // QUERY STATS
        const queryFilter = {
          ...dateFilter,
          $or: [{ assignedTo: agent._id }, { resolvedBy: agent._id }],
        };

        const queries = await Query.find(queryFilter);

        // Count queries that this agent escalated/transferred (fromAgent in transferHistory)
        // Need to search ALL queries where this agent appears as fromAgent in transferHistory
        const escalatedQueriesCount = await Query.countDocuments({
          ...dateFilter,
          'transferHistory.fromAgent': agent._id,
        });

        const queryStats = {
          total: queries.length,
          pending: queries.filter((q) => q.status === 'Pending').length,
          accepted: queries.filter((q) => q.status === 'Accepted').length,
          inProgress: queries.filter((q) => q.status === 'In Progress').length,
          resolved: queries.filter((q) => q.status === 'Resolved').length,
          escalated: escalatedQueriesCount, // Queries escalated/transferred BY this agent
          expired: queries.filter((q) => q.status === 'Expired').length,
        };

        // TICKET STATS (Old Ticket Model) - agentId is an array, MongoDB auto-matches
        const ticketFilter = {
          ...dateFilter,
          agentId: agent._id,
        };

        const tickets = await Ticket.find(ticketFilter);
        const ticketStats = {
          total: tickets.length,
          open: tickets.filter((t) => t.status === 'Open').length,
          inProgress: tickets.filter((t) => t.status === 'In Progress').length,
          resolved: tickets.filter((t) => t.status === 'Resolved').length,
          escalated: tickets.filter((t) => t.status === 'Escalated').length,
        };

        // EMAIL TICKET STATS (New Email Ticket Model)
        // Get tickets currently assigned to agent
        const emailTicketFilter = {
          ...dateFilter,
          assignedTo: agent._id,
        };
        const emailTickets = await EmailTicket.find(emailTicketFilter);

        // Count tickets that this agent escalated/assigned to others
        const escalatedByAgentTickets = await EmailTicket.countDocuments({
          ...dateFilter,
          assignedBy: agent._id,
          assignedTo: { $ne: agent._id }, // Assigned to someone else, not self
        });

        const emailTicketStats = {
          total: emailTickets.length,
          open: emailTickets.filter((t) => t.status === 'open').length,
          pending: emailTickets.filter((t) => t.status === 'pending').length,
          closed: emailTickets.filter((t) => t.status === 'closed').length,
          escalated: escalatedByAgentTickets, // Tickets escalated BY this agent to others
        };

        // COMBINED RESOLUTION RATE
        const totalResolved = queryStats.resolved + ticketStats.resolved + emailTicketStats.closed;
        const totalItems = queryStats.total + ticketStats.total + emailTicketStats.total;
        const resolutionRate = totalItems > 0 ? Math.round((totalResolved / totalItems) * 100) : 0;

        // AVERAGE RESPONSE TIME (for queries with messages)
        const queriesWithMessages = queries.filter((q) => q.messages && q.messages.length > 0);
        let avgResponseTime = 0;
        if (queriesWithMessages.length > 0) {
          const totalResponseTime = queriesWithMessages.reduce((sum, q) => {
            if (q.acceptedAt && q.messages[0]) {
              const responseMs = new Date(q.messages[0].timestamp) - new Date(q.acceptedAt);
              return sum + responseMs / 60000; // Convert to minutes
            }
            return sum;
          }, 0);
          avgResponseTime = Math.round(totalResponseTime / queriesWithMessages.length);
        }

        // FEEDBACK/QA RATING (from queries and email tickets)
        const queriesWithFeedback = queries.filter((q) => q.feedback && q.feedback.rating);
        const ticketsWithRating = emailTickets.filter((t) => t.qaRating && t.qaRating > 0);

        // Customer Feedback Rating (only from queries - customer given)
        let customerFeedbackRating = null;
        const totalCustomerRatings = queriesWithFeedback.length;
        if (totalCustomerRatings > 0) {
          const queryRatingSum = queriesWithFeedback.reduce((sum, q) => sum + q.feedback.rating, 0);
          customerFeedbackRating = (queryRatingSum / totalCustomerRatings).toFixed(1);
        }

        // Combined rating (for backward compatibility)
        let avgRating = null;
        const totalRatings = queriesWithFeedback.length + ticketsWithRating.length;
        if (totalRatings > 0) {
          const queryRatingSum = queriesWithFeedback.reduce((sum, q) => sum + q.feedback.rating, 0);
          const ticketRatingSum = ticketsWithRating.reduce((sum, t) => sum + t.qaRating, 0);
          avgRating = ((queryRatingSum + ticketRatingSum) / totalRatings).toFixed(1);
        }

        return {
          agent: {
            _id: agent._id,
            name: agent.name,
            email: agent.email,
            alias: agent.alias,
            isActive: agent.is_active,
            role: agent.role,
            profileImage: agent.profileImage,
          },
          queries: queryStats,
          tickets: ticketStats,
          emailTickets: emailTicketStats,
          combined: {
            totalResolved,
            totalItems,
            resolutionRate,
            avgResponseTime,
            avgRating,
            totalRatingsCount: totalRatings,
            customerFeedbackRating,
            totalCustomerRatings,
          },
        };
      })
    );

    res.status(200).json({
      status: true,
      data: performanceData,
      summary: {
        totalAgents: agents.length,
        dateRange: { startDate, endDate },
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Get Agent Performance Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch agent performance',
      error: error.message,
    });
  }
};

/**
 * Get all data for agent performance (queries + tickets combined)
 * Returns raw data for PDF/Excel export
 */
exports.getAllAgentPerformanceData = async (req, res) => {
  try {
    const userRole = req.user?.role;
    const orgId = req.user?.organizationId;

    // Authorization
    if (!['TL', 'QA', 'Admin', 'SuperAdmin', 'Management'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized access',
      });
    }

    // Get all agents
    const agentFilter = { role: 'Agent' };
    if (userRole !== 'SuperAdmin' && orgId) {
      agentFilter.organizationId = orgId;
    }

    const agents = await User.find(agentFilter).select(
      '_id name email alias is_active role organizationId profileImage'
    );

    // Get ALL queries
    const queryFilter = {};
    if (userRole !== 'SuperAdmin' && orgId) {
      queryFilter.organizationId = orgId;
    }
    const allQueries = await Query.find(queryFilter).lean();

    // Get ALL tickets
    const ticketFilter = {};
    if (userRole !== 'SuperAdmin' && orgId) {
      ticketFilter.organizationId = orgId;
    }
    const allTickets = await Ticket.find(ticketFilter).lean();

    // Get ALL email tickets
    const emailTicketFilter = {};
    if (userRole !== 'SuperAdmin' && orgId) {
      emailTicketFilter.organization = orgId;
    }
    const allEmailTickets = await EmailTicket.find(emailTicketFilter).lean();

    res.status(200).json({
      status: true,
      data: {
        agents: agents.map((a) => ({
          _id: a._id,
          name: a.name,
          email: a.email,
          alias: a.alias,
          is_active: a.is_active,
          role: a.role,
          profileImage: a.profileImage,
        })),
        queries: allQueries,
        tickets: allTickets,
        emailTickets: allEmailTickets,
      },
    });
  } catch (error) {
    console.error('❌ Get All Agent Performance Data Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch performance data',
      error: error.message,
    });
  }
};

module.exports = exports;
