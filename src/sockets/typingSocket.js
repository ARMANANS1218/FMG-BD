const { connectedUsers } = require('./mainSocket');

module.exports = (io) => {
  io.on('connection', (socket) => {
    socket.on('start-typing', ({ toUserId }) => {
      const targetSocketId = connectedUsers.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('user-typing', { fromUserId: socket.id, typing: true });
      }
    });

    socket.on('stop-typing', ({ toUserId }) => {
      const targetSocketId = connectedUsers.get(toUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('user-typing', { fromUserId: socket.id, typing: false });
      }
    });
  });
};
