module.exports = (chatNamespace) => {
  chatNamespace.on("connection", (socket) => {
    console.log("Connected to Chat Namespace:", socket.id);

    // ✅ Join user to a room
    socket.on("joinRoom", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room: ${roomId}`);
    });

    // ✅ Send message to specific room
    socket.on("sendMessage", ({ roomId, message }) => {
      chatNamespace.to(roomId).emit("receiveMessage", message);
      console.log("messages",message);
    });

    socket.on("disconnect", () => {
      console.log("Chat socket disconnected:", socket.id);
    });
  });
};
