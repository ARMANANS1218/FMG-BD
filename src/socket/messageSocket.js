module.exports = (io) => {
    io.on("connection", (socket) => {
        console.log("Message socket: A user connected:", socket.id);

        // Join room on user ID
        socket.on("join", (userId) => {
            socket.join(userId);
            console.log(`User ${userId} joined their personal room`);
        });

        // Send message to specific user room
        socket.on("send-message", (data) => {
            console.log("Message received:", data);
            if (data?.to) {
                io.to(data.to).emit("receive-message", data);
            }
        });

        // Handle message deletion
        socket.on("delete-message", (data) => {
            console.log("Message deleted:", data.messageId);
            io.emit("delete-message", data); 
        });

        socket.on("disconnect", () => {
            console.log("Message socket: User disconnected:", socket.id);
        });
    });
};
