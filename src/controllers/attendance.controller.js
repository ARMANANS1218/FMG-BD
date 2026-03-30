const Attendance = require('../models/Attendance');
const Shift = require('../models/Shift');
const Staff = require('../models/Staff');
const { cloudinary, uploadToCloudinary } = require('../config/cloudinary');
const moment = require('moment-timezone');

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

// Helper function to determine status based on check-in time and buffer
const determineStatus = (checkInTime, shiftStartTime, bufferMinutes = 10) => {
  if (!checkInTime || !shiftStartTime) return 'Present';

  // Compare in IST
  const checkIn = moment(checkInTime).tz('Asia/Kolkata');
  const [startHour, startMinute] = shiftStartTime.split(':').map(Number);

  // Set shift start time relative to the check-in day in IST
  const shiftStart = checkIn.clone().set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });

  const diffMinutes = checkIn.diff(shiftStart, 'minutes', true); // floating point minutes

  // Before shift start or within buffer — On Time
  if (diffMinutes <= bufferMinutes) return 'On Time';

  return 'Late';
};

// Check whether the check-in window is still open (or valid)
const isCheckInWindowOpen = (checkInTime, shiftStartTime, bufferMinutes = 10) => {
  if (!shiftStartTime) return { open: true };

  // Use IST
  const checkIn = moment(checkInTime).tz('Asia/Kolkata');
  const [startHour, startMinute] = shiftStartTime.split(':').map(Number);

  // Shift start in IST
  const shiftStart = checkIn.clone().set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });

  const diffMinutes = checkIn.diff(shiftStart, 'minutes', true);

  //TODO Check if strictly before shift start time (no early check-in allowed)
  if (diffMinutes < 0) {
    return {
      open: false,
      message: `Check-in starts strictly at ${shiftStartTime}. You cannot mark attendance before the shift time.`
    };
  }

  // Check if too late (grace period expired)
  if (diffMinutes > bufferMinutes) {
    return {
      open: false,
      message: `Check-in window has closed. Your shift started at ${shiftStartTime} and the ${bufferMinutes}-minute grace period has expired. You are ${Math.floor(diffMinutes)} minutes late. Please contact to Admin.`
    };
  }

  return { open: true };
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

    // Check if already checked in today (using IST day boundary)
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

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

    // Capture current time in IST
    const checkInTimeIST = moment().tz('Asia/Kolkata');
    const checkInTime = checkInTimeIST.toDate(); // Save as Date

    // Check if the check-in window is still open
    const bufferMin = shift.checkInGracePeriod ?? 10;
    // Pass the ISO string or Date object, helper handles conversion
    const windowCheck = isCheckInWindowOpen(checkInTime, shift.startTime, bufferMin);
    if (!windowCheck.open) {
      return res.status(403).json({ message: windowCheck.message });
    }

    const status = determineStatus(checkInTime, shift.startTime, bufferMin);

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

    // Find today's attendance (IST day boundary)
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

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

    // Check if checkout is allowed (ONLY within grace period before shift end)
    const shift = await Shift.findById(attendance.shiftId);
    if (shift) {
      // Use IST for current time
      const now = moment().tz('Asia/Kolkata');
      
      // Parse shift end time in IST
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);
      const shiftEnd = now.clone().set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
      
      const gracePeriodMin = shift.checkOutGracePeriod ?? 10;

      const allowedFrom = shiftEnd.clone().subtract(gracePeriodMin, 'minutes');
      
      // Format times for message (HH:MM)
      const allowedHour = allowedFrom.format('HH');
      const allowedMin = allowedFrom.format('mm');

      if (now.isBefore(allowedFrom)) {
        // Too early — before the grace period window
        return res.status(403).json({
          message: `Check-out is not available yet. Your shift ends at ${shift.endTime} and the ${gracePeriodMin}-minute grace period allows check-out from ${allowedHour}:${allowedMin} to ${shift.endTime}. Please wait.`
        });
      }

      if (now.isAfter(shiftEnd)) {
        // After shift end — window closed
        return res.status(403).json({
          message: `Check-out window has closed. Your shift ended at ${shift.endTime}. The check-out window was from ${allowedHour}:${allowedMin} to ${shift.endTime}. Please contact to Admin`
        });
      }
    }

    attendance.checkOutTime = moment().tz('Asia/Kolkata').toDate();
    attendance.checkOutImage = checkOutImageUrl;
    attendance.checkOutLocation = {
      latitude,
      longitude,
      address,
    };
    attendance.checkOutIp = ip;
    attendance.totalHours = calculateHours(attendance.checkInTime, attendance.checkOutTime);

    // Update status based on total hours
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

    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

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
      if (startDate) {
        query.date.$gte = moment.tz(startDate, 'Asia/Kolkata').startOf('day').toDate();
      }
      if (endDate) {
        query.date.$lte = moment.tz(endDate, 'Asia/Kolkata').endOf('day').toDate();
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
    const {
      date,
      startDate,
      endDate,
      shiftId,
      userId,
      status,
      role: filterRole,
      page = 1,
      limit = 1000,
    } = req.query;

    // Check permission
    if (!['Admin', 'TL', 'Management'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to view all attendance" });
    }

    const query = { organizationId };

    // Support date range filtering (startDate and endDate)
    // Support date range filtering (startDate and endDate) DO NOT USE new Date() directly
    if (startDate && endDate) {
      const start = moment.tz(startDate, 'Asia/Kolkata').startOf('day').toDate();
      const end = moment.tz(endDate, 'Asia/Kolkata').endOf('day').toDate();
      query.date = { $gte: start, $lte: end };
    } else if (date) {
      // Fallback to single date filtering
      const selectedDate = moment.tz(date, 'Asia/Kolkata').startOf('day');
      const nextDate = selectedDate.clone().add(1, 'days');
      query.date = { $gte: selectedDate.toDate(), $lt: nextDate.toDate() };
    }

    if (shiftId) query.shiftId = shiftId;
    if (userId) query.userId = userId;
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    // Build the populate options with role filter if needed
    // Exclude Admin and Management roles from attendance
    let userPopulateOptions = {
      path: 'userId',
      select: 'name employee_id email mobile role',
      match: { role: { $nin: ['Admin', 'Management'] } },
    };

    if (filterRole && !['Admin', 'Management'].includes(filterRole)) {
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

    // Filter out null userId (when populate match fails - excluded roles)
    attendance = attendance.filter((att) => att.userId != null);

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

    // Parse date as IST day boundary (consistent with checkIn/checkOut)
    const attendanceDate = moment.tz(date, 'Asia/Kolkata').startOf('day').toDate();

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
      if (checkInTime.includes('T') || checkInTime.includes('-')) {
        // ISO format — parse as IST
        checkInDateTime = moment.tz(checkInTime, 'Asia/Kolkata').toDate();
      } else {
        // Just time (HH:MM) — combine with the attendance date in IST
        const [hours, minutes] = checkInTime.split(':');
        checkInDateTime = moment.tz(date, 'Asia/Kolkata').set({ hour: parseInt(hours), minute: parseInt(minutes), second: 0, millisecond: 0 }).toDate();
      }

      if (!isNaN(checkInDateTime.getTime())) {
        attendanceData.checkInTime = checkInDateTime;
      }
    }

    // Process check-out time if provided
    let checkOutDateTime = null;
    if (checkOutTime && checkOutTime !== '') {
      if (checkOutTime.includes('T') || checkOutTime.includes('-')) {
        // ISO format — parse as IST
        checkOutDateTime = moment.tz(checkOutTime, 'Asia/Kolkata').toDate();
      } else {
        // Just time (HH:MM) — combine with the attendance date in IST
        const [hours, minutes] = checkOutTime.split(':');
        checkOutDateTime = moment.tz(date, 'Asia/Kolkata').set({ hour: parseInt(hours), minute: parseInt(minutes), second: 0, millisecond: 0 }).toDate();
      }

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

// Delete attendance record (Admin/TL only)
exports.deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId, role } = req.user;

    if (!['Admin', 'TL'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to delete attendance" });
    }

    const attendance = await Attendance.findOneAndDelete({ _id: id, organizationId });

    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    res.status(200).json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({ message: 'Error deleting attendance', error: error.message });
  }
};

// Get attendance statistics
exports.getAttendanceStats = async (req, res) => {
  try {
    const { organizationId, role, id: userId } = req.user;
    const { startDate, endDate, userId: targetUserId } = req.query;

    const query = { organizationId };

    // If not Admin/TL, only show own stats
    if (!['Admin', 'TL'].includes(role)) {
      query.userId = userId;
    } else if (targetUserId) {
      query.userId = targetUserId;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = moment.tz(startDate, 'Asia/Kolkata').startOf('day').toDate();
      }
      if (endDate) {
        query.date.$lte = moment.tz(endDate, 'Asia/Kolkata').endOf('day').toDate();
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
    const { date, shiftId, month, year, format = 'csv' } = req.query;

    // Check permission
    if (!['Admin', 'TL', 'Management'].includes(role)) {
      return res.status(403).json({ message: "You don't have permission to download reports" });
    }

    const query = { organizationId };

    if (date) {
      const selectedDate = moment.tz(date, 'Asia/Kolkata').startOf('day');
      const nextDate = selectedDate.clone().add(1, 'days');
      query.date = { $gte: selectedDate.toDate(), $lt: nextDate.toDate() };
    } else if (month && year) {
      // Month is 1-indexed in query, but moment months are 0-indexed? 
      // Actually standardizing: constructing date YYYY-MM-01
      const startDate = moment.tz({ year, month: month - 1, day: 1 }, 'Asia/Kolkata').startOf('day');
      const endDate = startDate.clone().endOf('month');
      query.date = { $gte: startDate.toDate(), $lte: endDate.toDate() };
    }

    if (shiftId) query.shiftId = shiftId;

    const attendance = await Attendance.find(query)
      .populate('userId', 'name employee_id email mobile')
      .populate('shiftId', 'shiftName startTime endTime')
      .populate('markedBy', 'name')
      .populate('editedBy', 'name')
      .sort({ date: -1, checkInTime: -1 });

    // Format data for CSV
    const csvData = attendance.map((record) => ({
      Date: new Date(record.date).toLocaleDateString(),
      'Employee ID': record.userId?.employee_id || '',
      'Employee Name': record.userId?.name || '',
      Email: record.userId?.email || '',
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

/**
 * Bulk update totalHours for specific attendance records
 * PUT /api/v1/attendance/bulk-update-hours
 * Body: { userId, updates: [{ date, totalHours }] }
 */
exports.bulkUpdateAttendanceHours = async (req, res) => {
  try {
    const { userId, updates } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId || !userId || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        status: false,
        message: 'userId and updates array are required',
      });
    }

    const results = await Promise.all(
      updates.map(({ date, totalHours }) => {
        const dayStart = moment.tz(date, 'Asia/Kolkata').startOf('day').toDate();
        const dayEnd = moment.tz(date, 'Asia/Kolkata').endOf('day').toDate();
        return Attendance.findOneAndUpdate(
          { userId, organizationId, date: { $gte: dayStart, $lte: dayEnd } },
          { $set: { totalHours: parseFloat(totalHours) || 0 } },
          { new: true }
        );
      })
    );

    const updated = results.filter(Boolean).length;
    return res.status(200).json({
      status: true,
      message: `Updated ${updated} attendance record(s)`,
      updated,
    });
  } catch (error) {
    console.error('Error bulk updating attendance hours:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to update attendance hours',
      error: error.message,
    });
  }
};
