const asyncHandler = require('express-async-handler');
const EmailTicket = require('./models/Ticket');
const EmailTicketMessage = require('./models/TicketMessage');
const TicketEvaluation = require('../models/TicketEvaluation');
const Booking = require('../models/Booking');
const {
  createInternalTicket,
  addTicketMessage,
  getTicketWithMessages,
  generateTicketId,
} = require('./ticket.service');
const { sendEmailReply } = require('./smtp/sendReply');
const { cloudinary } = require('../config/cloudinary');

/** Extract organization id either from body/header/middleware/user for multi-tenant. */
function getOrgId(req) {
  const orgId =
    req.organizationId ||
    req.user?.organizationId ||
    req.headers?.['x-organization-id'] ||
    req.body?.organization ||
    req.query?.organization ||
    null;

  console.log(`[GET_ORG_ID] Extracted organization ID: ${orgId}`, {
    fromReqOrganizationId: req.organizationId,
    fromUserOrganizationId: req.user?.organizationId,
    fromHeaderXOrganizationId: req.headers?.['x-organization-id'],
    fromBodyOrganization: req.body?.organization,
    fromQueryOrganization: req.query?.organization,
    userObject: req.user ? { id: req.user._id || req.user.id, role: req.user.role } : null,
    hasHeaders: !!req.headers,
    hasBody: !!req.body,
    hasQuery: !!req.query,
  });

  return orgId;
}

// POST /create (email tickets are auto; this endpoint is for internal/manual only)
exports.createTicket = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { channel } = req.body;

  if (channel === 'internal') {
    const ticket = await createInternalTicket({ ...req.body, organization });

    // Emit socket event for real-time notification
    const ticketNamespace = req.app.get('ticketNamespace');
    if (ticketNamespace && ticketNamespace.emitNewTicket) {
      ticketNamespace.emitNewTicket(ticket);
    }

    return res.status(201).json({ success: true, ticket });
  }

  return res
    .status(400)
    .json({ success: false, message: 'For email tickets, IMAP auto-creation handles inbox.' });
});

// POST /reply - agent reply or internal comment (with Cloudinary uploads)
exports.replyToTicket = asyncHandler(async (req, res) => {
  const { uploadToCloudinary } = require('./multerConfig');
  const organization = getOrgId(req);
  let { ticketId, message, html, senderType = 'agent', sendEmail = true } = req.body;
  if (ticketId) ticketId = String(ticketId).trim();

  console.log('[DEBUG] req.user in replyToTicket:', JSON.stringify(req.user, null, 2));

  const ticket = await EmailTicket.findOne({ ticketId, organization });
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Check if ticket is closed - prevent replies on closed tickets
  if (ticket.status === 'closed') {
    return res.status(400).json({ 
      success: false, 
      message: 'This ticket has been closed. You cannot reply to a closed ticket.' 
    });
  }

  // Upload files to Cloudinary and build attachments array
  const attachments = [];
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      try {
        const cloudinaryResult = await uploadToCloudinary(
          file.buffer,
          file.originalname,
          file.mimetype
        );
        attachments.push({
          filename: file.originalname,
          contentType: file.mimetype,
          size: file.size,
          url: cloudinaryResult.url,
          publicId: cloudinaryResult.publicId,
        });
      } catch (error) {
        console.error('Error uploading file to Cloudinary:', error);
      }
    }
  }

  console.log('Request User: ', req.user);

  // Persist message with attachments
  const saved = await addTicketMessage({
    ticket,
    organization,
    senderType,
    message,
    html,
    sender: req.user?.id,
    senderName: req.user?.role === 'customer' ? req.user?.name : req.user?.role,
    meta: { attachments },
  });

  // Emit socket event for real-time message
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace && ticketNamespace.emitNewMessage) {
    ticketNamespace.emitNewMessage(ticketId, saved);
  }

  // Send response immediately
  res.json({ success: true, message: saved });

  // Send email notification to customer in background (non-blocking)
  // console.log(`[AGENT REPLY DEBUG] Checking email conditions: senderType=${senderType}, sendEmail=${sendEmail}, customerEmail=${ticket.customerEmail}`);
  if (senderType === 'agent' && sendEmail && ticket.customerEmail) {
    // console.log(`[AGENT REPLY DEBUG] All conditions met, sending email in background...`);
    setImmediate(async () => {
      try {
        const OrgEmailConfig = require('./models/OrgEmailConfig');
        const orgId = organization || ticket.organization;

        const emailConfig = await OrgEmailConfig.findOne({
          organization: orgId,
          isEnabled: true,
        }).lean();

        if (emailConfig && emailConfig.emailAddress) {
          console.log(
            `[AGENT REPLY] Sending email notification to ${ticket.customerEmail} from ${emailConfig.emailAddress}`
          );

          // Create proper message ID and headers
          const replyMessageId = `<${ticket.ticketId}.reply.${Date.now()}@bitmaxtest.com>`;
          const headers = {
            'Message-ID': replyMessageId,
            'In-Reply-To': `<${
              ticket.ticketId
            }.created.${ticket.createdAt.getTime()}@bitmaxtest.com>`,
            References: `<${ticket.ticketId}.created.${ticket.createdAt.getTime()}@bitmaxtest.com>`,
          };

          const agentName = saved.senderName || req.user?.name || req.user?.alias || 'Support Team';

          // SIMPLE EMAIL - Just the message content for proper threading
          await sendEmailReply({
            organization: orgId,
            to: ticket.customerEmail,
            subject: `[Ticket #${ticket.ticketId}] ${ticket.subject}`, // SAME subject for threading
            html: `${html || message}`, // ONLY the actual message content
            text: message,
            headers,
            attachments,
          });

          // Update message record with email headers for threading
          saved.externalMessageId = replyMessageId;
          await saved.save();

          // console.log(`[AGENT REPLY] Email sent successfully to: ${ticket.customerEmail}`);
        } else {
          console.warn(`[AGENT REPLY] No email config found for organization: ${orgId}`);
        }
      } catch (emailError) {
        console.error(`[AGENT REPLY] Failed to send email:`, emailError.message);
      }
    });
  }
});

// GET / - list with optional search and team/view filters
exports.listTickets = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const {
    status,
    assignedTo,
    channel,
    search,
    page = 1,
    limit = 20,
    teamInbox,
    view,
    sortBy = 'activity',
    priority,
  } = req.query;
  const pageInt = Math.max(parseInt(page, 10) || 1, 1);
  const limitInt = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const baseFilter = { organization };

  // View-based filtering (myinbox, unassigned, all, team-specific)
  if (view === 'myinbox') {
    // Use assignedTo from query if provided, otherwise use authenticated user's ID
    const userId = assignedTo || req.user?.id || req.user?._id;
    if (userId) {
      baseFilter.assignedTo = userId;
    }
  } else if (view === 'unassigned') {
    baseFilter.assignedTo = null;
  }
  // else view==='all' shows all tickets (no assignedTo filter)

  if (teamInbox) baseFilter.teamInbox = teamInbox;
  if (channel) baseFilter.channel = channel;
  if (priority) baseFilter.priority = priority.toLowerCase(); // Normalize priority

  // Apply status filter (case-insensitive) - only if no global search and not 'all'
  const normalizedStatus = status ? status.toLowerCase().trim() : null;
  if (normalizedStatus && normalizedStatus !== 'all' && !search) {
    // Use case-insensitive regex to match status (handles 'Closed', 'closed', 'CLOSED')
    baseFilter.status = { $regex: new RegExp(`^${normalizedStatus}$`, 'i') };
  }

  console.log('[listTickets] Query params:', {
    view,
    status,
    normalizedStatus,
    assignedTo,
    teamInbox,
    priority,
    search,
  });
  console.log('[listTickets] Base filter:', JSON.stringify(baseFilter));

  let mongoFilter = baseFilter;
  if (search) {
    const regex = new RegExp(search, 'i');
    mongoFilter = {
      ...baseFilter,
      $or: [
        { ticketId: regex },
        { subject: regex },
        { customerEmail: regex },
        { customerName: regex },
        { tags: regex },
      ],
    };
  }

  // Sort order mapping
  let sortOrder;
  switch (sortBy) {
    case 'activity':
    case 'newest-activity':
      sortOrder = { lastActivityAt: -1 }; // Newest activity first
      break;
    case 'oldest-activity':
      sortOrder = { lastActivityAt: 1 }; // Oldest activity first
      break;
    case 'newest':
    case 'newest-created':
    case 'created':
      sortOrder = { createdAt: -1 }; // Newest created first
      break;
    case 'oldest':
    case 'oldest-created':
      sortOrder = { createdAt: 1 }; // Oldest created first
      break;
    default:
      sortOrder = { lastActivityAt: -1 }; // Default: newest activity
  }

  const query = EmailTicket.find(mongoFilter)
    .populate('assignedTo', 'name email profilePic alias role')
    .populate('assignedBy', 'name email alias role') // Include who assigned the ticket
    .sort(sortOrder)
    .skip((pageInt - 1) * limitInt)
    .limit(limitInt);

  const [tickets, total] = await Promise.all([query, EmailTicket.countDocuments(mongoFilter)]);

  console.log('[listTickets] mongoFilter:', JSON.stringify(mongoFilter));
  console.log('[listTickets] Found tickets:', tickets.length, 'Total:', total);
  if (tickets.length === 0 && normalizedStatus) {
    // Debug: Check what status values actually exist for this org
    const distinctStatuses = await EmailTicket.distinct('status', { organization });
    console.log('[listTickets] DEBUG - Distinct statuses in DB:', distinctStatuses);
  }

  // Additional in-memory filtering for assignee/requester search parts
  let final = tickets;
  if (search) {
    const s = search.toLowerCase();
    final = tickets.filter((t) => {
      const assigneeStr = (t.assignedTo?.name || '') + ' ' + (t.assignedTo?.email || '');
      const requesterStr = (t.customerEmail || '') + ' ' + (t.customerName || '');
      const tagsStr = (t.tags || []).join(' ');
      return (
        t.ticketId.toLowerCase().includes(s) ||
        (t.subject || '').toLowerCase().includes(s) ||
        assigneeStr.toLowerCase().includes(s) ||
        requesterStr.toLowerCase().includes(s) ||
        tagsStr.toLowerCase().includes(s)
      );
    });
  }

  const totalPages = Math.ceil(total / limitInt) || 1;
  res.json({ success: true, tickets: final, page: pageInt, limit: limitInt, total, totalPages });
});

// GET /:id - details
exports.getTicket = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const id = (req.params.id || '').trim();
  const data = await getTicketWithMessages(id, organization);
  if (!data) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, ...data });
});

// PUT /:id/status
exports.updateStatus = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { status } = req.body;
  const id = (req.params.id || '').trim();
  const normalizedStatus = status ? status.toLowerCase() : status;
  const ticket = await EmailTicket.findOneAndUpdate(
    { ticketId: id, organization },
    { status: normalizedStatus },
    { new: true }
  );
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Emit socket event
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace && ticketNamespace.emitTicketUpdate) {
    ticketNamespace.emitTicketUpdate(ticket);
  }

  res.json({ success: true, ticket });
});

// PUT /:id/priority
exports.updatePriority = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { priority } = req.body;
  const id = (req.params.id || '').trim();
  const ticket = await EmailTicket.findOneAndUpdate(
    { ticketId: id, organization },
    { priority },
    { new: true }
  );
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Emit socket event
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace && ticketNamespace.emitTicketUpdate) {
    ticketNamespace.emitTicketUpdate(ticket);
  }

  res.json({ success: true, ticket });
});

// PUT /:id/assign
exports.assignTicket = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { assignedTo } = req.body;
  const id = (req.params.id || '').trim();
  const currentUserId = req.user?.id || req.user?._id;

  // 1. Fetch ticket first to check current status
  let ticket = await EmailTicket.findOne({ ticketId: id, organization });
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // 2. Check Restriction: Cannot re-assign if already assigned to someone else
  // Only the current owner can re-assign (escalate) it.
  if (ticket.assignedTo && ticket.assignedTo.toString() !== currentUserId.toString()) {
    return res.status(403).json({
      success: false,
      message:
        'This ticket is already assigned to another user. Only the current owner can re-assign or escalate it.',
    });
  }

  // Normalize assignedTo ID
  let assignedToId = assignedTo;
  if (assignedTo && typeof assignedTo === 'object' && assignedTo._id) {
    assignedToId = assignedTo._id;
  }

  const updateData = {
    assignedTo: assignedToId || null,
    status: assignedToId ? 'open' : 'pending', // Set to 'open' when assigned, 'pending' when unassigned
    lastActivityAt: new Date(),
  };

  console.log('[assignTicket] Assignment Check:', {
    assignedToInput: assignedTo,
    assignedToId: assignedToId ? assignedToId.toString() : 'null',
    currentUserId: currentUserId ? currentUserId.toString() : 'missing',
  });

  if (assignedToId) {
    // Ticket is being assigned
    if (currentUserId && assignedToId.toString() === currentUserId.toString()) {
      // Self-assignment: Agent taking the ticket
      console.log('[assignTicket] Self-assignment detected. Clearing assignedBy.');
      updateData.assignedBy = null;
    } else {
      // Assignment by someone else (QA/TL)
      console.log(`[assignTicket] Assignment by ${currentUserId}. Setting assignedBy.`);
      updateData.assignedBy = currentUserId;
    }
    updateData.assignedAt = new Date();
  } else {
    // Unassigning
    console.log('[assignTicket] Unassigning ticket.');
    updateData.assignedBy = null;
    updateData.assignedAt = null;
  }

  ticket = await EmailTicket.findOneAndUpdate({ ticketId: id, organization }, updateData, {
    new: true,
  })
    .populate('assignedTo', 'name email alias role')
    .populate('assignedBy', 'name email alias role');

  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Emit socket event
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace && ticketNamespace.emitTicketAssigned && ticket.assignedTo) {
    ticketNamespace.emitTicketAssigned(ticket, ticket.assignedTo);
  }
  if (ticketNamespace && ticketNamespace.emitTicketUpdate) {
    ticketNamespace.emitTicketUpdate(ticket);
  }

  res.json({ success: true, ticket });
});

// PUT /:id/tags - add/update tags
exports.updateTags = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { tags } = req.body;
  const id = (req.params.id || '').trim();
  const ticket = await EmailTicket.findOneAndUpdate(
    { ticketId: id, organization },
    { tags: Array.isArray(tags) ? tags : [], lastActivityAt: new Date() },
    { new: true }
  );
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Emit socket event
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace && ticketNamespace.emitTicketUpdate) {
    ticketNamespace.emitTicketUpdate(ticket);
  }

  res.json({ success: true, ticket });
});

// PUT /:id/team - update team inbox
exports.updateTeamInbox = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { teamInbox } = req.body;
  const id = (req.params.id || '').trim();
  const ticket = await EmailTicket.findOneAndUpdate(
    { ticketId: id, organization },
    { teamInbox, lastActivityAt: new Date() },
    { new: true }
  );
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Emit socket event
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace && ticketNamespace.emitTicketUpdate) {
    ticketNamespace.emitTicketUpdate(ticket);
  }

  res.json({ success: true, ticket });
});

// DELETE /:id - delete ticket and all its messages
exports.deleteTicket = asyncHandler(async (req, res) => {
  const organization = getOrgId(req);
  const { id } = req.params;

  const ticket = await EmailTicket.findOne({ ticketId: id, organization });
  if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Delete all messages associated with this ticket
  await EmailTicketMessage.deleteMany({ ticket: ticket._id });

  // Delete the ticket
  await EmailTicket.deleteOne({ _id: ticket._id });

  // Emit socket event for real-time update
  const ticketNamespace = req.app.get('ticketNamespace');
  if (ticketNamespace) {
    ticketNamespace.to(`ticket-${id}`).emit('ticket-deleted', { ticketId: id });
  }

  res.json({ success: true, message: 'Ticket deleted successfully' });
});

// ============================================
// WIDGET/API KEY ROUTES (No JWT required)
// ============================================

// Validate API key from header
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ success: false, message: 'API key required' });
  }

  console.log(`[VALIDATE_API_KEY] Received API key: ${apiKey}`);

  // Find organization by API key
  const Organization = require('../models/Organization');
  try {
    const organization = await Organization.findOne({
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });

    if (!organization) {
      console.error(`[VALIDATE_API_KEY] Invalid API key or organization not found`);
      return res.status(401).json({ success: false, message: 'Invalid API key' });
    }

    req.organizationId = organization._id.toString();
    req.organization = organization;

    console.log(`[VALIDATE_API_KEY] Validated - Org: ${organization.name} (${req.organizationId})`);
  } catch (error) {
    console.error(`[VALIDATE_API_KEY] Database error:`, error);
    return res.status(500).json({ success: false, message: 'Server error validating API key' });
  }

  next();
}

// POST /tickets - Create ticket from widget (with file uploads to Cloudinary)
exports.createTicketFromWidget = [
  validateApiKey,
  asyncHandler(async (req, res) => {
    const { uploadToCloudinary } = require('./multerConfig');
    const {
      subject,
      message,
      html,
      priority = 'medium',
      category = 'general',
      customerEmail,
      customerName,
      pnr // Airline PNR
    } = req.body;

    console.log(`[WIDGET TICKET CREATE] Request received:`, {
      subject,
      customerEmail,
      category,
      pnr,
      priority,
      hasMessage: !!message,
    });

    if (!subject || !message || !customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'Subject, message, and customerEmail are required',
      });
    }

    // Check for duplicate ticket created within last 30 seconds to prevent double submission
    const recentDuplicate = await EmailTicket.findOne({
      customerEmail,
      subject,
      channel: 'widget',
      createdAt: { $gte: new Date(Date.now() - 30000) }, // Within last 30 seconds
    });

    if (recentDuplicate) {
      console.log(
        `[WIDGET TICKET CREATE] Duplicate ticket prevented - recent ticket exists:`,
        recentDuplicate.ticketId
      );
      return res.status(200).json({
        success: true,
        data: {
          ticketId: recentDuplicate.ticketId,
          status: recentDuplicate.status,
          priority: recentDuplicate.priority,
          createdAt: recentDuplicate.createdAt,
          isDuplicate: true,
        },
        message: 'Ticket already exists from recent submission',
      });
    }

    // Generate ticket ID
    const ticketId = await generateTicketId();

    // Map category to teamInbox (Airline Domain)
    const categoryToTeamInbox = {
      'Booking': 'reservations',
      'Cancellation': 'cancellations',
      'Reschedule': 'reservations',
      'Refund': 'refunds',
      'Baggage': 'baggage-claim',
      'Check-in': 'ground-ops',
      'Meal / Seat': 'inflight-services',
      'Visa / Travel Advisory': 'compliance',
      'Other': 'general',
      // Legacy Fallback
      general: 'general',
      technical: 'general',
      billing: 'finance',
    };
    const teamInbox = categoryToTeamInbox[category] || 'general';

    // Create message ID for threading BEFORE creating ticket
    const messageId = `<${ticketId}.created.${Date.now()}@bitmaxtest.com>`;

    // Find Booking if PNR provided
    let foundBookingId = null;
    if (pnr) {
       const booking = await Booking.findOne({ pnr: pnr.toUpperCase() });
       if (booking) foundBookingId = booking._id;
    }

    // Create ticket
    const ticket = await EmailTicket.create({
      ticketId,
      subject,
      customerEmail,
      customerName: customerName || customerEmail.split('@')[0],
      channel: 'widget',
      status: 'pending', // New tickets start as pending until assigned
      priority,
      category,
      pnr: pnr ? pnr.toUpperCase() : undefined,
      bookingId: foundBookingId,
      teamInbox,
      tags: [category],
      organization: req.organizationId || null,
      externalMessageId: messageId, // Store original Message-ID for threading
    });

    // Upload files to Cloudinary and build attachments array
    const attachments = [];
    if (req.files && req.files.length > 0) {
      console.log(`[WIDGET TICKET CREATE] Uploading ${req.files.length} files to Cloudinary...`);
      for (const file of req.files) {
        try {
          console.log(
            `[WIDGET TICKET CREATE] Uploading: ${file.originalname}, Type: ${file.mimetype}, Size: ${file.size} bytes`
          );
          const cloudinaryResult = await uploadToCloudinary(
            file.buffer,
            file.originalname,
            file.mimetype
          );
          console.log(
            `[WIDGET TICKET CREATE] Successfully uploaded: ${file.originalname}, URL: ${cloudinaryResult.url}`
          );
          attachments.push({
            filename: file.originalname,
            contentType: file.mimetype,
            size: file.size,
            url: cloudinaryResult.url,
            publicId: cloudinaryResult.publicId,
          });
        } catch (error) {
          console.error(
            `[WIDGET TICKET CREATE] Error uploading ${file.originalname} to Cloudinary:`,
            error
          );
          console.error(`[WIDGET TICKET CREATE] Error details:`, error.message);
          // Continue with other files even if one fails
        }
      }
      console.log(`[WIDGET TICKET CREATE] Total attachments uploaded: ${attachments.length}`);
    }

    // Create customer message before sending response (needed for database consistency)
    const OrgEmailConfig = require('./models/OrgEmailConfig');
    const orgId = req.organizationId || ticket.organization;
    const emailConfig = await OrgEmailConfig.findOne({
      organization: orgId,
      isEnabled: true,
    }).lean();

    // Create the customer's original message record with externalMessageId
    const customerMessage = await EmailTicketMessage.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      organization: orgId,
      senderType: 'customer',
      senderName: customerName || customerEmail.split('@')[0],
      message: message,
      html: html || message,
      attachments,
      externalMessageId: messageId,
      from: customerEmail,
      to: emailConfig ? [emailConfig.emailAddress] : [],
      date: new Date(),
    });

    console.log(`[WIDGET TICKET CREATE] Created customer message with ID: ${messageId}`);

    // Emit socket event
    const ticketNamespace = req.app.get('ticketNamespace');
    if (ticketNamespace && ticketNamespace.emitNewTicket) {
      ticketNamespace.emitNewTicket(ticket);
    }

    // Send response immediately - don't wait for emails
    res.status(201).json({
      success: true,
      data: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
      },
    });

    // Send email notifications in background (non-blocking)
    setImmediate(async () => {
      try {
        console.log(`[WIDGET TICKET CREATE] Sending emails in background for ticket: ${ticketId}`);

        if (emailConfig && emailConfig.emailAddress) {
          // Send notification to support team (for dashboard visibility)
          await sendEmailReply({
            organization: orgId,
            to: emailConfig.emailAddress,
            subject: `[Ticket #${ticketId}] ${subject}`, // Use same subject format for threading
            html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; background: #ffffff; border: 1px solid #e5e5e5;">
            <h2 style="color: #333; margin-bottom: 20px;">New Support Ticket from Website</h2>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9f9f9;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Ticket ID:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${ticketId}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Customer:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${
                  customerName || customerEmail.split('@')[0]
                } (${customerEmail})</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Subject:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${subject}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Priority:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${priority}</td>
              </tr>
            </table>
            
            <div style="background: #f0f0f0; padding: 15px; margin: 20px 0;">
              <strong>Customer Message:</strong><br>
              ${html || message}
            </div>
            
            <p><a href="https://btclienterminal.com/FMG/" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none;">View in Dashboard</a></p>
          </div>
        `,
            text: `New Support Ticket: ${ticketId}\\n\\nCustomer: ${
              customerName || customerEmail.split('@')[0]
            } (${customerEmail})\\nSubject: ${subject}\\nPriority: ${priority}\\n\\nMessage:\\n${message}`,
            attachments,
            headers: {
              'Message-ID': messageId, // Use same Message-ID for threading
              References: messageId, // Reference itself for thread start
              'X-Ticket-Source': 'widget',
              'X-Ticket-ID': ticketId,
            },
          });
          console.log(
            `[WIDGET TICKET CREATE] Support team notification sent to: ${emailConfig.emailAddress}`
          );
        } else {
          console.warn(`[WIDGET TICKET CREATE] No email config found for organization: ${orgId}`);
        }
      } catch (emailError) {
        console.error(
          `[WIDGET TICKET CREATE] Failed to send support notification:`,
          emailError.message
        );
      }

      // Send email notification to customer from support email address
      // This way when customer replies, IMAP will pick it up and show to agents
      try {
        if (emailConfig && emailConfig.emailAddress) {
          console.log(
            `[WIDGET TICKET CREATE] Sending confirmation email to ${customerEmail} from ${emailConfig.emailAddress} for IMAP integration`
          );

          await sendEmailReply({
            organization: orgId,
            to: customerEmail,
            subject: `[Ticket #${ticketId}] ${subject}`,
            html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; background: #ffffff; border: 1px solid #e5e5e5;">
            <h2 style="color: #333; margin-bottom: 20px; border-bottom: 2px solid #10B981; padding-bottom: 10px;">Support Ticket Created</h2>
            
            <p>Dear ${customerName || customerEmail.split('@')[0]},</p>
            
            <p>Thank you for contacting us! Your support ticket has been created and our team will respond soon.</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9f9f9;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Ticket ID:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${ticketId}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Subject:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${subject}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Priority:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${priority}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Status:</td>
                <td style="padding: 8px; border: 1px solid #ddd;">Open</td>
              </tr>
            </table>
            
            <div style="background: #f0f0f0; padding: 15px; margin: 20px 0; border-left: 4px solid #0ea5e9;">
              <strong>Your Message:</strong><br>
              ${html || message}
            </div>
            
            <p><strong>To Reply:</strong> Simply reply to this email and our support team will receive your message.</p>
            
            <hr style="margin: 20px 0;">
            <p style="font-size: 12px; color: #666;">Ticket ID: <strong>${ticketId}</strong> | Please keep this for your records.</p>
          </div>
        `,
            text: `Support Ticket Created: ${ticketId}\n\nDear ${
              customerName || customerEmail.split('@')[0]
            },\n\nYour support ticket has been created with ID: ${ticketId}\nSubject: ${subject}\nPriority: ${priority}\n\nYour Message:\n${message}\n\nTo reply, simply respond to this email. Thank you!`,
            headers: {
              'Message-ID': messageId,
              References: messageId,
            },
            attachments,
          });
          console.log(
            `[WIDGET TICKET CREATE] Confirmation email sent successfully to ${customerEmail} from support address for IMAP integration`
          );
        } else {
          console.warn(
            `[WIDGET TICKET CREATE] No email config found - cannot send customer confirmation for IMAP integration`
          );
        }
      } catch (emailError) {
        console.error(
          `[WIDGET TICKET CREATE] Failed to send confirmation email to ${customerEmail}:`,
          emailError.message
        );
        console.error(`[WIDGET TICKET CREATE] Confirmation email error details:`, emailError);
        // Don't fail the ticket creation if email fails
      }
    });
  }),
];

// POST /tickets/reply - Reply to ticket from widget (with file uploads to Cloudinary)
exports.replyToTicketFromWidget = [
  validateApiKey,
  asyncHandler(async (req, res) => {
    const { uploadToCloudinary } = require('./multerConfig');
    const { ticketId, message, html, senderType = 'customer', customerEmail } = req.body;

    console.log('[WIDGET REPLY] Received reply:', {
      ticketId,
      senderType,
      customerEmail,
      hasMessage: !!message,
    });

    if (!ticketId || !message) {
      return res.status(400).json({
        success: false,
        message: 'ticketId and message are required',
      });
    }

    const ticket = await EmailTicket.findOne({ ticketId, customerEmail });
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Check if ticket is closed - prevent replies on closed tickets
    if (ticket.status === 'closed') {
      return res.status(400).json({ 
        success: false, 
        message: 'This ticket has been closed. You cannot reply to a closed ticket.' 
      });
    }

    console.log('[WIDGET REPLY] Found ticket:', {
      id: ticket.ticketId,
      status: ticket.status,
      customerEmail: ticket.customerEmail,
    });

    // Upload files to Cloudinary and build attachments array
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const cloudinaryResult = await uploadToCloudinary(
            file.buffer,
            file.originalname,
            file.mimetype
          );
          attachments.push({
            filename: file.originalname,
            contentType: file.mimetype,
            size: file.size,
            url: cloudinaryResult.url,
            publicId: cloudinaryResult.publicId,
          });
        } catch (error) {
          console.error('Error uploading file to Cloudinary:', error);
          // Continue with other files even if one fails
        }
      }
    }

    // Create message
    const newMessage = await EmailTicketMessage.create({
      ticket: ticket._id,
      ticketId: ticket.ticketId,
      senderType,
      senderName:
        senderType === 'customer'
          ? ticket.customerName || ticket.customerEmail.split('@')[0]
          : undefined,
      message,
      html: html || message,
      attachments,
      organization: req.organizationId || null,
    });

    // Update ticket lastActivityAt
    ticket.lastActivityAt = new Date();
    if (ticket.status === 'closed') {
      ticket.status = 'open'; // Reopen if customer replies to closed ticket
    }
    await ticket.save();

    // Emit socket event first
    const ticketNamespace = req.app.get('ticketNamespace');
    if (ticketNamespace && ticketNamespace.emitNewMessage) {
      ticketNamespace.emitNewMessage(ticketId, newMessage);
    }

    // Send response immediately
    res.json({
      success: true,
      message: 'Reply added successfully',
      data: newMessage,
    });

    // Send email notification in background (non-blocking)
    if (senderType === 'customer') {
      setImmediate(async () => {
        try {
          // Find organization email config to determine support email
          const OrgEmailConfig = require('./models/OrgEmailConfig');
          const orgId = req.organizationId || ticket.organization;
          console.log(`[WIDGET REPLY] Customer reply - Looking for email config, org: ${orgId}`);

          const emailConfig = await OrgEmailConfig.findOne({
            organization: orgId,
            isEnabled: true,
          }).lean();

          console.log(`[WIDGET REPLY] Found email config:`, {
            found: !!emailConfig,
            emailAddress: emailConfig?.emailAddress,
            organization: emailConfig?.organization,
          });

          if (emailConfig && emailConfig.emailAddress) {
            // Create threading headers for the reply notification
            const headers = {};
            const replyMessageId = `<${ticket.ticketId}.reply.${Date.now()}@bitmaxtest.com>`;
            const originalMessageId =
              ticket.externalMessageId ||
              `<${ticket.ticketId}.created.${ticket.createdAt.getTime()}@bitmaxtest.com>`;

            headers['Message-ID'] = replyMessageId;
            headers['In-Reply-To'] = originalMessageId; // Thread with original ticket
            headers['References'] = originalMessageId; // Thread with original ticket
            headers['X-Ticket-Source'] = 'widget'; // CRITICAL: Prevent IMAP from processing this as new ticket
            headers['X-Ticket-ID'] = ticket.ticketId;

            await sendEmailReply({
              organization: orgId,
              to: emailConfig.emailAddress, // Send to support team email
              subject: `Re: [Ticket #${ticket.ticketId}] ${ticket.subject}`, // Use "Re:" prefix for threading
              html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; background: #ffffff; border: 1px solid #e5e5e5;">
              <h2 style="color: #333; margin-bottom: 20px; border-bottom: 2px solid #4F46E5; padding-bottom: 10px;">Customer Reply</h2>
              
              <p>A customer has replied to a support ticket:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f9f9f9;">
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Ticket ID:</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${ticket.ticketId}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Customer:</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${ticket.customerName} (${
                ticket.customerEmail
              })</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Subject:</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${ticket.subject}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Status:</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${ticket.status}</td>
                </tr>
              </table>
              
              <div style="background: #f0f0f0; padding: 15px; margin: 20px 0; border-left: 4px solid #10b981;">
                <strong>Customer's Reply:</strong><br>
                ${html || message}
              </div>
              
              <p style="margin: 20px 0;"><a href="https://btclienterminal.com/FMG/" style="background: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">View in Dashboard</a></p>
              
              <hr style="margin: 20px 0;">
              <p style="font-size: 12px; color: #666;">Please respond to this customer's inquiry.</p>
            </div>
          `,
              text: `🔔 Customer Reply Alert\n\nTicket: ${ticket.ticketId}\nCustomer: ${ticket.customerName} (${ticket.customerEmail})\nSubject: ${ticket.subject}\nPriority: ${ticket.priority}\n\nCustomer's Reply:\n${message}\n\n⚡ Action Required: Please respond to this customer's inquiry.\n\nView Dashboard: https://btclienterminal.com/FMG/`,
              headers,
              attachments,
            });
            console.log(
              `[WIDGET REPLY] Notification sent successfully to support team: ${emailConfig.emailAddress}`
            );
          } else {
            console.warn(`[WIDGET REPLY] No email config found for organization: ${orgId}`);
          }
        } catch (emailError) {
          console.error(
            `[WIDGET REPLY] Failed to send notification to support team:`,
            emailError.message
          );
          console.error(`[WIDGET REPLY] Email error details:`, emailError);
          // Don't fail the reply if email fails
        }
      });
    }
  }),
];

// GET /tickets/:ticketId/messages - Get ticket messages from widget
exports.getTicketMessagesFromWidget = [
  validateApiKey,
  asyncHandler(async (req, res) => {
    const { ticketId } = req.params;
    const { customerEmail } = req.query;

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'customerEmail is required',
      });
    }

    const ticket = await EmailTicket.findOne({ ticketId, customerEmail });
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const messages = await EmailTicketMessage.find({ ticket: ticket._id })
      .populate('sender', 'email role alias') //TODO: we can also show name here but for privacy we don't want
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      success: true,
      messages,
    });
  }),
];

// GET /tickets - List tickets from widget
exports.listTicketsFromWidget = [
  validateApiKey,
  asyncHandler(async (req, res) => {
    const { status, customerEmail } = req.query;

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'customerEmail is required',
      });
    }

    const query = { customerEmail };

    if (status && status !== 'all') {
      const statuses = status.split(',');
      query.status = { $in: statuses };
    }

    const tickets = await EmailTicket.find(query)
      .populate('assignedTo', 'name email alias')
      .sort({ lastActivityAt: -1, createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: { tickets },
    });
  }),
];

// GET /attachments/download - Proxy download with proper headers to force attachment
exports.downloadAttachment = async (req, res) => {
  console.log('[downloadAttachment] Request received:', req.query);
  try {
    const { url, filename } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, message: 'url is required' });
    }

    const safeName = String(filename || 'download')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    // For PDFs, handle both old (image) and new (raw) resource types
    if (filename && filename.toLowerCase().endsWith('.pdf') && url.includes('cloudinary.com')) {
      console.log('[downloadAttachment] Processing PDF download for:', url);

      if (url.includes('/raw/upload/')) {
        // New PDFs stored as raw - stream with proper filename
        const separator = url.includes('?') ? '&' : '?';
        const downloadUrl = `${url}${separator}fl_attachment=true`;
        console.log('[downloadAttachment] Streaming raw PDF:', downloadUrl);

        const https = require('https');
        const { URL } = require('url');

        const request = https.get(downloadUrl, (cloudinaryRes) => {
          if (cloudinaryRes.statusCode === 200) {
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
            res.setHeader('Content-Type', 'application/pdf');
            if (cloudinaryRes.headers['content-length']) {
              res.setHeader('Content-Length', cloudinaryRes.headers['content-length']);
            }
            cloudinaryRes.pipe(res);
          } else {
            console.log('[downloadAttachment] Raw PDF failed:', cloudinaryRes.statusCode);
            cloudinaryRes.resume();
            res.status(404).json({ success: false, message: 'PDF download failed' });
          }
        });

        request.on('error', (error) => {
          console.log('[downloadAttachment] Raw PDF request error:', error.message);
          res.status(500).json({ success: false, message: 'Download error' });
        });

        return;
      } else if (url.includes('/image/upload/')) {
        // Old PDFs stored as image - try fl_attachment in path
        const downloadUrl = url.replace('/image/upload/', '/image/upload/fl_attachment/');
        console.log('[downloadAttachment] Image PDF URL:', downloadUrl);
        return res.redirect(downloadUrl);
      }
    }

    // Try to fetch - if 401, try switching between /image/ and /raw/
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');

    let fetchUrl = url;
    let attempts = 0;
    const maxAttempts = 2;

    const tryFetch = (attemptUrl) => {
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(attemptUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const request = protocol.get(attemptUrl, (cloudinaryRes) => {
          // Check for redirect
          if (
            cloudinaryRes.statusCode === 301 ||
            cloudinaryRes.statusCode === 302 ||
            cloudinaryRes.statusCode === 307 ||
            cloudinaryRes.statusCode === 308
          ) {
            const redirectUrl = cloudinaryRes.headers.location;
            if (redirectUrl) {
              cloudinaryRes.resume();
              return resolve({ retry: true, newUrl: redirectUrl });
            }
          }

          if (cloudinaryRes.statusCode === 401 || cloudinaryRes.statusCode === 404) {
            console.log(
              `[downloadAttachment] ${cloudinaryRes.statusCode} error for URL: ${attemptUrl}`
            );
            cloudinaryRes.resume();
            return resolve({ retry: true, switchType: true });
          }

          if (cloudinaryRes.statusCode !== 200) {
            cloudinaryRes.resume();
            console.error('[attachments/download] Cloudinary status:', cloudinaryRes.statusCode);
            return reject(new Error(`Failed to fetch file: ${cloudinaryRes.statusCode}`));
          }

          resolve({ success: true, response: cloudinaryRes });
        });

        request.on('error', (e) => {
          reject(e);
        });
      });
    };

    let result;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        result = await tryFetch(fetchUrl);

        if (result.success) {
          // Success - stream the file
          const cloudinaryRes = result.response;
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
          res.setHeader(
            'Content-Type',
            cloudinaryRes.headers['content-type'] || 'application/octet-stream'
          );
          if (cloudinaryRes.headers['content-length']) {
            res.setHeader('Content-Length', cloudinaryRes.headers['content-length']);
          }
          res.setHeader('Cache-Control', 'no-cache');
          cloudinaryRes.pipe(res).on('error', (e) => {
            console.error('[attachments/download] pipe error:', e?.message);
          });
          return;
        }

        if (result.retry) {
          if (result.newUrl) {
            fetchUrl = result.newUrl;
          } else if (result.switchType) {
            // Switch between /image/upload/ and /raw/upload/
            if (fetchUrl.includes('/image/upload/')) {
              // Parse the URL to extract public_id properly
              const urlMatch = fetchUrl.match(/\/image\/upload\/(v\d+\/)?(.*?)(\?|$)/);
              if (urlMatch) {
                const version = urlMatch[1] || '';
                let publicId = urlMatch[2];
                const queryString = fetchUrl.includes('?')
                  ? fetchUrl.substring(fetchUrl.indexOf('?'))
                  : '';

                // Remove file extension for raw access (Cloudinary raw doesn't use extensions in URL)
                publicId = publicId.replace(
                  /\.(pdf|jpg|jpeg|png|gif|webp|bmp|svg|docx?|xlsx?|xlsm|csv|pptx?|txt|rtf|zip|rar|7z)$/i,
                  ''
                );

                // Construct raw URL
                const baseUrl = fetchUrl.substring(0, fetchUrl.indexOf('/image/upload/'));
                fetchUrl = `${baseUrl}/raw/upload/${version}${publicId}${queryString}`;
                console.log('[attachments/download] Switching to raw:', fetchUrl);
              } else {
                // Simple replacement fallback
                fetchUrl = fetchUrl.replace('/image/upload/', '/raw/upload/');
              }
            } else if (fetchUrl.includes('/raw/upload/')) {
              // When switching from raw to image, we need to add extension back
              const urlMatch = fetchUrl.match(/\/raw\/upload\/(v\d+\/)?(.*?)(\?|$)/);
              if (urlMatch) {
                const version = urlMatch[1] || '';
                let publicId = urlMatch[2];
                const queryString = fetchUrl.includes('?')
                  ? fetchUrl.substring(fetchUrl.indexOf('?'))
                  : '';

                // Extract extension from filename if available
                let ext = '.pdf'; // default
                if (safeName.includes('.')) {
                  ext = '.' + safeName.split('.').pop();
                }

                const baseUrl = fetchUrl.substring(0, fetchUrl.indexOf('/raw/upload/'));
                fetchUrl = `${baseUrl}/image/upload/${version}${publicId}${ext}${queryString}`;
                console.log('[attachments/download] Switching to image:', fetchUrl);
              } else {
                fetchUrl = fetchUrl.replace('/raw/upload/', '/image/upload/');
              }
            } else {
              break;
            }
          }
        }
      } catch (e) {
        console.error(`[attachments/download] Attempt ${attempts} failed:`, e?.message);
        if (attempts >= maxAttempts) {
          throw e;
        }
      }
    }

    // All attempts failed
    if (!res.headersSent) {
      return res.status(404).json({ success: false, message: 'File not found or inaccessible' });
    }
  } catch (e) {
    console.error('[attachments/download] error:', e?.message);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ success: false, message: 'Download failed', error: e?.message });
    }
  }
};

// ============================================
// DUAL AUTHENTICATION ROUTES (JWT or API Key)
// ============================================

// POST /tickets - Dual authentication: JWT for dashboard, API key for widget
exports.createTicketDual = asyncHandler(async (req, res, next) => {
  // Check for JWT token first
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    // Has JWT - route to authenticated createTicket
    const { authenticateToken } = require('../middleware/tenantAuth');
    authenticateToken(req, res, (err) => {
      if (err) return next(err);
      exports.createTicket(req, res, next);
    });
  } else {
    // No JWT - route to widget handler
    exports.createTicketFromWidget[0](req, res, (err) => {
      if (err) return next(err);
      exports.createTicketFromWidget[1](req, res, next);
    });
  }
});

// GET /tickets - Dual authentication: JWT for dashboard, API key for widget
exports.listTicketsDual = asyncHandler(async (req, res, next) => {
  // Check for JWT token first
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    // Has JWT - route to authenticated listTickets
    const { authenticateToken } = require('../middleware/tenantAuth');
    authenticateToken(req, res, (err) => {
      if (err) return next(err);
      exports.listTickets(req, res, next);
    });
  } else {
    // No JWT - route to widget handler
    exports.listTicketsFromWidget[0](req, res, (err) => {
      if (err) return next(err);
      exports.listTicketsFromWidget[1](req, res, next);
    });
  }
});

// ============================================
// EMAIL TICKET STATISTICS ENDPOINT
// ============================================

// GET /stats - Get comprehensive email ticket statistics
exports.getTicketStats = asyncHandler(async (req, res) => {
  try {
    const organization = getOrgId(req);
    const User = require('../models/User');
    const mongoose = require('mongoose');

    if (!organization) {
      return res.status(400).json({ success: false, message: 'Organization required' });
    }

    // Convert organization to ObjectId if it's a string
    const orgId = mongoose.Types.ObjectId.isValid(organization)
      ? typeof organization === 'string'
        ? new mongoose.Types.ObjectId(organization)
        : organization
      : organization;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);

    const last30Days = new Date(today);
    last30Days.setDate(last30Days.getDate() - 30);

    // Ticket Status Stats
    const [totalTickets, openCount, pendingCount, closedCount] = await Promise.all([
      EmailTicket.countDocuments({ organization: orgId }),
      EmailTicket.countDocuments({ organization: orgId, status: { $regex: /^open$/i } }),
      EmailTicket.countDocuments({ organization: orgId, status: { $regex: /^pending$/i } }),
      EmailTicket.countDocuments({ organization: orgId, status: { $regex: /^closed$/i } }),
    ]);

    // Today's tickets
    const todayTickets = await EmailTicket.countDocuments({
      organization: orgId,
      createdAt: { $gte: today },
    });

    // Unassigned tickets
    const unassignedCount = await EmailTicket.countDocuments({
      organization: orgId,
      assignedTo: null,
      status: { $not: { $regex: /^closed$/i } },
    });

    // Priority breakdown
    const [highPriority, mediumPriority, lowPriority] = await Promise.all([
      EmailTicket.countDocuments({
        organization: orgId,
        priority: 'high',
        status: { $not: { $regex: /^closed$/i } },
      }),
      EmailTicket.countDocuments({
        organization: orgId,
        priority: 'medium',
        status: { $not: { $regex: /^closed$/i } },
      }),
      EmailTicket.countDocuments({
        organization: orgId,
        priority: 'low',
        status: { $not: { $regex: /^closed$/i } },
      }),
    ]);

    // Category/Team Inbox breakdown
    const categoryStats = await EmailTicket.aggregate([
      { $match: { organization: orgId } },
      { $group: { _id: '$teamInbox', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Agent performance stats
    const agentStats = await EmailTicket.aggregate([
      {
        $match: {
          organization: orgId,
          assignedTo: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$assignedTo',
          totalTickets: { $sum: 1 },
          openTickets: {
            $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] },
          },
          closedTickets: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] },
          },
        },
      },
      { $sort: { closedTickets: -1 } },
    ]);

    // Populate agent details
    const agentIds = agentStats
      .map((stat) => (mongoose.Types.ObjectId.isValid(stat._id) ? stat._id : null))
      .filter(Boolean);
    const agents = await User.find({ _id: { $in: agentIds } }).select('name alias email role');
    const agentMap = {};
    agents.forEach((agent) => {
      agentMap[agent._id.toString()] = {
        name: agent.name,
        alias: agent.alias,
        email: agent.email,
        role: agent.role,
      };
    });

    const agentPerformance = agentStats.map((stat) => ({
      agent: agentMap[stat._id ? stat._id.toString() : 'unknown'] || {
        name: 'Unknown',
        alias: '',
        email: '',
        role: 'Agent',
      },
      totalTickets: stat.totalTickets,
      openTickets: stat.openTickets,
      closedTickets: stat.closedTickets,
      resolutionRate:
        stat.totalTickets > 0 ? ((stat.closedTickets / stat.totalTickets) * 100).toFixed(1) : 0,
    }));

    // Response time stats (average time for first response)
    const ticketsWithMessages = await EmailTicket.find({
      organization: orgId,
      createdAt: { $gte: last30Days },
    })
      .limit(100)
      .lean();

    let totalResponseTime = 0;
    let responseCount = 0;

    for (const ticket of ticketsWithMessages) {
      const messages = await EmailTicketMessage.find({ ticket: ticket._id, senderType: 'agent' })
        .sort({ createdAt: 1 })
        .limit(1);

      if (messages.length > 0) {
        const responseTime =
          (new Date(messages[0].createdAt) - new Date(ticket.createdAt)) / 1000 / 60;
        if (responseTime > 0) {
          totalResponseTime += responseTime;
          responseCount++;
        }
      }
    }

    const avgResponseTime = responseCount > 0 ? (totalResponseTime / responseCount).toFixed(1) : 0;

    // Last 7 days trend with status breakdown (open, pending, closed)
    const last7DaysStats = await EmailTicket.aggregate([
      {
        $match: {
          organization: orgId,
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

    // Ticket status trend (open, pending, closed per day for last 7 days)
    const statusTrendOpen = await EmailTicket.aggregate([
      {
        $match: {
          organization: orgId,
          status: 'open',
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

    const statusTrendPending = await EmailTicket.aggregate([
      {
        $match: {
          organization: orgId,
          status: 'pending',
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

    const statusTrendClosed = await EmailTicket.aggregate([
      {
        $match: {
          organization: orgId,
          status: 'closed',
          updatedAt: { $gte: last7Days }, // Use updatedAt for closed
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

    // Merge status trends into ticketStatusTrend array
    const ticketStatusTrendMap = {};
    statusTrendOpen.forEach((item) => {
      ticketStatusTrendMap[item._id] = { date: item._id, open: item.count, pending: 0, closed: 0 };
    });
    statusTrendPending.forEach((item) => {
      if (ticketStatusTrendMap[item._id]) {
        ticketStatusTrendMap[item._id].pending = item.count;
      } else {
        ticketStatusTrendMap[item._id] = { date: item._id, open: 0, pending: item.count, closed: 0 };
      }
    });
    statusTrendClosed.forEach((item) => {
      if (ticketStatusTrendMap[item._id]) {
        ticketStatusTrendMap[item._id].closed = item.count;
      } else {
        ticketStatusTrendMap[item._id] = { date: item._id, open: 0, pending: 0, closed: item.count };
      }
    });

    // Fill in missing days with 0 values
    const ticketStatusTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      ticketStatusTrend.push(
        ticketStatusTrendMap[dateStr] || { date: dateStr, open: 0, pending: 0, closed: 0 }
      );
    }

    // User/Widget user count
    const widgetUserCount = await EmailTicket.distinct('customerEmail', {
      organization: orgId,
    }).then((emails) => emails.length);

    // Agent, QA, TL counts
    const [agentCount, qaCount, tlCount] = await Promise.all([
      User.countDocuments({ organizationId: orgId, role: 'Agent' }),
      User.countDocuments({ organizationId: orgId, role: 'QA' }),
      User.countDocuments({ organizationId: orgId, role: 'TL' }),
    ]);

    // Online agents count
    const onlineAgents = await User.countDocuments({
      organizationId: orgId,
      role: { $in: ['Agent', 'QA', 'TL'] },
      workStatus: 'active',
    });

    // Calculate CSAT Score from ticket evaluations
    const ticketEvaluations = await TicketEvaluation.find({
      organization: orgId,
      rating: { $exists: true, $ne: null },
    }).select('rating');

    let csatScore = 0;
    if (ticketEvaluations.length > 0) {
      const totalRating = ticketEvaluations.reduce((sum, eval) => sum + (eval.rating || 0), 0);
      const avgRating = totalRating / ticketEvaluations.length;
      csatScore = Math.round((avgRating / 5) * 100); // Convert to percentage
    }

    res.json({
      success: true,
      data: {
        ticketStats: {
          total: totalTickets,
          open: openCount,
          pending: pendingCount,
          closed: closedCount,
          today: todayTickets,
          unassigned: unassignedCount,
          csatScore, // Add CSAT score
        },
        priorityStats: {
          high: highPriority,
          medium: mediumPriority,
          low: lowPriority,
        },
        categoryStats: categoryStats.map((cat) => ({
          category: cat._id || 'uncategorized',
          count: cat.count,
        })),
        agentStats: {
          totalAgents: agentCount,
          totalQA: qaCount,
          totalTL: tlCount,
          onlineAgents: onlineAgents,
          topPerformers: agentPerformance,
        },
        performanceStats: {
          avgResponseTime: parseFloat(avgResponseTime),
          last7DaysTrend: last7DaysStats,
          ticketStatusTrend, // Status breakdown per day (open, pending, closed)
        },
        userStats: {
          totalWidgetUsers: widgetUserCount,
        },
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Error fetching ticket stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket statistics',
      error: error.message,
    });
  }
});

// ============================================
// MY TICKET STATISTICS (Role-Specific)
// ============================================

// GET /my-stats - Get personal ticket statistics based on role
exports.getMyTicketStats = asyncHandler(async (req, res) => {
  try {
    const organization = getOrgId(req);
    const userId = req.user?.id || req.user?._id;
    const userRole = req.user?.role;
    const mongoose = require('mongoose');

    if (!organization) {
      return res.status(400).json({ success: false, message: 'Organization required' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Convert to ObjectId
    const orgId = mongoose.Types.ObjectId.isValid(organization)
      ? typeof organization === 'string'
        ? new mongoose.Types.ObjectId(organization)
        : organization
      : organization;

    const userObjId = mongoose.Types.ObjectId.isValid(userId)
      ? typeof userId === 'string'
        ? new mongoose.Types.ObjectId(userId)
        : userId
      : userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let myStats = {};

    if (userRole === 'Agent') {
      // Agent-specific stats
      const [
        myInboxTotal,
        myInboxOpen,
        myInboxPending,
        myResolved,
        assignedByOthers,
        myTodayAssigned,
        departmentStats,
      ] = await Promise.all([
        // 1. Total tickets assigned to me
        EmailTicket.countDocuments({ organization: orgId, assignedTo: userObjId }),
        // 2. Open tickets in my inbox
        EmailTicket.countDocuments({ organization: orgId, assignedTo: userObjId, status: 'open' }),
        // 3. Pending tickets in my inbox
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          status: 'pending',
        }),
        // 4. Tickets I resolved (closed)
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          status: 'closed',
        }),
        // 5. Tickets assigned to me by QA/TL (not self-taken)
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          assignedBy: { $type: 'objectId', $ne: userObjId },
        }),
        // 6. Tickets assigned to me today
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          assignedAt: { $gte: today },
        }),
        // 7. Department Stats (Category-based)
        EmailTicket.aggregate([
          {
            $match: {
              organization: orgId,
              assignedTo: userObjId,
            },
          },
          {
            $group: {
              _id: '$category',
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      // Map categories to Department names
      const departmentMapping = {
        technical: 'Technicals',
        billing: 'Billings',
        support: 'Supports',
        account: 'Accounts',
        general: 'General',
        feature: 'Feature Request',
        bug: 'Bug Report',
      };

      const formattedDepartmentStats = departmentStats.map((stat) => ({
        department:
          departmentMapping[stat._id] || stat._id.charAt(0).toUpperCase() + stat._id.slice(1) + 's', // Fallback capitalization
        count: stat.count,
      }));

      myStats = {
        role: 'Agent',
        myInbox: {
          total: myInboxTotal,
          open: myInboxOpen,
          pending: myInboxPending,
        },
        myResolved: myResolved,
        assignedByOthers: assignedByOthers,
        todayAssigned: myTodayAssigned,
        departmentStats: formattedDepartmentStats,
      };
    } else if (userRole === 'QA' || userRole === 'TL') {
      // QA/TL-specific stats
      const [
        // 1. Personal Tickets (Self-assigned)
        myPersonalTotal,
        myPersonalOpen,
        myPersonalPending,
        myPersonalResolved,

        // 2. Escalated Tickets (High Priority assigned to me)
        myEscalatedTotal,
        myEscalatedOpen,
        myEscalatedPending,

        // 3. Review Stats (My Evaluations)
        totalReviewed,
        reviewedToday,
        avgScoreResult,
      ] = await Promise.all([
        // Personal
        EmailTicket.countDocuments({ organization: orgId, assignedTo: userObjId }),
        EmailTicket.countDocuments({ organization: orgId, assignedTo: userObjId, status: 'open' }),
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          status: 'pending',
        }),
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          status: 'closed',
        }),

        // Escalated (Assigned to me by OTHERS - regardless of priority)
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          assignedBy: { $ne: userObjId, $ne: null }, // Assigned by someone else
        }),
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          assignedBy: { $ne: userObjId, $ne: null },
          status: 'open',
        }),
        EmailTicket.countDocuments({
          organization: orgId,
          assignedTo: userObjId,
          assignedBy: { $ne: userObjId, $ne: null },
          status: 'pending',
        }),

        // Reviews
        TicketEvaluation.countDocuments({ evaluatedBy: userObjId }),
        TicketEvaluation.countDocuments({ evaluatedBy: userObjId, createdAt: { $gte: today } }),
        TicketEvaluation.aggregate([
          { $match: { evaluatedBy: userObjId } },
          { $group: { _id: null, avgScore: { $avg: '$totalScore' } } },
        ]),
      ]);

      myStats = {
        role: userRole,
        personalStats: {
          total: myPersonalTotal,
          open: myPersonalOpen,
          pending: myPersonalPending,
          resolved: myPersonalResolved,
        },
        escalatedStats: {
          total: myEscalatedTotal,
          open: myEscalatedOpen,
          pending: myEscalatedPending,
        },
        reviewStats: {
          totalReviewed,
          reviewedToday,
          avgScore: avgScoreResult[0]?.avgScore?.toFixed(1) || 0,
        },
      };
    } else if (userRole === 'Admin') {
      // Admin sees organization-wide stats
      const [totalTickets, openCount, pendingCount, closedCount, unassignedCount] =
        await Promise.all([
          EmailTicket.countDocuments({ organization: orgId }),
          EmailTicket.countDocuments({ organization: orgId, status: 'open' }),
          EmailTicket.countDocuments({ organization: orgId, status: 'pending' }),
          EmailTicket.countDocuments({ organization: orgId, status: 'closed' }),
          EmailTicket.countDocuments({
            organization: orgId,
            assignedTo: null,
            status: { $ne: 'closed' },
          }),
        ]);

      myStats = {
        role: 'Admin',
        organization: {
          total: totalTickets,
          open: openCount,
          pending: pendingCount,
          closed: closedCount,
          unassigned: unassignedCount,
        },
      };
    }

    res.json({
      success: true,
      data: myStats,
    });
  } catch (error) {
    console.error('❌ Error fetching my ticket stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch personal ticket statistics',
      error: error.message,
    });
  }
});
