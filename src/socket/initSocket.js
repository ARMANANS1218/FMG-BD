const onlineUsers = new Map();

function registerUser(userId, socket) {
    onlineUsers.set(userId, socket.id);
    console.log(`✅ User registered: ${userId} -> ${socket.id}`);
}

function callUser(io, socket, { to, offer }) {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
        io.to(targetSocket).emit("incoming-call", { from: getUserIdBySocket(socket.id), offer });
        console.log(`📞 Call request sent to ${to}`);
    }
}

function answerCall(io, socket, { to, answer }) {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
        io.to(targetSocket).emit("call-answered", { answer });
        console.log(`✅ Call answered by ${getUserIdBySocket(socket.id)}`);
    }
}

function iceCandidate(io, { to, candidate }) {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
        io.to(targetSocket).emit("ice-candidate", { candidate });
    }
}

function disconnect(socket) {
    const userId = getUserIdBySocket(socket.id);
    if (userId) {
        onlineUsers.delete(userId);
        console.log(`❌ User disconnected: ${userId}`);
    }
}

function getUserIdBySocket(socketId) {
    for (const [userId, sId] of onlineUsers.entries()) {
        if (sId === socketId) return userId;
    }
    return null;
}

module.exports = { registerUser, callUser, answerCall, iceCandidate, disconnect };
