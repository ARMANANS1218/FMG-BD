// sockets/callSocket.js
const Room = require("../models/Room");
const User = require("../models/User");

/**
 * Initialize Call + WebRTC signaling socket layer
 * @param {Server} io - socket.io server instance
 * @param {Map<string,string>} connectedUsers - Map userId -> socketId
 */
module.exports = function initCallSocket(io, connectedUsers) {
  // Optional: local map for quick access to socket by userId
  const socketsByUser = new Map();

  io.on("connection", (socket) => {
    const userId = (socket.userId || "").toString();

    console.log("✅ Socket connected:", "socket_id:", socket.id, "user:", userId || "guest");

    // Attach to personal room for direct emits
    if (userId) {
        console.log(`User ${userId} joined their personal room`);
      connectedUsers.set(userId, socket.id);
      socketsByUser.set(userId, socket);
      socket.join(userId);
      io.emit("user-status", { userId, is_active: true });
    }

    /**
     * ---------------------------
     *  CALL LIFECYCLE
     * ---------------------------
     */

    /**
     * Caller emits after creating Room via REST API:
     *  payload: { roomId, receiverId }
     */
    socket.on("call:init", async ({ roomId, receiverId, callType }) => {
      try {
        if (!userId) return socket.emit("call:error", { message: "Unauthorized" });
        if (!roomId || !receiverId) {
          return socket.emit("call:error", { message: "roomId and receiverId required" });
        }

        const call = await Room.findOne({ roomId });
        if (!call) return socket.emit("call:error", { message: "Invalid room" });

        // Attach caller to room
        socket.join(roomId);

        // Set status to ringing
        if (call.status !== "ringing") {
          call.status = "ringing";
          await call.save();
        }

        // Fetch caller's name for proper display
        const caller = await User.findById(userId);
        const callerName = caller?.name || 'Agent';

        // Notify receiver if online
        io.to(receiverId.toString()).emit("call:incoming", {
          roomId,
          from: callerName, // Send caller's name instead of just ID
          callType
        });

        // Acknowledge to caller
        socket.emit("call:created", { roomId });
      } catch (err) {
        console.error("call:init error:", err);
        socket.emit("call:error", { message: "Failed to init call" });
      }
    });

    /**
     * Receiver accepts the call
     * payload: { roomId }
     */
    socket.on("call:accept", async ({ roomId }) => {
      try {
        if (!userId) return socket.emit("call:error", { message: "Unauthorized" });
        if (!roomId) return socket.emit("call:error", { message: "roomId required" });

        const call = await Room.findOne({ roomId });
        if (!call) return socket.emit("call:error", { message: "Call not found" });

        // Join receiver to the room
        socket.join(roomId);

        // Save status + start time
        call.status = "accepted";
        call.startedAt = new Date();
        await call.save();

        // Inform both sides in room
        io.to(roomId).emit("call:accepted", { by: userId });
      } catch (err) {
        console.error("call:accept error:", err);
        socket.emit("call:error", { message: "Failed to accept call" });
      }
    });

    /**
     * Receiver rejects the call
     * payload: { roomId }
     */
    socket.on("call:reject", async ({ roomId }) => {
      try {
        if (!userId) return socket.emit("call:error", { message: "Unauthorized" });
        if (!roomId) return socket.emit("call:error", { message: "roomId required" });

        const call = await Room.findOne({ roomId });
        if (!call) return socket.emit("call:error", { message: "Call not found" });

        call.status = "rejected";
        call.endedAt = new Date();
        call.duration = 0;
        await call.save();

        io.to(roomId).emit("call:rejected", { by: userId });
        // Optionally remove everyone from the room
        io.in(roomId).socketsLeave(roomId);
      } catch (err) {
        console.error("call:reject error:", err);
        socket.emit("call:error", { message: "Failed to reject call" });
      }
    });

    /**
     * Either side ends the call
     * payload: { roomId }
     */
    socket.on("call:end", async ({ roomId }) => {
      try {
        if (!userId) return socket.emit("call:error", { message: "Unauthorized" });
        if (!roomId) return socket.emit("call:error", { message: "roomId required" });

        const call = await Room.findOne({ roomId });
        if (call) {
          call.endedAt = new Date();
          call.status = "ended";
          if (call.startedAt) {
            call.duration = Math.floor((call.endedAt - call.startedAt) / 1000);
          } else {
            call.duration = 0;
          }
          await call.save();
        }

        io.to(roomId).emit("call:ended", { by: userId });

        // Make sure everyone leaves the room
        io.in(roomId).socketsLeave(roomId);
      } catch (err) {
        console.error("call:end error:", err);
        socket.emit("call:error", { message: "Failed to end call" });
      }
    });

    /**
     * Receiver notifies they're ready to receive offer
     * payload: { roomId }
     */
    socket.on("call:receiver-ready", ({ roomId }) => {
      if (!roomId) return;
      console.log(`📞 Receiver ready in room ${roomId}, notifying caller`);
      
      // Join receiver to room
      socket.join(roomId);
      
      // Notify caller (broadcast to room except sender)
      socket.to(roomId).emit("call:receiver-ready", { roomId });
    });

    /**
     * ---------------------------
     *  WEBRTC SIGNALING RELAY
     * ---------------------------
     * Keep event names consistent across clients.
     * Also support older aliases (offer/answer/candidate).
     */

    // Offer
    socket.on("webrtc:offer", ({ roomId, sdp }) => {
      if (!roomId || !sdp) return;
      socket.to(roomId).emit("webrtc:offer", { sdp, from: userId });
    });
    // Backward compat:
    socket.on("offer", ({ roomId, sdp }) => {
      if (!roomId || !sdp) return;
      socket.to(roomId).emit("offer", { sdp, from: userId });
    });

    // Answer
    socket.on("webrtc:answer", ({ roomId, sdp }) => {
      if (!roomId || !sdp) return;
      socket.to(roomId).emit("webrtc:answer", { sdp, from: userId });
    });
    // Backward compat:
    socket.on("answer", ({ roomId, sdp }) => {
      if (!roomId || !sdp) return;
      socket.to(roomId).emit("answer", { sdp, from: userId });
    });

    // ICE Candidate
    socket.on("webrtc:ice-candidate", ({ roomId, candidate }) => {
      if (!roomId || !candidate) return;
      socket.to(roomId).emit("webrtc:ice-candidate", { candidate, from: userId });
    });
    // Backward compat:
    socket.on("candidate", ({ roomId, candidate }) => {
      if (!roomId || !candidate) return;
      socket.to(roomId).emit("candidate", { candidate, from: userId });
    });

    /**
     * Cleanup on disconnect
     */
    socket.on("disconnect", () => {
      console.log("❌ Disconnected:", userId || socket.id);
      if (userId) {
        connectedUsers.delete(userId);
        socketsByUser.delete(userId);
        io.emit("user-status", { userId, is_active: false });
      }
    });
  });
};
