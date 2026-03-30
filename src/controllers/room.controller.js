const Room = require("../models/Room");
const { v4: uuidv4 } = require("uuid");

// ✅ Create a new call
exports.createCall = async (req, res) => {
  try {
    const callerId = req.user.id;
    const { receiverId } = req.body;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: "Receiver ID is required" });
    }

    const roomId = uuidv4();

    const newCall = await Room.create({
      roomId,
      participants: [
        { userId: callerId, role: "caller" },
        { userId: receiverId, role: "receiver" }
      ],
      status: "ringing"
    });

    res.status(201).json({ success: true, data: newCall });
  } catch (error) {
    console.error("Create Call Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Update call status
exports.updateCallStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    if (!status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    const validStatuses = ["accepted", "ended", "rejected"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid call status" });
    }

    const call = await Room.findOne({ roomId });
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" });
    }

    switch (status) {
      case "accepted": {
        const receiver = call.participants.find((p) => p.role === "receiver");
        if (!receiver || receiver.userId.toString() !== userId) {
          return res.status(403).json({ success: false, message: "Only the receiver can accept" });
        }
        call.startedAt = new Date();
        break;
      }

      case "ended":
      case "rejected": {
        call.endedAt = new Date();
        call.duration = call.startedAt
          ? Math.floor((call.endedAt - call.startedAt) / 1000)
          : 0;
        break;
      }
    }

    call.status = status;
    await call.save();

    res.json({ success: true, data: call });
  } catch (error) {
    console.error("Update Call Status Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


// ✅ Get call history
exports.getCallHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const history = await Room.find({ "participants.userId": userId })
      .populate("participants.userId", "name email")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: history });
  } catch (error) {
    console.error("Get Call History Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get all calls (Admin)
exports.getAllCalls = async (req, res) => {
  try {
    const calls = await Room.find()
      .populate("participants.userId", "name email profileImage")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: calls });
  } catch (error) {
    console.error("Get All Calls Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Delete a single call log
exports.deleteCallLog = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const call = await Room.findById(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" });
    }

    // Allow deletion only by participants or agents/QA
    const isParticipant = call.participants.some(p => p.userId.toString() === userId);
    const userRole = req.user.role;
    
    if (!isParticipant && !['Agent', 'QA', 'Admin'].includes(userRole)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this call log" });
    }

    await Room.findByIdAndDelete(callId);
    res.json({ success: true, message: "Call log deleted successfully" });
  } catch (error) {
    console.error("Delete Call Log Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Clear all call logs for a specific date
exports.clearCallLogsDate = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { dateKey } = req.body;

    // Only agents and QA can clear logs
    if (!['Agent', 'QA', 'Admin'].includes(userRole)) {
      return res.status(403).json({ success: false, message: "Only agents and QA can clear call logs" });
    }

    if (!dateKey) {
      return res.status(400).json({ success: false, message: "Date key is required" });
    }

    // Parse the date key (format: yyyy-MM-dd)
    const [year, month, day] = dateKey.split('-');
    const startDate = new Date(year, month - 1, day, 0, 0, 0);
    const endDate = new Date(year, month - 1, day, 23, 59, 59);

    // Delete calls created on that date for this user
    const result = await Room.deleteMany({
      "participants.userId": userId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

    res.json({ 
      success: true, 
      message: `Deleted ${result.deletedCount} call logs for ${dateKey}`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Clear Call Logs Date Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Clear all call logs for a user
exports.clearAllCallLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Only agents and QA can clear all logs
    if (!['Agent', 'QA', 'Admin'].includes(userRole)) {
      return res.status(403).json({ success: false, message: "Only agents and QA can clear call logs" });
    }

    // Delete all calls for this user
    const result = await Room.deleteMany({
      "participants.userId": userId
    });

    res.json({ 
      success: true, 
      message: `All ${result.deletedCount} call logs have been deleted`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Clear All Call Logs Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
