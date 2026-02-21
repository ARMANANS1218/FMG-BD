const Notification = require("../models/Notification");
const Ticket = require("../models/Ticket");
const { sendEmail } = require("../utils/emailService");
const User = require("../models/User");
const generateTicket = require("../utils/generateTicket");
const emailReplyTemplate = require("../utils/emailReplyTemplate");

exports.createTicket = async (req, res) => {
  const { customerEmail, subject, message, agentId } = req.body;

  if (!customerEmail || !subject || !message || !agentId) {
    return res.status(400).json({ status: false, message: "All fields are required" });
  }

  const ticketId = generateTicket();

  try {
    // 1. Verify assigned agent
    const assignedAgent = await User.findById(agentId);
    if (!assignedAgent) {
      return res.status(404).json({ status: false, message: "Assigned agent not found" });
    }

    // 2. Create ticket with organization
    const ticket = await Ticket.create({
      customerEmail,
      agentId,
      subject,
      message,
      ticketId,
      organizationId: assignedAgent.organizationId, // ✅ Add organization isolation
      replies: [{
        message,
        from: "customer",
        senderEmail: customerEmail
      }]
    });

    // 3. Notify only agents from SAME organization
    const agents = await User.find({ 
      role: 'Agent', 
      organizationId: assignedAgent.organizationId // ✅ Filter by organization
    }).select('_id email');

    const notifications = agents.map(agent => ({
      message,
      link: `/tickets/${ticketId}`,
      ticketId: ticket._id,
      receivers: [{
        userId: agent._id,
        isRead: agent._id.equals(agentId),
        readAt: agent._id.equals(agentId) ? new Date() : null
      }]
    }));

    await Notification.insertMany(notifications);

    // 4. Real-time notification to agents of SAME organization only
    const orgRoom = `ticket-org:${assignedAgent.organizationId}`;
    console.log(`📡 Emitting new_ticket_created to organization room: ${orgRoom}`);
    req.io.to(orgRoom).emit("new_ticket_created", {
      ticket,
      notification: {
        ticket: `New ticket #${ticketId} created`,
        message,
        subject,
        link: `/tickets/${ticketId}`,
        timestamp: new Date(),
        organizationId: assignedAgent.organizationId.toString()
      }
    });

    // 5. Notify ticket creator (if logged in)
    if (req.user?.id) {
      await Notification.create({
        message: `Your support ticket (#${ticketId}) has been created.`,
        link: `/tickets/${ticketId}`,
        ticketId,
        subject,
        receivers: [{
          userId: req.user.id,
          isRead: false
        }]
      });

      req.io.to(req.user.id).emit("ticket_created", {
        message: `Your ticket (#${ticketId}) has been created.`,
        ticketId,
        link: `/tickets/${ticketId}`
      });
    }

    // 6. Send email notifications
    const emailPromises = [
      sendEmail(
        assignedAgent.email,
        `New Support Ticket #${ticketId}`,
        `
        You've been assigned a new ticket:<br><br>
        <strong>Subject:</strong> ${subject}<br>
        <strong>From:</strong> ${customerEmail}<br><br>
        ${message}<br><br>
        <a href="${process.env.BASE_URL}/tickets/${ticket._id}">View Ticket</a>
        `
      )
    ];

    // Optional: Email customer if they’re different from logged-in user
    if (customerEmail && (!req.user?.email || customerEmail !== req.user.email)) {
      emailPromises.push(
        sendEmail(
          customerEmail,
          `Support Ticket #${ticketId} Created`,
          `
          Your support ticket has been created:<br><br>
          <strong>Subject:</strong> ${subject}<br>
          <strong>Agent:</strong> ${assignedAgent.email}<br><br>
          ${message}<br><br>
          <a href="${process.env.BASE_URL}/tickets/${ticket._id}">View Ticket</a>
          `
        )
      );
    }

    await Promise.all(emailPromises);

    // 7. Respond success
    res.status(201).json({
      status: true,
      message: "Ticket created successfully",
      data: ticket
    });

  } catch (error) {
    console.error("❌ Ticket creation error:", error);
    res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};

exports.replyToTicket = async (req, res) => {
  const { ticketId } = req.params;
  const { message } = req.body;
  const agentId = req.user?.id;

  try {
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const agent = await User.findById(agentId);
    if (!agent) return res.status(403).json({ message: "Unauthorized" });

    // Append reply to ticket
    ticket.replies.push({
      message,
      from: "agent",
      senderEmail: agent.email
    });
    ticket.status="In Progress";
    await ticket.save();

    // Send email to customer with agent alias
    const agentDisplayName = agent.alias || agent.name || 'Support Agent';
    await sendEmail(
      ticket.customerEmail,
      `Reply to Your Ticket :${ticketId} (${ticket.subject})`,
      emailReplyTemplate(ticketId, message, agentDisplayName),
      `${message}`
    );

    res.status(200).json({ status: true, message: "Reply sent", data: ticket });

  } catch (error) {
    res.status(500).json({ status: false, message: "Error sending reply", error });
  }
};

exports.getAgentTickets = async (req, res) => {
  try {
    const agentId = req.user?.id;

    const tickets = await Ticket.find({ agentId })
      .populate("agentId", "name email") // optional
      .sort({ createdAt: -1 });

    res.status(200).json({ status: true, data: tickets });
  } catch (error) {
    res.status(500).json({ status: false, message: "Error fetching tickets", error });
  }
};

exports.forwardTicket = async (req, res) => {
  const { ticketId, toAgentId } = req.body;
  const fromAgentId = req.user?.id;

  try {
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    // Log the forwarding
    ticket.forwardedTo.push({
      fromAgent: fromAgentId,
      toAgent: toAgentId,
    });

    // Reassign ticket
    ticket.agentId = toAgentId;
    ticket.status="Escalated";
    await ticket.save();

    res.status(200).json({ message: "Ticket forwarded successfully", ticket });
  } catch (err) {
    res.status(500).json({ message: "Error forwarding ticket", error: err.message });
  }
};

exports.qaAssignTicket = async (req, res) => {
  const { ticketId, toAgentId } = req.body;
  const qaUserId = req.user.id;

  try {
    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    ticket.agentId = toAgentId;
    ticket.assignedBy = qaUserId;
    await ticket.save();

    res.status(200).json({ message: "Ticket assigned by QA",data: ticket });
  } catch (err) {
    res.status(500).json({ message: "Error assigning ticket", error: err.message });
  }
};
// by token
exports.getAgentTicketsByUser = async (req, res) => {
  const agentId = req.user.id; 

  try {
    const tickets = await Ticket.find({ agentId })
      .populate("agentId", "name email") // Optional
      .sort({ createdAt: -1 });

    res.status(200).json({
      status: true,
      message: "Assigned tickets fetched successfully",
      data: tickets,
    });
  } catch (error) {
    res.status(500).json({ status: false, message: "Error fetching tickets", error: error.message });
  }
};

exports.getTicketReplies = async (req, res) => {
  const agentId = req.user.id;
  const { ticketId } = req.params;

  try {
    const ticket = await Ticket.findOne({ ticketId, agentId });

    if (!ticket) {
      return res.status(404).json({ status: false, message: "Ticket not found or unauthorized" });
    }

    res.status(200).json({
      status: true,
      message: "Replies fetched successfully",
      replies: ticket.replies,
    });
  } catch (error) {
    res.status(500).json({ status: false, message: "Error fetching replies", error: error.message });
  }
};

exports.getAllTicketsByAssign = async (req, res) => {
  const userId = req.user?.id;
  try {
    const tickets = await Ticket.find({
      assignedBy: userId  // Filter tickets assigned to this user
    })
      .populate('assignedBy', 'name email')
      .populate('forwardedTo', 'name email')
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

exports.getAllTicketFilter = async (req, res) => {
  const { status, assignedBy, page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;
  const query = {};

  // 👉 Role-based filtering: only assigned tickets for agents
  if (req.user.role === 'Agent') {
    query.assignedBy = req.user.id;
  }

  // 👉 Query filters (optional)
  if (status) {
    query.status = status;
  }

  if (assignedBy && req.user.role === 'QA') {
    query.assignedBy = assignedBy;
  }

  try {
    const tickets = await Ticket.find(query)
      .populate('assignedBy', 'name email')
      .populate('forwardedTo', 'name email')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Ticket.countDocuments(query);

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

// Controller to get ticket by ticketId
exports.getTicketByTicketId = async (req, res) => {
  const agentId = req?.user?.id; 
  const { ticketId } = req.params;

  try {
    // Find ticket by ticketId and check if agent is assigned
    const ticket = await Ticket.findOne({
      ticketId,agentId,
    })
    .populate('agentId', 'name email') // Populate agent details
    .populate('forwardedTo', 'name email') // Populate forwarded agents
    .lean();

    if (!ticket) {
      return res.status(404).json({ 
        status: false, 
        message: "Ticket not found or unauthorized access" 
      });
    }

    // Format response data
    const responseData = {
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      message: ticket.message,
      status: ticket.status,
      customerEmail: ticket.customerEmail,
      createdAt: ticket.createdAt,
      agent: ticket.agentId,
      forwardedTo: ticket.forwardedTo,
      replies: ticket.replies || []
    };

    res.status(200).json({
      status: true,
      message: "Ticket fetched successfully",
      data: responseData
    });

  } catch (error) {
    console.error(`Error fetching ticket ${ticketId}:`, error);
    res.status(500).json({ 
      status: false, 
      message: "Error fetching ticket",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getAllEmails = async (req, res) => {
  try {
    const userId = req.user.id;

    const emails = await Ticket.find({
      $or: [{ agentId: userId }, { customerEmail: userId }]
    }).populate("agentId customerId", "name email");

    res.json({ success: true, data: emails });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
