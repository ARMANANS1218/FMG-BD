module.exports = (typingNamespace) => {
  typingNamespace.on('connection', (socket) => {
    console.log('Connected to Typing Namespace:', socket.id);

    socket.on('typing', ({ userId, is_typing }) => {
      typingNamespace.emit('typingStatus', { userId, is_typing });
    });

    socket.on('disconnect', () => {
      console.log('Typing socket disconnected:', socket.id);
    });
  });
};
