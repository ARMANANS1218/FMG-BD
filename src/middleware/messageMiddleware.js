// messageMiddleware.js - Fixed to use the main io instance
let ioInstance = null;
const connectedClients = new Map(); // userId -> socket.id

// Initialize with the main io instance from app.js
function initializeMessageSocket(io) {
  ioInstance = io;
  console.log('✅ Message middleware initialized with main socket instance');
}

// Track connected users
function registerClient(userId, socketId) {
  connectedClients.set(userId, socketId);
  console.log(`📱 User ${userId} registered for messages (socket: ${socketId})`);
}

// Remove disconnected users
function unregisterClient(userId) {
  connectedClients.delete(userId);
  console.log(`📴 User ${userId} unregistered from messages`);
}

// Send real-time message to specific user
function sendRealTimeMessage({ userId, customerId, message }) {
  if (!ioInstance) {
    console.error('❌ Socket.IO instance not initialized!');
    return;
  }

  // Send to customer
  if (customerId) {
    const customerSocketId = connectedClients.get(customerId);
    if (customerSocketId) {
      ioInstance.to(customerSocketId).emit('newMessage', { 
        senderId: userId, 
        message 
      });
      console.log(`📩 Real-time message sent to customer ${customerId}`);
    } else {
      // Try sending to customer's room (fallback)
      ioInstance.to(customerId).emit('newMessage', { 
        senderId: userId, 
        message 
      });
      console.log(`📩 Message sent to customer room ${customerId}`);
    }
  }

  // Send back to agent (optional, for confirmation)
  if (userId) {
    const agentSocketId = connectedClients.get(userId);
    if (agentSocketId) {
      ioInstance.to(agentSocketId).emit('newMessage', { 
        senderId: userId, 
        message 
      });
      console.log(`📩 Message confirmation sent to agent ${userId}`);
    } else {
      // Try sending to agent's room (fallback)
      ioInstance.to(userId).emit('newMessage', { 
        senderId: userId, 
        message 
      });
    }
  }
}

// Broadcast message to all connected clients
function broadcastMessage(event, data) {
  if (!ioInstance) {
    console.error('❌ Socket.IO instance not initialized!');
    return;
  }
  ioInstance.emit(event, data);
  console.log(`📢 Broadcasted ${event} to all clients`);
}

module.exports = { 
  initializeMessageSocket,
  registerClient,
  unregisterClient,
  sendRealTimeMessage,
  broadcastMessage
};
