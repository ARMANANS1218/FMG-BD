module.exports = (io) => {
  io.on("connection", (socket) => {
    const token = socket.handshake.query.token;
    if (!token) {
      console.log("❌ Socket rejected: No token");
      socket.disconnect();
      return;
    }

    console.log("✅ Socket connected with token:", token);

    // ✅ When frontend sends a generic notification
    socket.on("send-notification", (data) => {
      console.log("📩 Notification received:", data);
      io.emit("receive-notification", data); // Broadcast to all
    });

    // ✅ Petition-specific event (optional, if you want to trigger via socket)
    socket.on("create-petition", (petitionData) => {
      console.log("📢 New petition event:", petitionData);
      io.emit("new-petition", {
        petitionId: petitionData.petitionId,
        message: petitionData.message,
        createdAt: new Date(),
        from: petitionData.from
      });
    });

    socket.on("disconnect", () => {
      console.log("🔌 User disconnected:", socket.id);
    });
  });
};
