// const mongoose = require("mongoose");

// // ✅ Reply Schema
// const replySchema = new mongoose.Schema({
//   from: {
//     type: mongoose.Schema.Types.ObjectId,
//     required: true,
//     refPath: "messages.replies.fromModel"
//   },
//   fromModel: {
//     type: String,
//     required: true,
//     enum: ["User", "Customer"]
//   },
//   message: { type: String, required: true },
//   createdAt: { type: Date, default: Date.now }
// });

// // ✅ Message Schema
// const   messageSchema = new mongoose.Schema({
//   from: {
//     type: mongoose.Schema.Types.ObjectId,
//     required: true,
//     // ref:"User"
//     // refPath: "messages.fromModel"
//   },
//   // fromModel: {
//   //   type: String,
//   //   required: true,
//   //   enum: ["User", "Customer"]
//   // },
//   to: {
//     type: mongoose.Schema.Types.ObjectId,
//     required: true,
//     // ref:"User"
//     // refPath: "messages.toModel"
//   },
//   // toModel: {
//   //   type: String,
//   //   required: true,
//   //   enum: ["User", "Customer"]
//   // },
//   message: { type: String, required: true },
//   petitionId: { type: String, default: null },
//   createdAt: { type: Date, default: Date.now },
//   replies: [replySchema]
// });

// // ✅ Main Conversation Schema
// const ChatMessageSchema = new mongoose.Schema(
//   {
//     // // ✅ One conversation belongs to one customer
//     // customer: {
//     //   type: mongoose.Schema.Types.ObjectId,
//     //   ref: "Customer",
//     //   required: true
//     // },

//     assignedAgent: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null
//     },

//     transferredBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null
//     },

//     forwardedAt: { type: Date, default: null },
//     isActive: { type: Boolean, default: true },
//     status: {
//       type: String,
//       enum: ["open", "transferred", "closed"],
//       default: "open"
//     },

//     messages: [messageSchema]
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
