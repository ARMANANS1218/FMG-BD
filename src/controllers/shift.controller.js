const Shift = require("../models/Shift");
const User = require("../models/User");

// Create a new shift
exports.createShift = async (req, res) => {
  try {
    const { shiftName, startTime, endTime, duration } = req.body;
    const { organizationId, id: userId, role } = req.user;

    // Check if user has permission (Admin or TL)
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to create shifts" });
    }

    // Check if shift already exists
    const existingShift = await Shift.findOne({ 
      organizationId, 
      shiftName 
    });

    if (existingShift) {
      return res.status(400).json({ message: "Shift with this name already exists" });
    }

    const shift = new Shift({
      organizationId,
      shiftName,
      startTime,
      endTime,
      duration,
      createdBy: userId
    });

    await shift.save();

    res.status(201).json({
      message: "Shift created successfully",
      shift
    });
  } catch (error) {
    console.error("Error creating shift:", error);
    res.status(500).json({ message: "Error creating shift", error: error.message });
  }
};

// Get all shifts for an organization
exports.getShifts = async (req, res) => {
  try {
    const { organizationId } = req.user;

    const shifts = await Shift.find({ organizationId, isActive: true })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ shiftName: 1 });

    res.status(200).json({
      shifts,
      count: shifts.length
    });
  } catch (error) {
    console.error("Error fetching shifts:", error);
    res.status(500).json({ message: "Error fetching shifts", error: error.message });
  }
};

// Get a single shift by ID
exports.getShiftById = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const shift = await Shift.findOne({ _id: id, organizationId })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    res.status(200).json({ shift });
  } catch (error) {
    console.error("Error fetching shift:", error);
    res.status(500).json({ message: "Error fetching shift", error: error.message });
  }
};

// Update a shift
exports.updateShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { shiftName, startTime, endTime, duration, isActive } = req.body;
    const { organizationId, id: userId, role } = req.user;

    // Check if user has permission (Admin or TL)
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to update shifts" });
    }

    const shift = await Shift.findOne({ _id: id, organizationId });

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    // Check if new name conflicts with existing shift
    if (shiftName && shiftName !== shift.shiftName) {
      const existingShift = await Shift.findOne({ 
        organizationId, 
        shiftName,
        _id: { $ne: id }
      });

      if (existingShift) {
        return res.status(400).json({ message: "Shift with this name already exists" });
      }
    }

    // Update fields
    if (shiftName) shift.shiftName = shiftName;
    if (startTime) shift.startTime = startTime;
    if (endTime) shift.endTime = endTime;
    if (duration) shift.duration = duration;
    if (typeof isActive !== 'undefined') shift.isActive = isActive;
    shift.updatedBy = userId;

    await shift.save();

    res.status(200).json({
      message: "Shift updated successfully",
      shift
    });
  } catch (error) {
    console.error("Error updating shift:", error);
    res.status(500).json({ message: "Error updating shift", error: error.message });
  }
};

// Delete a shift
exports.deleteShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId, role } = req.user;

    // Check if user has permission (Admin only)
    if (role !== 'Admin') {
      return res.status(403).json({ message: "Only Admin can delete shifts" });
    }

    const shift = await Shift.findOne({ _id: id, organizationId });

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    // Soft delete
    shift.isActive = false;
    await shift.save();

    res.status(200).json({
      message: "Shift deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting shift:", error);
    res.status(500).json({ message: "Error deleting shift", error: error.message });
  }
};
