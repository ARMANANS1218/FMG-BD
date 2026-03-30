const { sendRealTimeMessage } = require('../middleware/messageMiddleware');
const Message = require('../models/Message');
const generatePetition = require('../utils/generatePetation');
const axios = require('axios');

// Send WhatsApp message
exports.sendMessage = async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const petitionToken = generatePetition();
  const from = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const whatsappUrl = `https://graph.facebook.com/v17.0/${from}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  };

  try {
    await axios.post(whatsappUrl, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const newMessage = await Message.create({
      userId,
      senderId: userId,
      from,
      to,
      message,
      direction: "outgoing",
      source: "whatsapp",
      platform: "whatsapp",
      petitionToken,
      status: "sent",
      isRead: false,
    });

    sendRealTimeMessage({ userId, customerId: to, message: newMessage });

    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      data: newMessage,
      petitionToken
    });
  } catch (err) {
    console.error('❌ WhatsApp Error:', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: err.response?.data || err.message,
      petitionToken
    });
  }
};

// Get chat history
exports.getChatHistory = async (req, res) => {
  const { userId, customerId } = req.body;

  if (!userId || !customerId) {
    return res.status(400).json({ success: false, message: 'Both userId and customerId are required' });
  }

  try {
    const messages = await Message.find({
      $or: [
        { userId: userId, to: customerId },
        { userId: customerId, to: userId }
      ]
    }).sort({ createdAt: 1 });

    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error('Error fetching chat history:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching chat history' });
  }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
  const { userId, customerId } = req.body;

  if (!userId || !customerId) {
    return res.status(400).json({ success: false, message: 'userId and customerId are required' });
  }

  try {
    await Message.updateMany(
      { senderId: customerId, userId: userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({ success: true, message: 'Messages marked as read' });
  } catch (error) {
    console.error('Error marking messages as read:', error.message);
    res.status(500).json({ success: false, message: 'Error marking messages as read' });
  }
};

// Update a message
exports.updateMessage = async (req, res) => {
  const senderId = req.user.id;
  const { messageId, updatedContent } = req.body;

  if (!messageId || !updatedContent) {
    return res.status(400).json({
      success: false,
      message: 'Message ID and updated content are required',
    });
  }

  try {
    const message = await Message.findOneAndUpdate(
      { _id: messageId, senderId },
      { message: updatedContent },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found or not authorized' });
    }

    res.status(200).json({ success: true, message: 'Message updated', data: message });
  } catch (err) {
    console.error('Error updating message:', err.message);
    res.status(500).json({ success: false, message: 'Error updating message' });
  }
};

// Delete a message
exports.deleteMessage = async (req, res) => {
  const senderId = req.user.id;
  const { messageId } = req.body;

  if (!messageId) {
    return res.status(400).json({ success: false, message: 'Message ID is required' });
  }

  try {
    const message = await Message.findOneAndDelete({ _id: messageId, senderId });

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found or not authorized' });
    }

    res.status(200).json({ success: true, message: 'Message deleted' });
  } catch (err) {
    console.error('Error deleting message:', err.message);
    res.status(500).json({ success: false, message: 'Error deleting message' });
  }
};
