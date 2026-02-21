const Holiday = require("../models/Holiday");

// Create holiday (Admin/TL only)
exports.createHoliday = async (req, res) => {
  try {
    const { date, title, description, type } = req.body;
    const { organizationId, id: createdById, role } = req.user;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to create holidays" });
    }

    // Check if holiday already exists for this date
    const holidayDate = new Date(date);
    holidayDate.setHours(0, 0, 0, 0);

    const existingHoliday = await Holiday.findOne({
      organizationId,
      date: holidayDate
    });

    if (existingHoliday) {
      return res.status(400).json({ message: "A holiday already exists for this date" });
    }

    const holiday = new Holiday({
      organizationId,
      date: holidayDate,
      title,
      description,
      type,
      createdBy: createdById
    });

    await holiday.save();

    const populatedHoliday = await Holiday.findById(holiday._id)
      .populate('createdBy', 'name email');

    res.status(201).json({
      message: "Holiday created successfully",
      holiday: populatedHoliday
    });
  } catch (error) {
    console.error("Error creating holiday:", error);
    res.status(500).json({ message: "Error creating holiday", error: error.message });
  }
};

// Get all holidays
exports.getAllHolidays = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { year, month, startDate, endDate } = req.query;

    const query = { organizationId, isActive: true };

    // Filter by year
    if (year) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);
      query.date = { $gte: yearStart, $lte: yearEnd };
    }

    // Filter by month
    if (month && year) {
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59);
      query.date = { $gte: monthStart, $lte: monthEnd };
    }

    // Filter by date range
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const holidays = await Holiday.find(query)
      .populate('createdBy', 'name email')
      .sort({ date: 1 });

    res.status(200).json({
      holidays
    });
  } catch (error) {
    console.error("Error fetching holidays:", error);
    res.status(500).json({ message: "Error fetching holidays", error: error.message });
  }
};

// Update holiday (Admin/TL only)
exports.updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, type, isActive } = req.body;
    const { organizationId, role } = req.user;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to update holidays" });
    }

    const holiday = await Holiday.findOne({ _id: id, organizationId });

    if (!holiday) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    if (title) holiday.title = title;
    if (description !== undefined) holiday.description = description;
    if (type) holiday.type = type;
    if (isActive !== undefined) holiday.isActive = isActive;

    await holiday.save();

    const populatedHoliday = await Holiday.findById(holiday._id)
      .populate('createdBy', 'name email');

    res.status(200).json({
      message: "Holiday updated successfully",
      holiday: populatedHoliday
    });
  } catch (error) {
    console.error("Error updating holiday:", error);
    res.status(500).json({ message: "Error updating holiday", error: error.message });
  }
};

// Delete holiday (Admin/TL only)
exports.deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId, role } = req.user;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to delete holidays" });
    }

    const holiday = await Holiday.findOneAndDelete({ _id: id, organizationId });

    if (!holiday) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    res.status(200).json({
      message: "Holiday deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting holiday:", error);
    res.status(500).json({ message: "Error deleting holiday", error: error.message });
  }
};

// Check if a date is a holiday
exports.checkHoliday = async (req, res) => {
  try {
    const { date } = req.query;
    const { organizationId } = req.user;

    const holidayDate = new Date(date);
    holidayDate.setHours(0, 0, 0, 0);

    const holiday = await Holiday.findOne({
      organizationId,
      date: holidayDate,
      isActive: true
    });

    res.status(200).json({
      isHoliday: !!holiday,
      holiday: holiday || null
    });
  } catch (error) {
    console.error("Error checking holiday:", error);
    res.status(500).json({ message: "Error checking holiday", error: error.message });
  }
};
