const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const EmailTicket = require('./models/Ticket');
const EmailTicketMessage = require('./models/TicketMessage');
const logger = require('./utils/logger');

/**
 * Generate a unique sequential ticket ID. Example: EML-20251125-0001
 */
async function generateTicketId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const prefix = `EML-${ymd}-`;

  // Find the highest ticket number for today
  const lastTicket = await EmailTicket.findOne({
    ticketId: { $regex: `^${prefix}` },
  })
    .sort({ ticketId: -1 })
    .select('ticketId')
    .lean();

  let nextNum = 1;
  if (lastTicket && lastTicket.ticketId) {
    const match = lastTicket.ticketId.match(/-(\d+)$/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/**
 * Create a ticket document for an inbound email. Prevent duplicates by Message-ID.
 * @param {Object} parsed - parsed email (mailparser result)
 * @param {ObjectId|String} organization - org id for multi-tenant
 */
async function createTicketFromEmail(parsed, organization) {
  const messageId = parsed.messageId || parsed.headers.get('message-id');
  const inReplyTo = parsed.inReplyTo || parsed.headers.get('in-reply-to');
  const references = parsed.references || [];
  const subject = parsed.subject || '';
  const customerEmail = parsed.from?.value?.[0]?.address;

  console.log('[IMAP] ========== PROCESSING EMAIL ==========');
  console.log('[IMAP] Email details:', {
    subject,
    customerEmail,
    messageId,
    inReplyTo,
    hasReferences: references.length > 0,
    organization,
  });

  // STEP 0: Check if this is a support team notification (widget-generated)
  // These should NOT be processed by IMAP to avoid duplicates
  const xTicketSource = parsed.headers?.get('x-ticket-source');
  const xTicketId = parsed.headers?.get('x-ticket-id');

  console.log('[IMAP] 🔍 HEADERS DEBUG:', {
    hasHeaders: !!parsed.headers,
    xTicketSource,
    xTicketId,
    allHeaderKeys: parsed.headers ? Array.from(parsed.headers.keys()) : [],
  });

  if (xTicketSource === 'widget' && xTicketId) {
    console.log(
      '[IMAP] ⚠️  SKIPPING - This is a widget notification email (X-Ticket-Source header)'
    );
    console.log('[IMAP] Widget ticket already exists:', xTicketId);
    const existingTicket = await EmailTicket.findOne({ ticketId: xTicketId, organization });
    return existingTicket;
  }

  // Additional check: Skip if subject contains "New Widget Ticket:" or "Customer Reply:" (our notification patterns)
  if (subject.includes('New Widget Ticket:') || subject.includes('Customer Reply:')) {
    console.log('[IMAP] ⚠️  SKIPPING - This is a widget notification email (subject pattern)');

    // Try to extract ticket ID from subject
    const ticketIdMatch = subject.match(/([A-Z]{3}-\d{8}-\d{4})/);
    if (ticketIdMatch) {
      const ticketId = ticketIdMatch[1];
      console.log('[IMAP] Found ticket ID in notification subject:', ticketId);
      const existingTicket = await EmailTicket.findOne({ ticketId, organization });
      if (existingTicket) {
        return existingTicket;
      }
    }

    // If we can't find the ticket, skip processing this email
    console.log('[IMAP] Skipping notification email - ticket will be managed via widget');
    return null;
  }

  // STEP 1: Check for duplicate message ID first
  const duplicate = await EmailTicketMessage.findOne({
    externalMessageId: messageId,
    organization,
  });
  if (duplicate) {
    console.log('[IMAP] ⚠️  DUPLICATE MESSAGE ID - Email already processed, skipping');
    const existingTicket = await EmailTicket.findById(duplicate.ticket);
    return existingTicket;
  }

  // STEP 2: Try to find existing ticket via inReplyTo header
  if (inReplyTo) {
    console.log('[IMAP] 🔍 Checking inReplyTo header:', inReplyTo);
    const existingMsg = await EmailTicketMessage.findOne({
      externalMessageId: inReplyTo,
      organization,
    });
    if (existingMsg) {
      const ticket = await EmailTicket.findById(existingMsg.ticket);
      if (ticket) {
        console.log('[IMAP] ✅ FOUND EXISTING TICKET via inReplyTo:', ticket.ticketId);
        await addReplyToTicket(ticket, parsed, messageId, inReplyTo, references, organization);
        return ticket;
      }
    } else {
      console.log('[IMAP] ❌ No message found with inReplyTo:', inReplyTo);
    }
  }

  // STEP 3: Try to match ticket ID in subject line (MOST IMPORTANT for widget tickets)
  console.log('[IMAP] 🔍 Checking subject for ticket ID:', subject);

  // More comprehensive regex to catch various ticket ID formats
  const ticketIdPatterns = [
    /\[Ticket #([A-Z]{3}-\d{8}-\d{4})\]/i, // [Ticket #EML-20251203-0001]
    /#([A-Z]{3}-\d{8}-\d{4})/i, // #EML-20251203-0001
    /([A-Z]{3}-\d{8}-\d{4})/i, // EML-20251203-0001
    /Re:\s*\[Ticket #([A-Z]{3}-\d{8}-\d{4})\]/i, // Re: [Ticket #EML-20251203-0001]
    /Re:\s*([A-Z]{3}-\d{8}-\d{4})/i, // Re: EML-20251203-0001
  ];

  let ticketId = null;
  for (const pattern of ticketIdPatterns) {
    const match = subject.match(pattern);
    if (match) {
      ticketId = match[1];
      console.log('[IMAP] 🎯 FOUND TICKET ID in subject:', ticketId, 'Pattern:', pattern);
      break;
    }
  }

  if (ticketId && customerEmail) {
    console.log('[IMAP] 🔍 Looking for existing ticket:', {
      ticketId,
      customerEmail,
      organization,
    });

    // Try exact match first
    let existingTicket = await EmailTicket.findOne({
      ticketId,
      customerEmail,
      organization,
    });

    // If not found, try case-insensitive search
    if (!existingTicket) {
      existingTicket = await EmailTicket.findOne({
        ticketId: { $regex: new RegExp(`^${ticketId}$`, 'i') },
        customerEmail: { $regex: new RegExp(`^${customerEmail}$`, 'i') },
        organization,
      });
    }

    if (existingTicket) {
      console.log('[IMAP] ✅ FOUND EXISTING TICKET via subject line:', existingTicket.ticketId);
      await addReplyToTicket(
        existingTicket,
        parsed,
        messageId,
        inReplyTo,
        references,
        organization
      );
      return existingTicket;
    } else {
      console.log('[IMAP] ❌ No ticket found for:', { ticketId, customerEmail });

      // Debug: Let's see what tickets exist for this customer
      const customerTickets = await EmailTicket.find({ customerEmail, organization })
        .select('ticketId customerEmail')
        .limit(5);
      console.log('[IMAP] 📋 Customer tickets found:', customerTickets);
    }
  }

  // STEP 4: Fallback - Look for recent widget tickets from same customer
  if (customerEmail) {
    console.log('[IMAP] 🔍 Fallback: Looking for recent widget tickets from:', customerEmail);

    const recentTicket = await EmailTicket.findOne({
      customerEmail: { $regex: new RegExp(`^${customerEmail}$`, 'i') },
      organization,
      channel: 'widget',
      createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }, // 6 hours window
      status: { $ne: 'closed' },
    }).sort({ createdAt: -1 });

    if (recentTicket) {
      console.log('[IMAP] ✅ FOUND RECENT WIDGET TICKET:', recentTicket.ticketId);
      await addReplyToTicket(recentTicket, parsed, messageId, inReplyTo, references, organization);
      return recentTicket;
    } else {
      console.log('[IMAP] ❌ No recent widget tickets found for customer');
    }
  }

  // STEP 5: No existing ticket found, create new one
  console.log('[IMAP] ❌ NO EXISTING TICKET FOUND - Creating new ticket');
  console.log('[IMAP] Reasons why new ticket is being created:', {
    subject,
    customerEmail,
    hasInReplyTo: !!inReplyTo,
    foundTicketIdInSubject: !!ticketId,
    ticketIdFound: ticketId,
    messageId,
    organization,
  });

  const newTicket = await EmailTicket.create({
    ticketId: await generateTicketId(),
    subject: subject || '(no subject)',
    customerName: parsed.from?.value?.[0]?.name || parsed.from?.text || 'Unknown',
    customerEmail: customerEmail || null,
    channel: 'email',
    status: 'pending', // New tickets start as pending
    organization,
    emailThreadRootId: messageId || undefined,
  });

  await EmailTicketMessage.create({
    ticket: newTicket._id,
    ticketId: newTicket.ticketId,
    organization,
    senderType: 'customer',
    message: parsed.text || '',
    html: parsed.html || '',
    attachments: (parsed.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      cid: a.cid,
    })),
    externalMessageId: messageId,
    references,
    from: parsed.from?.text,
    to: parsed.to?.value?.map((v) => v.address) || [],
    cc: parsed.cc?.value?.map((v) => v.address) || [],
    date: parsed.date || new Date(),
  });

  console.log('[IMAP] ✅ Created new email ticket:', newTicket.ticketId);
  logger.info('Created new email ticket', newTicket.ticketId);
  return newTicket;
}

/**
 * Helper function to add a reply to an existing ticket
 */
async function addReplyToTicket(ticket, parsed, messageId, inReplyTo, references, organization) {
  console.log('[IMAP] 💬 Adding reply to ticket:', ticket.ticketId);

  await EmailTicketMessage.create({
    ticket: ticket._id,
    ticketId: ticket.ticketId,
    organization,
    senderType: 'customer',
    senderName: parsed.from?.value?.[0]?.name || parsed.from?.text || ticket.customerEmail,
    message: parsed.text || '',
    html: parsed.html || '',
    attachments: (parsed.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      cid: a.cid,
    })),
    externalMessageId: messageId,
    inReplyTo,
    references,
    from: parsed.from?.text,
    to: parsed.to?.value?.map((v) => v.address) || [],
    cc: parsed.cc?.value?.map((v) => v.address) || [],
    date: parsed.date || new Date(),
  });

  // Auto-reopen ticket if customer replies to closed ticket
  if (ticket.status === 'closed') {
    ticket.status = 'open';
    console.log('[IMAP] 🔓 Ticket reopened due to customer reply:', ticket.ticketId);
  }

  ticket.lastActivityAt = new Date();
  await ticket.save();

  console.log('[IMAP] ✅ Reply added successfully to ticket:', ticket.ticketId);
}

/**
 * Create a manual internal ticket (non-email).
 */
async function createInternalTicket(payload) {
  const {
    title,
    description,
    category,
    priority,
    assignedTo,
    createdBy,
    organization,
    customerEmail,
    customerName,
    teamInbox,
  } = payload;

  const ticket = await EmailTicket.create({
    ticketId: await generateTicketId(),
    subject: title,
    customerName: customerName || null,
    customerEmail: customerEmail || null,
    channel: 'internal',
    status: assignedTo ? 'open' : 'pending', // If assigned at creation, set to open
    priority: priority || 'medium',
    assignedTo: assignedTo || null,
    createdBy: createdBy || null,
    teamInbox: teamInbox || 'General',
    organization,
  });

  await EmailTicketMessage.create({
    ticket: ticket._id,
    ticketId: ticket.ticketId,
    organization,
    senderType: 'system',
    message: description || '',
    html: `<p>${description || ''}</p>`,
    attachments: [],
  });

  return ticket;
}

/**
 * Add a message (reply/comment) to a ticket.
 */
async function addTicketMessage({
  ticket,
  organization,
  senderType,
  message,
  html,
  sender,
  senderName,
  meta = {},
}) {
  const doc = await EmailTicketMessage.create({
    ticket: ticket._id,
    ticketId: ticket.ticketId,
    organization,
    senderType,
    sender,
    senderName,
    message: message || '',
    html: html || '',
    attachments: meta.attachments || [],
    externalMessageId: meta.externalMessageId,
    inReplyTo: meta.inReplyTo,
    references: meta.references,
    from: meta.from,
    to: meta.to,
    cc: meta.cc,
    date: meta.date || new Date(),
  });

  // Update ticket's lastActivityAt
  await EmailTicket.findByIdAndUpdate(ticket._id, { lastActivityAt: new Date() });

  return doc;
}

async function getTicketWithMessages(idOrTicketId, organization) {
  const key = (idOrTicketId || '').toString().trim();
  const or = [{ ticketId: key }];
  if (mongoose.Types.ObjectId.isValid(key)) {
    or.push({ _id: key });
  }
  const ticket = await EmailTicket.findOne({ organization, $or: or })
    .populate('assignedTo', 'name email role alias profilePic')
    .populate('assignedBy', 'name email role alias')
    .populate('createdBy', 'name email');
  if (!ticket) return null;
  const messages = await EmailTicketMessage.find({ ticket: ticket._id })
    .populate('sender', 'name email role alias')
    .sort({ createdAt: 1 });
  return { ticket, messages };
}

module.exports = {
  createTicketFromEmail,
  createInternalTicket,
  addTicketMessage,
  getTicketWithMessages,
  generateTicketId,
};
