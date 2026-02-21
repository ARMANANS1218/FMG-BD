const Attendance = require('../models/Attendance');
const Shift = require('../models/Shift');
const User = require('../models/User');
const { cloudinary, uploadToCloudinary } = require('../config/cloudinary');

// Helper function to calculate time difference in hours
const calculateHours = (checkIn, checkOut) => {
  // Handle empty strings, null, or undefined
  if (!checkIn || !checkOut || checkIn === '' || checkOut === '') return 0;

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);

  // Check if dates are valid
  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) return 0;

  const diff = checkOutDate - checkInDate;

  // If negative or invalid, return 0
  if (diff < 0) return 0;

  return parseFloat((diff / (1000 * 60 * 60)).toFixed(2)); // Convert to hours and return as number
};

// Helper function to determine status based on check-in time
const determineStatus = (checkInTime, shiftStartTime) => {
  if (!checkInTime || !shiftStartTime) return 'Present';

  const checkIn = new Date(checkInTime);
  const [startHour, startMinute] = shiftStartTime.split(':').map(Number);

  const shiftStart = new Date(checkIn);
  shiftStart.setHours(startHour, startMinute, 0, 0);

  const diffMinutes = (checkIn - shiftStart) / (1000 * 60);

  // Within 20 minutes buffer - Present (On Time)
  if (diffMinutes <= 20) return 'Present';

  // More than 20 minutes late - Half Day
  if (diffMinutes > 20) return 'Half Day';

  // If checking in before shift start
  if (diffMinutes < 0) return 'Present';

  return 'Present';
};

// Mark attendance (check-in)
exports.checkIn = async (req, res) => {
  try {
    const { shiftId, latitude, longitude, address, ip, imageBase64 } = req.body;
    const { id: userId, organizationId } = req.user;

    console.log('📸 Check-in request:', {
      userId,
      shiftId,
      hasImage: !!imageBase64,
      imageLength: imageBase64?.length || 0,
    });

    // Get shift details
    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({ message: 'Shift not found' });
    }

    // Check if already checked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      userId,
      date: { $gte: today },
    });

    if (existingAttendance && existingAttendance.checkInTime) {
      return res.status(400).json({ message: 'You have already checked in today' });
    }

    // Upload image to Cloudinary
    let checkInImageUrl = null;
    if (imageBase64) {
      try {
        console.log('📤 Uploading check-in image to Cloudinary...');
        const uploadResult = await cloudinary.uploader.upload(imageBase64, {
          folder: 'attendance/check-in',
          resource_type: 'image',
        });
        checkInImageUrl = uploadResult.secure_url;
        console.log('✅ Check-in image uploaded:', checkInImageUrl);
      } catch (uploadError) {
        console.error('❌ Error uploading check-in image:', uploadError);
      }
    } else {
      console.log('⚠️ No imageBase64 provided for check-in');
    }

    const checkInTime = new Date();
    const status = determineStatus(checkInTime, shift.startTime);

    const attendance = new Attendance({
      organizationId,
      userId,
      shiftId,
      date: today,
      checkInTime,
      checkInImage: checkInImageUrl,
      checkInLocation: {
        latitude,
        longitude,
        address,
      },
      checkInIp: ip,
      status,
    });

    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('userId', 'name employee_id email')
      .populate('shiftId', 'shiftName startTime endTime');

    res.status(201).json({
      message: 'Check-in successful',
      attendance: populatedAttendance,
    });
  } catch (error) {
    console.error('Error during check-in:', error);
    res.status(500).json({ message: 'Error during check-in', error: error.message });
  }
};

// Mark attendance (check-out)
exports.checkOut = async (req, res) => {
  try {
    const { latitude, longitude, address, ip, imageBase64 } = req.body;
    const { id: userId } = req.user;

    console.log('📸 Check-out request:', {
      userId,
      hasImage: !!imageBase64,
      imageLength: imageBase64?.length || 0,
    });

    // Find today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      userId,
      date: { $gte: today },
    });

    if (!attendance) {
      return res.status(404).json({ message: 'No check-in found for today' });
    }

    if (attendance.checkOutTime) {
      return res.status(400).json({ message: 'You have already checked out today' });
    }

    // Upload image to Cloudinary
    let checkOutImageUrl = null;
    if (imageBase64) {
      try {
        console.log('📤 Uploading check-out image to Cloudinary...');
        const uploadResult = await cloudinary.uploader.upload(imageBase64, {
          folder: 'attendance/check-out',
          resource_type: 'image',
        });
        checkOutImageUrl = uploadResult.secure_url;
        console.log('✅ Check-out image uploaded:', checkOutImageUrl);
      } catch (uploadError) {
        console.error('❌ Error uploading check-out image:', uploadError);
      }
    } else {
      console.log('⚠️ No imageBase64 provided for check-out');
    }

    attendance.checkOutTime = new Date();
    attendance.checkOutImage = checkOutImageUrl;
    attendance.checkOutLocation = {
      latitude,
      longitude,
      address,
    };
    attendance.checkOutIp = ip;
    attendance.totalHours = calculateHours(attendance.checkInTime, attendance.checkOutTime);

    // Update status based on total hours
    const shift = await Shift.findById(attendance.shiftId);
    if (shift && attendance.totalHours < shift.duration / 2) {
      attendance.status = 'Half Day';
    }

    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('userId', 'name employee_id email')
      .populate('shiftId', 'shiftName startTime endTime');

    res.status(200).json({
      message: 'Check-out successful',
      attendance: populatedAttendance,
    });
  } catch (error) {
    console.error('Error during check-out:', error);
    res.status(500).json({ message: 'Error during check-out', error: error.message });
  }
};

// Get today's attendance for current user
exports.getMyTodayAttendance = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      userId,
      date: { $gte: today },
    })
      .populate('shiftId', 'shiftName startTime endTime duration')
      .populate('userId', 'name employee_id email');

    res.status(200).json({
      attendance: attendance || null,
    });
  } catch (error) {
    console.error("Error fetching today's attendance:", error);
    res.status(500).json({ message: 'Error fetching attendance', error: error.message });
  }
};

// Get my attendance history
exports.getMyAttendance = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { startDate, endDate, page = 1, limit = 30 } = req.query;

    const query = { userId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const skip = (page - 1) * limit;

    const [attendance, total] = await Promise.all([
      Attendance.find(query)
        .populate('shiftId', 'shiftName startTime endTime duration')
        .populate('userId', 'name employee_id email')
        .populate('markedBy', 'name email')
        .populate('editedBy', 'name email')
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Attendance.countDocuments(query),
    ]);

    res.status(200).json({
      attendance,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ message: 'Error fetching attendance', error: error.message });
  }
};

// Get all attendance (Admin/TL only)
exports.getAllAttendance = async (req, res) => {
  try {
    const { organizationId, role } = req.user;
    const { date, shiftId, userId, status, role: filterRole, page = 1, limit = 50 } = req.query;

    // Check permission
    if (!['Admin', 'TL', 'Management'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to view all attendance" });
    }

    const query = { organizationId };

    if (date) {
      const selectedDate = new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 1);
      query.date = { $gte: selectedDate, $lt: nextDate };
    }

    if (shiftId) query.shiftId = shiftId;
    if (userId) query.userId = userId;
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    // Build the populate options with role filter if needed
    let userPopulateOptions = {
      path: 'userId',
      select: 'name employee_id email mobile role',
    };

    if (filterRole) {
      userPopulateOptions.match = { role: filterRole };
    }

    let attendance = await Attendance.find(query)
      .populate(userPopulateOptions)
      .populate('shiftId', 'shiftName startTime endTime duration')
      .populate('markedBy', 'name email')
      .populate('editedBy', 'name email')
      .sort({ date: -1, checkInTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Filter out null userId (when populate match fails)
    if (filterRole) {
      attendance = attendance.filter((att) => att.userId != null);
    }

    const total = filterRole ? attendance.length : await Attendance.countDocuments(query);

    res.status(200).json({
      attendance,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching all attendance:', error);
    res.status(500).json({ message: 'Error fetching attendance', error: error.message });
  }
};

// Manually mark attendance (Admin/TL only)
exports.manualMarkAttendance = async (req, res) => {
  try {
    const { userId, shiftId, date, checkInTime, checkOutTime, status, remarks } = req.body;
    const { organizationId, id: markedById, role } = req.user;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res
        .status(403)
        .json({ message: "You don't have permission to manually mark attendance" });
    }

    // Check if attendance already exists
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    let attendance = await Attendance.findOne({
      userId,
      date: attendanceDate,
    });

    if (attendance) {
      return res.status(400).json({ message: 'Attendance already exists for this date' });
    }

    // Build attendance object
    const attendanceData = {
      organizationId,
      userId,
      shiftId,
      date: attendanceDate,
      status,
      remarks,
      isManuallyMarked: true,
      markedBy: markedById,
    };

    // Process check-in time if provided
    let checkInDateTime = null;
    if (checkInTime && checkInTime !== '') {
      // If checkInTime includes date (ISO format), use it directly
      if (checkInTime.includes('T') || checkInTime.includes('-')) {
        checkInDateTime = new Date(checkInTime);
      } else {
        // If it's just time (HH:MM), combine with date
        const [hours, minutes] = checkInTime.split(':');
        checkInDateTime = new Date(attendanceDate);
        checkInDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      }

      // Validate the date
      if (!isNaN(checkInDateTime.getTime())) {
        attendanceData.checkInTime = checkInDateTime;
      }
    }

    // Process check-out time if provided
    let checkOutDateTime = null;
    if (checkOutTime && checkOutTime !== '') {
      // If checkOutTime includes date (ISO format), use it directly
      if (checkOutTime.includes('T') || checkOutTime.includes('-')) {
        checkOutDateTime = new Date(checkOutTime);
      } else {
        // If it's just time (HH:MM), combine with date
        const [hours, minutes] = checkOutTime.split(':');
        checkOutDateTime = new Date(attendanceDate);
        checkOutDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      }

      // Validate the date
      if (!isNaN(checkOutDateTime.getTime())) {
        attendanceData.checkOutTime = checkOutDateTime;
      }
    }

    // Calculate total hours only if both times are valid
    const totalHours = calculateHours(checkInDateTime, checkOutDateTime);
    attendanceData.totalHours = totalHours;

    attendance = new Attendance(attendanceData);

    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('userId', 'name employee_id email')
      .populate('shiftId', 'shiftName startTime endTime')
      .populate('markedBy', 'name email');

    res.status(201).json({
      message: 'Attendance marked successfully',
      attendance: populatedAttendance,
    });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ message: 'Error marking attendance', error: error.message });
  }
};

// Edit attendance (Admin/TL only)
exports.editAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkInTime, checkOutTime, status, editRemark } = req.body;
    const { organizationId, id: editedById, role } = req.user;

    // Check permission
    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to edit attendance" });
    }

    const attendance = await Attendance.findOne({ _id: id, organizationId });

    if (!attendance) {
      return res.status(404).json({ message: 'Attendance not found' });
    }

    // Update fields
    if (checkInTime) attendance.checkInTime = checkInTime;
    if (checkOutTime) attendance.checkOutTime = checkOutTime;
    if (status) attendance.status = status;

    attendance.totalHours = calculateHours(attendance.checkInTime, attendance.checkOutTime);

    attendance.editedBy = editedById;
    attendance.editedAt = new Date();
    attendance.editRemark = editRemark;

    await attendance.save();

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate('userId', 'name employee_id email')
      .populate('shiftId', 'shiftName startTime endTime')
      .populate('markedBy', 'name email')
      .populate('editedBy', 'name email');

    res.status(200).json({
      message: 'Attendance updated successfully',
      attendance: populatedAttendance,
    });
  } catch (error) {
    console.error('Error editing attendance:', error);
    res.status(500).json({ message: 'Error editing attendance', error: error.message });
  }
};

// Get attendance statistics
exports.getAttendanceStats = async (req, res) => {
  try {
    const { organizationId, role, id: userId } = req.user;
    const { startDate, endDate, userId: targetUserId } = req.query;

    const query = { organizationId };

    // If not Admin/TL/Management, only show own stats
    if (!['Admin', 'TL', 'Management'].includes(role)) {
      query.userId = userId;
    } else if (targetUserId) {
      query.userId = targetUserId;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const [totalDays, presentDays, absentDays, halfDays, totalHoursWorked] = await Promise.all([
      Attendance.countDocuments(query),
      Attendance.countDocuments({ ...query, status: 'Present' }),
      Attendance.countDocuments({ ...query, status: 'Absent' }),
      Attendance.countDocuments({ ...query, status: 'Half Day' }),
      Attendance.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$totalHours' } } },
      ]),
    ]);

    res.status(200).json({
      stats: {
        totalDays,
        presentDays,
        absentDays,
        halfDays,
        totalHoursWorked: totalHoursWorked[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching attendance stats:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
};

// Download attendance report
exports.downloadAttendanceReport = async (req, res) => {
  try {
    const { organizationId, role } = req.user;
    const {
      date,
      shiftId,
      userId,
      status,
      role: filterRole,
      month,
      year,
      format = 'csv',
    } = req.query;

    // Check permission
    if (!['Admin', 'TL', 'Management'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to download reports" });
    }

    const query = { organizationId };

    if (date) {
      const selectedDate = new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 1);
      query.date = { $gte: selectedDate, $lt: nextDate };
    } else if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      query.date = { $gte: startDate, $lte: endDate };
    }

    if (shiftId) query.shiftId = shiftId;
    if (userId) query.userId = userId;
    if (status) query.status = status;

    // Build the populate options with role filter if needed
    let userPopulateOptions = {
      path: 'userId',
      select: 'name employee_id email mobile role',
    };

    if (filterRole) {
      userPopulateOptions.match = { role: filterRole };
    }

    let attendance = await Attendance.find(query)
      .populate(userPopulateOptions)
      .populate('shiftId', 'shiftName startTime endTime')
      .populate('markedBy', 'name')
      .populate('editedBy', 'name')
      .sort({ date: -1, checkInTime: -1 });

    // Filter out null userId (when populate match fails)
    if (filterRole) {
      attendance = attendance.filter((att) => att.userId != null);
    }

    // Format data for CSV
    const csvData = attendance.map((record) => ({
      Date: new Date(record.date).toLocaleDateString(),
      'Employee ID': record.userId?.employee_id || '',
      'Employee Name': record.userId?.name || '',
      Email: record.userId?.email || '',
      Role: record.userId?.role || '',
      Shift: record.shiftId?.shiftName || '',
      'Check-In Time': record.checkInTime ? new Date(record.checkInTime).toLocaleString() : '',
      'Check-Out Time': record.checkOutTime ? new Date(record.checkOutTime).toLocaleString() : '',
      'Total Hours': record.totalHours || 0,
      Status: record.status,
      'Check-In Location': record.checkInLocation?.address || '',
      'Check-Out Location': record.checkOutLocation?.address || '',
      'Check-In IP': record.checkInIp || '',
      'Check-Out IP': record.checkOutIp || '',
      'Manually Marked': record.isManuallyMarked ? 'Yes' : 'No',
      'Marked By': record.markedBy?.name || '',
      'Edited By': record.editedBy?.name || '',
      'Edit Remark': record.editRemark || '',
      Remarks: record.remarks || '',
    }));

    res.status(200).json({
      data: csvData,
      count: csvData.length,
    });
  } catch (error) {
    console.error('Error downloading report:', error);
    res.status(500).json({ message: 'Error downloading report', error: error.message });
  }
};
