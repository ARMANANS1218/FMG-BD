const connectedUsers = new Map();

module.exports = (io) => {
  io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    const role = socket.handshake.query.role;

    if (userId) {
      connectedUsers.set(userId, socket.id);
      socket.join(userId);
      console.log(`✅ User ${userId} connected: ${socket.id}`);
      io.emit('user-status', { userId, is_active: true });
    }

    if (role === 'Agent' || role === 'QA' || role === 'TL') {
      socket.join('petition-notifications');
      console.log(`User with role ${role} joined notification room`);
    }

    // ✅ Typing events moved to typingSocket.js

    socket.on('disconnect', () => {
      for (const [uid, sid] of connectedUsers.entries()) {
        if (sid === socket.id) {
          connectedUsers.delete(uid);
          console.log(`❌ User ${uid} disconnected`);
          io.emit('user-status', { userId: uid, is_active: false });
          break;
        }
      }
    });
  });
};

module.exports.connectedUsers = connectedUsers;
