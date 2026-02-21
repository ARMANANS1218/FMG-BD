const Notification = require("../models/Notification");
const TicketNew = require("../models/TicketNew");
const emailReplyTemplate = require("../utils/emailReplyTemplate");
const { sendEmail } = require("../utils/emailService");
const emailTemplate = require("../utils/emailTemplate");
const generateTicket = require("../utils/generateTicket");
const User =require('../models/User');

exports.createCustomerTicket = async (req, res) => {
  const { email, subject, message } = req.body;

  if (!email || !subject || !message) {
    return res.status(400).json({ status: false, message: 'All fields are required (email, subject, message)' });
  }
  const ticketId = generateTicket();
  const agentEmail= await User.findOne({email})
  try {
    const ticket = await TicketNew.create({
      email,
      subject,
      message,
      ticketId,
      from:agentEmail,
      replies: [{ message, from  }]
    });

    // ✅ Notify all agents
    req.io.emit("new_ticket_created", { ticket });

    // ✅ Optional: If authenticated user, save notification
    if (req.user?.id) {
      const userId = req.user.id;

      await Notification.create({
        userId,
        message: `Your support ticket (${ticketId}) has been created.`,
        link: `/tickets/${ticketId}`,
      });

      req.io.to(userId).emit("new_ticket", {
        message: `Your ticket (${ticketId}) has been created.`,
        ticketId,
      });
    }

    // ✅ Email confirmation
    const replyHTML = emailTemplate(ticketId, subject, message);
    await sendEmail(email, `Ticket Received: ${ticketId}`, replyHTML);

    res.status(201).json({
      status: true,
      message: "Ticket created and confirmation email sent",
      data: ticket,
    });

  } catch (err) {
    console.error('❌ Ticket creation error:', err.message);
    res.status(500).json({ status: false, message: 'Failed to create ticket', error: err.message });
  }
};

exports.agentReply = async (req, res) => {
  const agentId = req.user?.id;
  const { ticketId } = req.params;
  const { message } = req.body;

  try {
    const ticket = await TicketNew.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    ticket.replies.push({ message, from: "agent" });
    // Keep status as "Open" when agent replies (don't change it automatically)
    // Status should only be changed manually by the agent to "Closed"
    if (ticket.status === 'Pending') {
      ticket.status = "Open";
    }
    ticket.assignedTo = agentId;
    await ticket.save();

    // Get agent for alias name and notify customer by email
    const agent = await User.findById(agentId);
    const agentDisplayName = agent?.alias || agent?.name || 'Support Agent';
    await sendEmail(ticket.email, `Reply to Ticket: ${ticketId}`, emailReplyTemplate(ticketId, message, agentDisplayName));

    // Real-time update to client + broadcast for list refresh/highlight
    req.io.to(ticket.email).emit("ticket_reply", { ticketId, message });
    req.io.emit('ticket-updated', { ticketId, status: ticket.status, lastActivityAt: new Date() });

    res.status(200).json({ message: "Reply sent", data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.forwardTicket = async (req, res) => {
  const fromAgentId = req.user.id;
  const { ticketId } = req.params;
  const { toAgentId } = req.body;

  try {
    const ticket = await TicketNew.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    ticket.forwardedTo.push({ agent: toAgentId });
    ticket.assignedTo = toAgentId;
    // When forwarded/assigned, ensure it is treated as taken
    ticket.status = "Open";
    await ticket.save();

    // Real-time update to new agent
    req.io.to(toAgentId).emit("ticket_forwarded", { ticket });

    res.status(200).json({ message: "Ticket forwarded", data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getAllTickets = async (req, res) => {
  try {
    const tickets = await TicketNew.find()
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: true,
      message: 'Tickets fetched successfully',
      data: tickets
    });
  } catch (err) {
    console.error('Error fetching tickets:', err.message);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tickets',
      error: err.message
    });
  }
};
exports.getAllTicketsByAssign = async (req, res) => {
  const userId = req.user?.id;
  try {
    const tickets = await TicketNew.find({
      assignedTo: userId  // Filter tickets assigned to this user
    })
      .populate('assignedTo', 'first_name last_name email')
      .populate('forwardedTo.agent', 'first_name last_name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: true,
      message: 'Tickets fetched successfully',
      data: tickets
    });
  } catch (err) {
    console.error('Error fetching tickets:', err.message);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tickets',
      error: err.message
    });
  }
};
// 
exports.getRepliesByUser = async (req, res) => {
  const userEmail = req.user?.email;

  try {
    const tickets = await TicketNew.find({
      replies: {
        $elemMatch: { from: userEmail }
      }
    });

    // Extract only replies by that user from all tickets
    const userReplies = [];

    tickets.forEach(ticket => {
      ticket.replies.forEach(reply => {
        if (reply.from === userEmail) {
          userReplies.push({
            ticketId: ticket.ticketId,
            message: reply.message,
            date: reply.date, // if you store date in reply
          });
        }
      });
    });

    res.status(200).json({
      status: true,
      message: 'User replies fetched successfully',
      data: userReplies,
    });

  } catch (err) {
    console.error('Error fetching user replies:', err.message);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch replies',
      error: err.message,
    });
  }
};

exports.getTicketEveryById = async (req, res) => {
  const { ticketId } = req.params;

  try {
    const ticket = await TicketNew.findOne({ ticketId })
      .populate('assignedTo', 'first_name last_name email')
      .populate('forwardedTo.agent', 'first_name last_name email');

    if (!ticket) {
      return res.status(404).json({
        status: false,
        message: 'Ticket not found'
      });
    }

    res.status(200).json({
      status: true,
      message: 'Ticket fetched successfully',
      data: ticket
    });
  } catch (err) {
    console.error('Error fetching ticket:', err.message);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch ticket',
      error: err.message
    });
  }
};
exports.getAllTicketFilter = async (req, res) => {
  const { status, assignedTo, page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;
  const query = {};

  // 👉 Role-based filtering: only assigned tickets for agents
  if (req.user.role === 'Agent') {
    query.assignedTo = req.user.id;
  }

  // 👉 Query filters (optional)
  if (status) {
    query.status = status;
  }

  if (assignedTo && req.user.role === 'QA') {
    query.assignedTo = assignedTo;
  }

  try {
    const tickets = await TicketNew.find(query)
      .populate('assignedTo', 'first_name last_name email')
      .populate('forwardedTo.agent', 'first_name last_name email')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await TicketNew.countDocuments(query);

    res.status(200).json({
      status: true,
      message: 'Tickets filter by status successfully',
      data: tickets,
      meta: {
        total,
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Error fetching tickets:', err.message);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tickets',
      error: err.message,
    });
  }
};
exports.getTicketById = async (req, res) => {
  const { ticketId } = req.params;

  try {
    const ticket = await TicketNew.findOne({ ticketId })
      .populate('assignedTo', 'first_name last_name email')
      .populate('forwardedTo.agent', 'first_name last_name email');

    if (!ticket) {
      return res.status(404).json({
        status: false,
        message: 'Ticket not found',
      });
    }

    // ⚠️ Strong Access Restriction: Only assigned agent can view
    if (!ticket.assignedTo || ticket.assignedTo._id.toString() !== req.user.id) {
      return res.status(403).json({
        status: false,
        message: 'You are not assigned to this ticket',
      });
    }

    res.status(200).json({
      status: true,
      message: 'Ticket fetched successfully',
      data: ticket,
    });
  } catch (err) {
    console.error('Error fetching ticket:', err.message);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch ticket',
      error: err.message,
    });
  }
};
// QA/TL assign ticket to agent
exports.assignAgentToTicket = async (req, res) => {
  const { ticketId } = req.params;
  const { agentId } = req.body;

  try {
    const ticket = await TicketNew.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    ticket.assignedTo = agentId || null;
    // When assigned by QA/TL, set status to "Open"
    if (agentId) {
      ticket.status = 'Open';
    }
    await ticket.save();

    // Real-time update
    req.io.to(agentId).emit('ticket_assigned', { ticket });

    res.status(200).json({
      status: true,
      message: agentId ? 'Agent assigned' : 'Agent unassigned',
      data: ticket,
    });
  } catch (err) {
    res.status(500).json({ status: false, message: 'Error assigning agent', error: err.message });
  }
};

// Agent takes ticket (assigns to themselves)
exports.takeTicket = async (req, res) => {
  const { ticketId } = req.params;
  const agentId = req.user.id; // Current logged-in agent

  try {
    const ticket = await TicketNew.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    // Assign ticket to current agent and set status to "Open"
    ticket.assignedTo = agentId;
    ticket.status = 'Open';
    await ticket.save();

    // Real-time update
    req.io.to(agentId).emit('ticket_assigned', { ticket });

    res.status(200).json({
      status: true,
      message: 'Ticket taken successfully',
      data: ticket,
    });
  } catch (err) {
    res.status(500).json({ status: false, message: 'Error taking ticket', error: err.message });
  }
};

exports.updateTicketStatus = async (req, res) => {
  const { ticketId } = req.params;
  const { status } = req.body;

  const allowedStatuses = ['Pending', 'Open', 'Closed'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ status: false, message: 'Invalid status' });
  }

  try {
    const ticket = await TicketNew.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    ticket.status = status;
    await ticket.save();

    res.status(200).json({
      status: true,
      message: 'Ticket status updated',
      data: ticket,
    });
  } catch (err) {
    res.status(500).json({ status: false, message: 'Failed to update status', error: err.message });
  }
};
