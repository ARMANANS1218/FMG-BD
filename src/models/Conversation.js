// const mongoose = require("mongoose");

// // ✅ Reply Schema
// const replySchema = new mongoose.Schema({
//   from: { type: String, required: true }, 
//   message: { type: String, required: true },
//   createdAt: { type: Date, default: Date.now }
// });

// // ✅ Message Schema
// const messageSchema = new mongoose.Schema({
//   from: { type: String, required: true }, 
//   to: { type: String }, 
//   message: { type: String, required: true },
//   petitionId: { type: String },
//   createdAt: { type: Date, default: Date.now },
//   replies: [replySchema] 
// });

// // ✅ Main Conversation Schema
// const conversationSchema = new mongoose.Schema(
//   {
//     name: { type: String, required: true, trim: true },
//     email: { type: String, required: true, lowercase: true, trim: true },
//     mobile: { type: String, required: true },
//     department: { type: String, required: true },
//     query: { type: String, required: true, trim: true },

//     isConversationStarted: { type: Boolean, default: true },

//     assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
//     transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
//     forwardedAt: { type: Date, default: null },
//     isActive: { type: Boolean, default: false },
//     status: {
//       type: String,
//       enum: ["open", "transferred", "closed"],
//       default: "open"
//     },

//     messages: [messageSchema]
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Conversation", conversationSchema);
