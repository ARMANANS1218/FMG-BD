const Leave = require("../models/Leave");
const User = require("../models/User");

// Calculate number of days between two dates
const calculateDays = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end date
  return diffDays;
};

// Apply for leave
exports.applyLeave = async (req, res) => {
  try {
    const { startDate, endDate, leaveType, reason, attachments } = req.body;
    const { organizationId, id: userId } = req.user;

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (end < start) {
      return res.status(400).json({ message: "End date cannot be before start date" });
    }

    const totalDays = calculateDays(startDate, endDate);

    const leave = new Leave({
      organizationId,
      userId,
      startDate: start,
      endDate: end,
      leaveType,
      reason,
      attachments: attachments || [],
      totalDays,
      status: 'Pending'
    });

    await leave.save();

    const populatedLeave = await Leave.findById(leave._id)
      .populate('userId', 'name employee_id email');

    res.status(201).json({
      message: "Leave application submitted successfully",
      leave: populatedLeave
    });
  } catch (error) {
    console.error("Error applying for leave:", error);
    res.status(500).json({ message: "Error applying for leave", error: error.message });
  }
};

// Get my leave applications
exports.getMyLeaves = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { status, year } = req.query;

    const query = { userId };

    if (status) {
      query.status = status;
    }

    if (year) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);
      query.startDate = { $gte: yearStart, $lte: yearEnd };
    }

    const leaves = await Leave.find(query)
      .populate('userId', 'name employee_id email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      leaves
    });
  } catch (error) {
    console.error("Error fetching leaves:", error);
    res.status(500).json({ message: "Error fetching leaves", error: error.message });
  }
};

// Get all leave applications (Admin/TL only)
exports.getAllLeaves = async (req, res) => {
  try {
    const { organizationId, role } = req.user;
    const { status, userId, startDate, endDate } = req.query;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to view all leaves" });
    }

    const query = { organizationId };

    if (status) {
      query.status = status;
    }

    if (userId) {
      query.userId = userId;
    }

    if (startDate && endDate) {
      query.$or = [
        { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
        { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
        { startDate: { $lte: new Date(startDate) }, endDate: { $gte: new Date(endDate) } }
      ];
    }

    const leaves = await Leave.find(query)
      .populate('userId', 'name employee_id email role')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      leaves
    });
  } catch (error) {
    console.error("Error fetching all leaves:", error);
    res.status(500).json({ message: "Error fetching leaves", error: error.message });
  }
};

// Review leave (Approve/Reject) - Admin/TL only
exports.reviewLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewComment } = req.body;
    const { organizationId, id: reviewerId, role } = req.user;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to review leaves" });
    }

    // Validate status
    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: "Status must be either 'Approved' or 'Rejected'" });
    }

    const leave = await Leave.findOne({ _id: id, organizationId });

    if (!leave) {
      return res.status(404).json({ message: "Leave application not found" });
    }

    if (leave.status !== 'Pending') {
      return res.status(400).json({ message: "This leave application has already been reviewed" });
    }

    leave.status = status;
    leave.reviewedBy = reviewerId;
    leave.reviewComment = reviewComment;
    leave.reviewedAt = new Date();

    await leave.save();

    const populatedLeave = await Leave.findById(leave._id)
      .populate('userId', 'name employee_id email')
      .populate('reviewedBy', 'name email');

    res.status(200).json({
      message: `Leave ${status.toLowerCase()} successfully`,
      leave: populatedLeave
    });
  } catch (error) {
    console.error("Error reviewing leave:", error);
    res.status(500).json({ message: "Error reviewing leave", error: error.message });
  }
};

// Cancel leave (Own leave only, if still pending)
exports.cancelLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;

    const leave = await Leave.findOne({ _id: id, userId });

    if (!leave) {
      return res.status(404).json({ message: "Leave application not found" });
    }

    if (leave.status !== 'Pending') {
      return res.status(400).json({ message: "You can only cancel pending leave applications" });
    }

    await Leave.findByIdAndDelete(id);

    res.status(200).json({
      message: "Leave application cancelled successfully"
    });
  } catch (error) {
    console.error("Error cancelling leave:", error);
    res.status(500).json({ message: "Error cancelling leave", error: error.message });
  }
};

// Get pending leave count (for notifications)
exports.getPendingLeaveCount = async (req, res) => {
  try {
    const { organizationId, role } = req.user;

    // Only Admin/TL can see pending count
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission" });
    }

    const count = await Leave.countDocuments({
      organizationId,
      status: 'Pending'
    });

    res.status(200).json({
      count
    });
  } catch (error) {
    console.error("Error fetching pending leave count:", error);
    res.status(500).json({ message: "Error fetching count", error: error.message });
  }
};
