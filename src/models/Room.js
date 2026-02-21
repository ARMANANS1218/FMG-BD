const mongoose = require("mongoose");

const ParticipantSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, enum: ["caller", "receiver"], required: true },
});


const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  participants: [ParticipantSchema],
  status: { 
    type: String, 
    enum: ["ringing", "missed", "accepted", "rejected", "ended"], 
    default: "ringing" 
  },
  duration: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null }
}, { timestamps: true });

const Room = mongoose.model("Room", roomSchema);
module.exports = Room;
