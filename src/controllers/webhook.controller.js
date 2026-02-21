
// ✅ Controller: src/controllers/webhook.controller.js
const { sendRealTimeMessage } = require('../middleware/messageMiddleware');
const Message = require('../models/Message');
const Query = require('../models/Query');
const Organization = require('../models/Organization');
const { v4: uuidv4 } = require('uuid');
const CallScreenshot = require('../models/CallScreenshot');
const { uploadToCloudinary } = require('../config/cloudinary');
const fs = require('fs');

exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
};
exports.receiveWebhookMessage = async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;

  const messages = changes?.messages;
  if (!messages) return res.sendStatus(200);

  try {
    for (const msg of messages) {
      const from = msg.from;
      const text = msg.text?.body;
      const timestamp = new Date(Number(msg.timestamp) * 1000);
      const petitionToken = uuidv4();

      const newMessage = await Message.create({
        message: text,
        source: 'whatsapp',
        timestamp,
        petitionToken,
        status: 'received',
        userId: null,
        from,
        to: changes.metadata?.display_phone_number,
        platform: 'whatsapp',
        direction: 'incoming',
        isRead: false
      });

      sendRealTimeMessage({ userId: null, applicantId: null, message: newMessage });

      console.log(`✅ Message received from ${from}`);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing incoming message:', error);
    return res.sendStatus(500);
  }
};

/**
 * Create guest conversation from Chat Widget
 */
exports.createGuestConversation = async (req, res) => {
  try {
    const { apiKey, guestName, guestEmail, guestPhone, customUserId, priority, department, category } = req.body;

    console.log('📥 Guest conversation request:', { apiKey: apiKey?.substring(0, 10) + '...', guestName, guestEmail });

    // Validate API key
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      });
    }

    // Find organization by API key
    const organization = await Organization.findOne({
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });

    if (!organization) {
      console.error('❌ Invalid API key or organization not found');
      return res.status(401).json({
        success: false,
        message: 'Invalid API key or organization not found'
      });
    }

    console.log(`✅ Organization found: ${organization.name} (${organization.organizationId})`);

    // Normalize priority & category (updated to match Query model enum)
    const allowedPriorities = ['Low', 'Medium', 'High', 'Urgent'];
    const normalizedPriority = allowedPriorities.includes((priority || '').trim()) ? priority.trim() : 'Medium';
    
    // Updated to match Query model's category enum values
    const allowedCategories = ['Booking', 'Cancellation', 'Reschedule', 'Refund', 'Baggage', 'Check-in', 'Meal / Seat', 'Visa / Travel Advisory', 'Other'];
    const inputCategory = (department || category || '').trim();
    const normalizedCategory = allowedCategories.includes(inputCategory) ? inputCategory : 'Other';

    // Generate petition ID (format: PET-TIMESTAMP-RANDOM)
    const petitionId = `PET-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Create conversation ID
    const conversationId = uuidv4();

    // Prepare customer name and email
    const customerName = guestName || 'Guest User';
    const customerEmail = guestEmail || `guest-${Date.now()}@widget.local`;
    const isGuest = !guestEmail || guestEmail === null;

    // Create query record with all required fields
    const query = await Query.create({
      organizationId: organization._id,
      petitionId,
      conversationId,
      customer: null, // No user account for guests
      customerName,
      customerEmail,
      customerPhone: guestPhone || 'Not provided',
      isGuestCustomer: isGuest,
      subject: 'Chat Inquiry',
      category: normalizedCategory,
      priority: normalizedPriority,
      status: 'Pending',
      messages: [],
      lastActivityAt: new Date()
    });

    console.log(`✅ Guest conversation created: ${conversationId} | Petition: ${petitionId} | Org: ${organization.name}`);

    // Emit socket event to notify agents of SAME ORGANIZATION only
    try {
      const io = req.app.get('io');
      console.log('🔍 DEBUG: Socket.io instance available:', !!io);
      
      if (io) {
        const eventData = {
          petitionId: query.petitionId,
          customerName: query.customerName,
          subject: query.subject,
          category: query.category,
          priority: query.priority,
          organizationId: organization._id.toString(),
          timestamp: new Date(),
          isGuest: true
        };
        const orgRoom = `org:${organization._id}`;

        // --- 🎯 ROBUST FILTERING LOGIC (Same as query.controller.js) ---
        const User = require('../models/User'); // Ensure User model is available

        // 1. Find all "Available" agents in DB (Active status + Correct Role)
        // For NEW queries: Only notify Agents (not TL/QA - they only handle escalations)
        const availableUsers = await User.find({
          organizationId: organization._id,
          role: 'Agent', // ✅ Only Agents get new query notifications
          workStatus: 'active'
        }).distinct('_id');

        const availableUserIds = availableUsers.map((id) => id.toString());

        // 2. Find all "Busy" agents (Active Queries: Accepted or In Progress)
        const busyAgents = await Query.find({
          organizationId: organization._id,
          status: { $in: ['Accepted', 'In Progress'] },
          assignedTo: { $ne: null }
        }).distinct('assignedTo');

        const busyAgentIds = busyAgents.map((id) => id.toString());

        // 3. Determine Final Target List (Available - Busy)
        const targetUserIds = availableUserIds.filter(
          (id) => !busyAgentIds.includes(id)
        );

        console.log(`🎯 [Guest] Notification Targets Calculation:`, {
          totalActive: availableUserIds.length,
          availableUserIds,
          totalBusy: busyAgentIds.length,
          busyAgentIds,
          finalTargets: targetUserIds.length,
          targetUserIds,
        });

        // 4. Get sockets and emit
        const queryNamespace = io.of('/query');
        const roomSockets = await queryNamespace.in(orgRoom).fetchSockets();
        let sentCount = 0;

        console.log(`🔌 [Guest] Sockets in room ${orgRoom}: ${roomSockets.length}`);

        for (const socket of roomSockets) {
          const socketUserId = socket.userId
            ? socket.userId.toString()
            : 'unknown';

          console.log(
            `🔍 [Guest] Checking socket: ${
              socket.id
            } | User: ${socketUserId} | Target? ${targetUserIds.includes(
              socketUserId
            )}`
          );

          if (targetUserIds.includes(socketUserId)) {
            // 🛡️ DOUBLE CHECK: Explicitly verify if this specific user is busy
            const isTrulyBusy = await Query.exists({
              assignedTo: socketUserId,
              status: { $in: ['Accepted', 'In Progress'] },
            });

            if (isTrulyBusy) {
              console.log(
                `🚫 [Guest] Skipped busy agent (Double Check): ${socketUserId}`
              );
              continue;
            }

            socket.emit('new-pending-query', eventData);
            sentCount++;
            console.log(`✅ [Guest] Sent notification to user: ${socketUserId}`);
          } else {
            console.log(`⏩ [Guest] Skipped (not in target list): ${socketUserId}`);
          }
        }
        console.log(`📊 [Guest] Notification Summary: Sent to ${sentCount}/${roomSockets.length} sockets in ${orgRoom}`);
      } else {
        console.warn('⚠️ Socket.io instance not found on req.app for guest conversation');
      }
    } catch (emitErr) {
      console.error('❌ Failed to emit new-pending-query (guest):', emitErr.message, emitErr.stack);
    }

    return res.status(200).json({
      success: true,
      conversationId,
      petitionId,
      queryId: query._id,
      organizationId: organization.organizationId,
      organizationName: organization.name,
      message: 'Conversation created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating guest conversation:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message
    });
  }
};

/**
 * Receive widget message via REST (for standalone embed)
 * Expected body: { apiKey, conversationId?, petitionId?, message, senderName? }
 * Auth: Organization API key (no JWT required)
 */
exports.sendWidgetMessage = async (req, res) => {
  try {
    const { apiKey, conversationId, petitionId, message, senderName } = req.body || {};

    if (!apiKey) {
      return res.status(400).json({ success: false, message: 'API key is required' });
    }
    if (!message || (!conversationId && !petitionId)) {
      return res.status(400).json({ success: false, message: 'message and (conversationId or petitionId) are required' });
    }

    // Validate API key
    const organization = await Organization.findOne({
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });
    if (!organization) {
      return res.status(401).json({ success: false, message: 'Invalid API key' });
    }

    // Find query by petitionId or conversationId within organization
    const Query = require('../models/Query');
    const query = await Query.findOne(
      petitionId ? { petitionId, organizationId: organization._id } : { conversationId, organizationId: organization._id }
    );
    if (!query) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Append message as customer
    const newMessage = {
      sender: null,
      senderName: senderName || 'Guest User',
      senderRole: 'Customer',
      message,
      timestamp: new Date(),
      isRead: false
    };
    query.messages.push(newMessage);
    query.lastActivityAt = new Date();
    await query.save();

    const saved = await Query.findById(query._id);
    const savedMsg = saved.messages[saved.messages.length - 1];

    // Emit to agents listening on query namespace
    try {
      const io = req.app.get('io');
      if (io) {
        const qNs = io.of('/query');
        qNs.to(saved.petitionId).emit('new-query-message', {
          petitionId: saved.petitionId,
          message: {
            _id: savedMsg._id,
            sender: savedMsg.sender,
            senderName: savedMsg.senderName,
            senderRole: savedMsg.senderRole,
            message: savedMsg.message,
            timestamp: savedMsg.timestamp
          },
          queryStatus: saved.status
        });
      }
    } catch (emitErr) {
      console.error('❌ Failed to emit widget REST message:', emitErr.message);
    }

    return res.status(200).json({ success: true, messageId: savedMsg._id });
  } catch (error) {
    console.error('❌ Widget webhook send-message error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};

/**
 * Upload snapshot from Widget (no JWT; API key required)
 * Multipart form-data: screenshot (file), petitionId, apiKey, participants?, metadata?
 */
exports.uploadWidgetSnapshot = async (req, res) => {
  try {
    const { apiKey, petitionId, participants, metadata } = req.body || {};
    if (!apiKey) {
      // Clean up uploaded file if present
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'API key is required' });
    }
    if (!petitionId) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'petitionId is required' });
    }

    // Validate API key -> organization must exist and be active
    const organization = await Organization.findOne({
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });
    if (!organization) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(401).json({ success: false, message: 'Invalid API key' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No screenshot file provided' });
    }

    // Parse optional participants/metadata
    let parsedParticipants = [];
    try {
      if (participants) {
        const arr = typeof participants === 'string' ? JSON.parse(participants) : participants;
        if (Array.isArray(arr)) parsedParticipants = arr;
      }
    } catch {}
    let parsedMetadata = {};
    try {
      if (metadata) parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    } catch {}

    // Validate petition belongs to organization
    const Query = require('../models/Query');
    const query = await Query.findOne({ petitionId, organizationId: organization._id });
    if (!query) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Petition not found for organization' });
    }

    // Upload to Cloudinary
    const cloudRes = await uploadToCloudinary(req.file.path, 'call-screenshots');
    // Delete local temp file
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // Persist CallScreenshot (capturedBy is null for guest)
    const snap = await CallScreenshot.create({
      roomId: petitionId,
      petitionId,
      capturedBy: null, // guest/widget upload
      participants: parsedParticipants,
      imagePath: req.file.filename,
      imageUrl: cloudRes.url,
      cloudinaryPublicId: cloudRes.publicId,
      callType: 'snapshot',
      metadata: {
        ...parsedMetadata,
        uploadedBy: 'widget',
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        customerName: query.customerName,
        querySubject: query.subject
      }
    });

    const populated = await CallScreenshot.findById(snap._id)
      .populate('capturedBy', 'name email role')
      .populate('participants.userId', 'name email role');

    return res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error('❌ uploadWidgetSnapshot error:', error);
    // Best-effort cleanup
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    return res.status(500).json({ success: false, message: 'Failed to upload snapshot' });
  }
};
