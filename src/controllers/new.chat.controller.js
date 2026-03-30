const User = require('../models/User');
const Conversation = require('../models/Conversation');
const generatePetition = require('../utils/generatePetation');

/**
 * Start a new conversation (Customer Public API)
 */
exports.startConversation = async (req, res) => {
  try {
    const { name, email, mobile, department, query } = req.body;

    if (!name || !email || !mobile || !department || !query) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const newConversation = await Conversation.create({
     name, email, mobile, department, query ,
      isConversationStarted: true
  });

    res.status(201).json({
      success: true,
      message: "Conversation started successfully",
      data: newConversation
    });
  } catch (error) {
    console.error("Start conversaconversationIdtion error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, from,to, message } = req.body;

    // ✅ Validate inputs
    if (!message) {
      return res.status(400).json({
        success: false,
        message: "message are required"
      });
    }

    // ✅ Find conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });
    }

    

    // ✅ Prepare new message
    const newMessage = {
      from, // Can be customer email or agent's ObjectId (string)
      to,
      message,
      petitionId: generatePetition(),
      replies: []
    };

    // ✅ Push to conversation
    conversation.messages.push(newMessage);
    await conversation.save();

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      data: newMessage
    });
  } catch (error) {
    console.error("Send message error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.message
    });
  }
};
exports.getAllConversations = async (req, res) => {
  try {
    const userId = req.user?.id; // From JWT
    const role = req.user?.role; // "agent" or "customer"
    const { conversationId } = req.params;

    let conversation;

    if (conversationId) {
      // ✅ Fetch specific conversation by ID
      conversation = await Conversation.findById(conversationId)
        .populate("assignedAgent", "name email")
        .populate("messages.from", "name email")
        .populate("messages.to", "name email");

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      // ✅ Authorization Check
      if (role === "agent" && conversation.assignedAgent?._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to view this conversation"
        });
      }

      if (role === "customer" && conversation.customerId?.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to view this conversation"
        });
      }

    } else {
      // ✅ Fetch all conversations for the logged-in user
      let filter = {};

      if (role === "agent") {
        filter.assignedAgent = userId;
      } else if (role === "customer") {
        filter.customerId = userId;
      } else {
        return res.status(403).json({
          success: false,
          message: "Unauthorized role"
        });
      }

      conversation = await Conversation.find(filter)
        .populate("assignedAgent", "name email")
        .populate("messages.from", "name email")
        .populate("messages.to", "name email")
        .sort({ updatedAt: -1 });
    }

    return res.status(200).json({
      success: true,
      message: conversationId ? "Conversation fetched successfully" : "Conversations list fetched",
      data: conversation
    });
  } catch (error) {
    console.error("Error fetching conversation:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversation",
      error: error.message
    });
  }
};

exports.transferPetition = async (req, res) => {
  try {
    const { petitionId, newAgentId } = req.body;
    const agentUserId = req.user?.id; 

    // ✅ Validate input
    if (!petitionId || !newAgentId) {
      return res.status(400).json({ success: false, message: "petitionId and newAgentId are required" });
    }

    // ✅ Find new agent
    const newAgent = await User.findById(newAgentId);
    if (!newAgent || newAgent.role !== "Agent") {
      return res.status(404).json({ success: false, message: "Agent not found or invalid role" });
    }

    // ✅ Find petition by petitionId
   const petition = await Conversation.findOne({ "messages.petitionId": petitionId });
    if (!petition) {
      return res.status(404).json({ success: false, message: `No petition found with ID: ${petitionId}` });
    }

    // ✅ Check if already assigned to this agent
    if (petition.assignedTo?.toString() === newAgentId) {
      return res.status(400).json({ success: false, message: "Petition is already assigned to this agent" });
    }

    // ✅ Update petition details
    petition.assignedTo = newAgent._id;
    petition.status = "transferred";
    petition.transferredBy = agentUserId;
    petition.forwardedAt = new Date();

    await petition.save();

    res.status(200).json({
      success: true,
      message: `Petition ${petitionId} transferred to ${newAgent.user_name}`,
      data: petition
    });

  } catch (error) {
    console.error("Transfer petition error:", error.message);
    res.status(500).json({ success: false, message: "Failed to transfer petition", error: error.message });
  }
};
exports.replyOnPetition = async (req, res) => {
  try {
    const agentId = req.user.id; // Agent from token
    
    const {petitionId, message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: "Reply message is required" });
    }

    const conversation = await Conversation.findOneAndUpdate(
      { "messages.petitionId": petitionId },
      {
        $push: {
          "messages.$.replies": { from: agentId, message }
        }
      },
      { new: true }
    )
    .populate("messages.from", "user_name email")
    .populate("messages.to", "user_name email")
    .populate("messages.replies.from", "user_name email");

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Petition not found" });
    }

    res.status(200).json({
      success: true,
      message: "Reply added successfully",
      data: conversation
    });
  } catch (error) {
    console.error("Reply on petition error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPetitionDetails = async (req, res) => {
  try {
    const { petitionId } = req.params;
     const petition = await Conversation.findOne({ petitionId })
      .populate('from', 'user_name email')
      .populate('to', 'user_name email')
      .populate('transferredBy', 'user_name email')
      .populate('assignedTo', 'user_name department')
      .populate({
          path: 'messages',
          model: 'Reply',
          populate: { path: 'sender', select: 'user_name email' }
        });

    if (!petition) return res.status(404).json({ success: false, message: "Petition not found" });

    res.status(200).json({ success: true, data: petition });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch petition", error: error.message });
  }
};

exports.closeConversation = async (req, res) => {
  try {
    const { conversationId } = req.body;

    // ✅ Validate input
    if (!conversationId) {
      return res.status(400).json({ success: false, message: "conversationId is required" });
    }

    // ✅ Update status only if it's not already closed
    const convo = await Conversation.findOneAndUpdate(
      { _id: conversationId, status: { $ne: "closed" } }, // prevent unnecessary update
      { $set: { status: "closed", closedAt: new Date() } }, // optional: track closed time
      { new: true, runValidators: false }
    );

    if (!convo) {
      return res.status(404).json({ success: false, message: "Conversation not found or already closed" });
    }

    return res.status(200).json({
      success: true,
      message: "Conversation closed successfully",
      data: convo
    });

  } catch (error) {
    console.error("Close conversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.getAllCustomers = async (req, res) => {
  try {
    const customers = await Conversation.find({}, "name email mobile department query createdAt") // only needed fields
      .sort({ createdAt: -1 }); // newest first

    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const userId = req.user.id;

    const messages = await Conversation.find({
      $or: [{ agentId: userId }, { customerId: userId }]
    }).populate("agentId customerId", "name email");

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
