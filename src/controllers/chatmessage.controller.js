const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const generatePetition = require('../utils/generatePetation');

exports.startConversation = async (req, res) => {
  try {
    const customerId = req.user.id; // From Customer Token
    const { message, agentId } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const newConversation = await ChatMessage.create({
      customer: customerId,
      assignedAgent: agentId || null,
      messages: [
        {
          from: customerId,
          fromModel: "Customer",
          to: agentId || null,
          toModel: agentId ? "User" : "Customer",
          message,
        }
      ]
    });

    return res.status(201).json({ success: true, data: newConversation });
  } catch (error) {
    console.error("Start Conversation Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { to, conversationId, message } = req.body;
    const from = req.user.id; 
   
    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const petitionId = generatePetition();
    let conversation;

    // If conversationId exists, add message to existing conversation
    if (conversationId) {
      conversation = await ChatMessage.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, message: "Conversation not found" });
      }

      conversation.messages.push({
        from,
        to,
        message,
        petitionId,
        createdAt: new Date()
      });

      await conversation.save();
    } else {
      // Create new conversation
      conversation = await ChatMessage.create({
        messages: [{
          from,
          to,
          message,
          petitionId
        }]
      });
    }

    // Get populated message
    const populatedConversation = await ChatMessage.findById(conversation._id)
      .populate("messages.from", "name email profileImage role")
      .populate("messages.to", "name email profileImage role");

    const latestMessage = populatedConversation.messages[populatedConversation.messages.length - 1];

    // ✅ Emit real-time socket event to receiver
    const io = req.app.get('io');
    if (io && to) {
      io.to(to).emit('receive-message', {
        from,
        to,
        message: latestMessage,
        conversationId: conversation._id,
        timestamp: new Date()
      });
      console.log(`✅ Real-time message sent to ${to}`);
    }

    res.status(201).json({
      success: true,
      data: populatedConversation,
      message: "Message sent successfully"
    });
  } catch (error) {
    console.error("Send Message Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};


exports.getChatConversation = async (req, res) => {
  try {
    const agentId = req.user?.id || req.params?.id;
    const customerId = req.params?.id || req.user?.id;

    const conversations = await ChatMessage.find({
      messages: {
        $elemMatch: {
          $or: [
            { from: agentId, to: customerId },
            { from: customerId, to: agentId }
          ]
        }
      }
    })
      .populate("messages.from", "name email profileImage")
      .populate("messages.to", "name email profileImage")

    // 🔹 Sabhi conversation ke messages ek array me combine
    // const allMessages = conversations.flatMap(conv => conv.messages);

    // 🔹 Filter sirf agent aur customer ke beech ke messages
    // const filteredMessages = allMessages.filter(msg =>
    //   (msg.from?._id?.toString() === agentId && msg.to?._id?.toString() === customerId) ||
    //   (msg.from?._id?.toString() === customerId && msg.to?._id?.toString() === agentId)
    // );

    return res.json({
      success: true,
      data: conversations
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.transferPetition = async (req, res) => {
  try {
    const { newAgentId } = req.body;
    const {petitionId}=req.params;
    const qaUserId = req.user?.id;

    if (!petitionId || !newAgentId) {
      return res.status(400).json({ success: false, message: "petitionId and newAgentId are required" });
    }

    const newAgent = await User.findById(newAgentId);
    if (!newAgent || newAgent.role !== "Agent") {
      return res.status(404).json({ success: false, message: "Agent not found or invalid role" });
    }

    // ✅ Find petition via nested messages array
    const petition = await ChatMessage.findOne({
      "messages.petitionId": petitionId
    });

    if (!petition) {
      return res.status(404).json({ success: false, message: `No petition found with ID: ${petitionId}` });
    }

    // ✅ Check if already assigned to this agent
    if (petition.assignedAgent?.toString() === newAgentId) {
      return res.status(400).json({ success: false, message: "Petition is already assigned to this agent" });
    }

    // ✅ Update fields
    petition.assignedAgent = newAgent._id;
    petition.status = "transferred";
    petition.transferredBy = qaUserId;
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

exports.addReplyToPetition = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { petitionId}=req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: "Reply message is required" });
    }

    // ✅ First, find the conversation containing this petitionId
    const conversation = await ChatMessage.findOneAndUpdate(
      { "messages.petitionId": petitionId },
      {
        $push: {
          "messages.$.replies": {
            from: agentId,
            fromModel: "User",
            message
          }
        }
      },
      { new: true }
    )
      .populate("messages.from", "name email")
      .populate("messages.to", "name email")
      .populate("messages.replies.from", "name email");

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Petition not found" });
    }

    return res.status(200).json({
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
    const petition = await ChatMessage.findOne({ "messages.petitionId": petitionId })
      .populate('messages.from', 'name email')
      .populate('messages.to', 'name email')
      .populate('transferredBy', 'name email')
      .populate('assignedAgent', 'name department')
      .populate('messages.replies.from', 'name email')
      .populate({
          path: 'messages',
          model: 'Reply',
          populate: { path: 'sender', select: 'name email' }
        });

    if (!petition) return res.status(404).json({ success: false, message: "Petition not found" });

    res.status(200).json({ success: true, data: petition });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch petition", error: error.message });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const messages = await ChatMessage.find()
      .populate("messages.from", "name email profileImage")
      .populate("messages.to", "name email profileImage")
      .populate("messages.replies.from", "name email profileImage")
      .sort({ updatedAt: -1 });

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
