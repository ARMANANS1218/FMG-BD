const SalaryInvoice = require('../models/SalaryInvoice');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const DailyActivity = require('../models/DailyActivity');
const { startOfMonth, endOfMonth, getDaysInMonth } = require('date-fns');
const moment = require('moment-timezone');

/**
 * Helper function to generate invoice number in format BT/xxxxx/yyyy
 */
const generateInvoiceNumber = async (organizationId, year) => {
  try {
    // Get the count of invoices for this organization in the given year
    const count = await SalaryInvoice.countDocuments({
      organizationId,
      year,
    });
    // Format as BT/xxxxx/yyyy where xxxxx is 5-digit zero-padded number
    const uniqueCode = String(count + 1).padStart(5, '0');
    return `BT/${uniqueCode}/${year}`;
  } catch (error) {
    console.error('Error generating invoice number:', error);
    return `BT/${String(Date.now()).slice(-5)}/${year}`;
  }
};

/**
 * Generate/Save invoice for a month
 * POST /api/invoices/generate
 */
exports.generateInvoice = async (req, res) => {
  try {
    const { month, year, employees, invoiceNumber, issueDate, projectCode, clientCode, companyName, companyEmail, companyAddress } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    if (!month || !year || !employees || !Array.isArray(employees)) {
      return res.status(400).json({
        status: false,
        message: 'Month, year, and employees data are required',
      });
    }

    // Calculate grand total
    const grandTotal = employees.reduce((sum, emp) => sum + (emp.totalSalary || 0), 0);

    // Check if invoice already exists for this month
    let invoice = await SalaryInvoice.findOne({
      organizationId,
      month,
      year,
    });

    if (invoice) {
      // Update existing invoice
      invoice.employees = employees;
      invoice.grandTotal = grandTotal;
      invoice.createdBy = userId;
      if (invoiceNumber !== undefined) invoice.invoiceNumber = invoiceNumber;
      if (issueDate !== undefined) invoice.issueDate = issueDate;
      if (projectCode !== undefined) invoice.projectCode = projectCode;
      if (clientCode !== undefined) invoice.clientCode = clientCode;
      if (companyName !== undefined) invoice.companyName = companyName;
      if (companyEmail !== undefined) invoice.companyEmail = companyEmail;
      if (companyAddress !== undefined) invoice.companyAddress = companyAddress;
      await invoice.save();
    } else {
      // Create new invoice
      invoice = await SalaryInvoice.create({
        organizationId,
        month,
        year,
        employees,
        grandTotal,
        createdBy: userId,
        invoiceNumber: invoiceNumber || '',
        issueDate: issueDate || '',
        projectCode: projectCode || '',
        clientCode: clientCode || '',
        companyName: companyName || '',
        companyEmail: companyEmail || '',
        companyAddress: companyAddress || '',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Invoice saved successfully',
      data: invoice,
    });
  } catch (error) {
    console.error('Error generating invoice:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to generate invoice',
      error: error.message,
    });
  }
};

/**
 * Publish invoice for Management to view
 * PUT /api/invoices/:id/publish
 */
exports.publishInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { remark } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    const role = req.user?.role;
    const customRole = req.user?.customRole || '';

    // Allow Admin, SuperAdmin, Dev, and custom roles Client/Aggregator
    const allowedRoles = ['Admin', 'SuperAdmin', 'Dev', 'client', 'aggregator', 'Client', 'Aggregator'];
    if (!allowedRoles.includes(role) && !allowedRoles.includes(customRole)) {
      return res.status(403).json({
        status: false,
        message: 'Only Admin, Client, or Aggregator can publish invoice',
      });
    }

    if (!remark || !remark.trim()) {
      return res.status(400).json({
        status: false,
        message: 'Publish remark is required',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      _id: id,
      organizationId,
    });

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Invoice not found',
      });
    }

    invoice.isPublished = true;
    invoice.publishRemark = remark.trim();
    invoice.publishedAt = new Date();
    invoice.publishedBy = userId;
    invoice.managementApprovalStatus = 'Pending';
    invoice.managementDecisionRemark = '';
    invoice.managementDecisionAt = null;
    invoice.managementDecisionBy = null;
    invoice.creditedDate = null;
    invoice.transactionDate = null;
    
    // Auto-generate invoice number if not set
    if (!invoice.invoiceNumber) {
      invoice.invoiceNumber = await generateInvoiceNumber(organizationId, invoice.year);
    }
    
    // Auto-generate transaction reference number if not set
    if (!invoice.transactionReferenceNumber) {
      const refNum = `TXN/${Date.now().toString().slice(-8)}/${invoice.month.toString().padStart(2, '0')}`;
      invoice.transactionReferenceNumber = refNum;
    }
    
    await invoice.save();

    return res.status(200).json({
      status: true,
      message: 'Invoice published successfully',
      data: invoice,
    });
  } catch (error) {
    console.error('Error publishing invoice:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to publish invoice',
      error: error.message,
    });
  }
};

/**
 * Unpublish invoice
 * PUT /api/invoices/:id/unpublish
 */
exports.unpublishInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    const role = req.user?.role;
    const customRole = req.user?.customRole || '';

    // Allow Admin, SuperAdmin, Dev, and custom roles Client/Aggregator
    const allowedRoles = ['Admin', 'SuperAdmin', 'Dev', 'client', 'aggregator', 'Client', 'Aggregator'];
    if (!allowedRoles.includes(role) && !allowedRoles.includes(customRole)) {
      return res.status(403).json({
        status: false,
        message: 'Only Admin, Client, or Aggregator can unpublish invoice',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      _id: id,
      organizationId,
    });

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Invoice not found',
      });
    }

    invoice.isPublished = false;
    invoice.publishRemark = '';
    invoice.publishedAt = null;
    invoice.publishedBy = null;
    invoice.managementApprovalStatus = 'Pending';
    invoice.managementDecisionRemark = '';
    invoice.managementDecisionAt = null;
    invoice.managementDecisionBy = null;
    invoice.creditedDate = null;
    invoice.transactionDate = null;
    await invoice.save();

    return res.status(200).json({
      status: true,
      message: 'Invoice unpublished successfully',
      data: invoice,
    });
  } catch (error) {
    console.error('Error unpublishing invoice:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to unpublish invoice',
      error: error.message,
    });
  }
};

/**
 * Get invoice by month/year (Admin)
 * GET /api/invoices/:month/:year
 */
exports.getInvoiceByMonth = async (req, res) => {
  try {
    const { month, year } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      organizationId,
      month: parseInt(month),
      year: parseInt(year),
    }).populate('createdBy', 'name email');

    return res.status(200).json({
      status: true,
      message: invoice ? 'Invoice found' : 'No invoice found for this month',
      data: invoice,
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch invoice',
      error: error.message,
    });
  }
};

/**
 * Get published invoice for Management
 * GET /api/invoices/management?month=1&year=2026
 */
exports.getInvoiceForManagement = async (req, res) => {
  try {
    const { month, year } = req.query;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const query = {
      organizationId,
      isPublished: true,
    };

    if (month && year) {
      query.month = parseInt(month);
      query.year = parseInt(year);
    }

    const invoice = await SalaryInvoice.findOne(query)
      .sort({ year: -1, month: -1 })
      .populate('createdBy', 'name email')
      .populate('publishedBy', 'name email')
      .populate('managementDecisionBy', 'name email');

    if (!invoice) {
      return res.status(200).json({
        status: true,
        message: 'No published invoice available',
        data: null,
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Published invoice found',
      data: invoice,
    });
  } catch (error) {
    console.error('Error fetching invoice for management:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch invoice',
      error: error.message,
    });
  }
};

/**
 * Get all invoices for organization (Admin)
 * GET /api/invoices
 */
exports.getAllInvoices = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const invoices = await SalaryInvoice.find({ organizationId })
      .sort({ year: -1, month: -1 })
      .populate('createdBy', 'name email')
      .populate('publishedBy', 'name email')
      .populate('managementDecisionBy', 'name email');

    return res.status(200).json({
      status: true,
      message: 'Invoices fetched successfully',
      data: invoices,
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch invoices',
      error: error.message,
    });
  }
};

/**
 * Management Accept/Deny invoice
 * PUT /api/invoices/:id/management-review
 */
exports.reviewInvoiceByManagement = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, remark, creditedDate, transactionDate } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    const role = req.user?.role;

    if (role !== 'Management') {
      return res.status(403).json({
        status: false,
        message: 'Only Management can accept/deny invoice',
      });
    }

    if (!['accept', 'deny'].includes(action)) {
      return res.status(400).json({
        status: false,
        message: 'Action must be either accept or deny',
      });
    }

    if (action === 'deny' && (!remark || !remark.trim())) {
      return res.status(400).json({
        status: false,
        message: 'Deny remark is required',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      _id: id,
      organizationId,
      isPublished: true,
    });

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Published invoice not found',
      });
    }

    const now = new Date();
    invoice.managementApprovalStatus = action === 'accept' ? 'Accepted' : 'Denied';
    invoice.managementDecisionRemark = (remark || '').trim();
    invoice.managementDecisionAt = now;
    invoice.managementDecisionBy = userId;

    if (action === 'accept') {
      invoice.creditedDate = creditedDate ? new Date(creditedDate) : now;
      invoice.transactionDate = transactionDate ? new Date(transactionDate) : now;
    } else {
      invoice.creditedDate = null;
      invoice.transactionDate = null;
    }

    await invoice.save();

    const refreshed = await SalaryInvoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('publishedBy', 'name email')
      .populate('managementDecisionBy', 'name email');

    return res.status(200).json({
      status: true,
      message: `Invoice ${action === 'accept' ? 'accepted' : 'denied'} successfully`,
      data: refreshed,
    });
  } catch (error) {
    console.error('Error reviewing invoice:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to review invoice',
      error: error.message,
    });
  }
};

/**
 * Get transaction process timeline for invoices
 * GET /api/invoices/management/transactions
 */
exports.getInvoiceTransactions = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const invoices = await SalaryInvoice.find({
      organizationId,
      isPublished: true,
    })
      .sort({ year: -1, month: -1 })
      .populate('createdBy', 'name email')
      .populate('publishedBy', 'name email')
      .populate('managementDecisionBy', 'name email');

    return res.status(200).json({
      status: true,
      message: 'Invoice transaction process fetched successfully',
      data: invoices,
    });
  } catch (error) {
    console.error('Error fetching invoice transactions:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch invoice transactions',
      error: error.message,
    });
  }
};

/**
 * Get login hours for all employees for a given month (from Attendance records)
 * GET /api/invoices/login-hours/:month/:year
 * Returns: { data: { userId: totalHours (decimal hours) } }
 */
exports.getLoginHoursByMonth = async (req, res) => {
  try {
    const { month, year } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const monthInt = parseInt(month);
    const yearInt = parseInt(year);

    // Build IST-aware date range for the month
    const startDate = moment.tz({ year: yearInt, month: monthInt - 1, day: 1 }, 'Asia/Kolkata').startOf('day').toDate();
    const endDate = moment.tz({ year: yearInt, month: monthInt - 1, day: 1 }, 'Asia/Kolkata').endOf('month').endOf('day').toDate();

    // Aggregate totalHours per user from Attendance records
    const attendanceAgg = await Attendance.aggregate([
      {
        $match: {
          organizationId: new (require('mongoose').Types.ObjectId)(organizationId),
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$userId',
          totalHours: { $sum: '$totalHours' },
        },
      },
    ]);

    // Convert to a map: userId -> totalHours (decimal hours)
    const loginHoursMap = {};
    attendanceAgg.forEach((rec) => {
      loginHoursMap[rec._id.toString()] = parseFloat((rec.totalHours || 0).toFixed(2));
    });

    return res.status(200).json({
      status: true,
      message: 'Login hours fetched successfully',
      data: loginHoursMap,
    });
  } catch (error) {
    console.error('Error fetching login hours:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch login hours',
      error: error.message,
    });
  }
};

/**
 * Update transaction status (Client/Aggregator/Admin)
 * PUT /api/invoices/:id/transaction-status
 */
exports.updateTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, transactionType, transactionReferenceNumber } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    const normalizedRole = normalizeRoleKey(req.user?.role);
    const normalizedCustomRole = normalizeRoleKey(req.user?.customRole || req.user?.role);

    // Admin, Client and Aggregator roles can update transaction status
    const allowedRoles = ['client', 'admin', 'aggregator'];
    if (!allowedRoles.includes(normalizedRole) && !allowedRoles.includes(normalizedCustomRole)) {
      return res.status(403).json({
        status: false,
        message: 'Only Admin, Client and Aggregator roles can update transaction status',
      });
    }

    if (!['Pending', 'Success', 'Decline'].includes(status)) {
      return res.status(400).json({
        status: false,
        message: 'Status must be Pending, Success, or Decline',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      _id: id,
      organizationId,
      isPublished: true,
      managementApprovalStatus: 'Accepted',
    });

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Published and accepted invoice not found',
      });
    }

    invoice.transactionStatus = status;
    invoice.transactionStatusUpdatedAt = new Date();
    invoice.transactionStatusUpdatedBy = userId;
    
    if (transactionType && ['Wire Transfer', 'Forex Transfer'].includes(transactionType)) {
      invoice.transactionType = transactionType;
    }
    
    if (transactionReferenceNumber && transactionReferenceNumber.trim()) {
      invoice.transactionReferenceNumber = transactionReferenceNumber.trim();
    }

    await invoice.save();

    const refreshed = await SalaryInvoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('publishedBy', 'name email')
      .populate('managementDecisionBy', 'name email')
      .populate('transactionStatusUpdatedBy', 'name email');

    return res.status(200).json({
      status: true,
      message: 'Transaction status updated successfully',
      data: refreshed,
    });
  } catch (error) {
    console.error('Error updating transaction status:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to update transaction status',
      error: error.message,
    });
  }
};

/**
 * Get daily activity breakdown for all employees for a given month
 * GET /api/invoices/daily-breakdown/:month/:year
 * Returns: { data: { "userId": [ { date, loginTime, logoutTime, totalOnlineMinutes, totalBreakTime, breakCount } ] } }
 */
exports.getDailyBreakdown = async (req, res) => {
  try {
    const { month, year } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    const monthInt = parseInt(month);
    const yearInt = parseInt(year);

    // Build IST-aware date range for the month
    const startDate = moment.tz({ year: yearInt, month: monthInt - 1, day: 1 }, 'Asia/Kolkata').startOf('day').toDate();
    const endDate = moment.tz({ year: yearInt, month: monthInt - 1, day: 1 }, 'Asia/Kolkata').endOf('month').endOf('day').toDate();

    const activities = await DailyActivity.find({
      organizationId,
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: 1 })
      .lean();

    // Group by userId
    const breakdownMap = {};
    activities.forEach((act) => {
      const uid = act.userId.toString();
      if (!breakdownMap[uid]) breakdownMap[uid] = [];
      breakdownMap[uid].push({
        date: act.date,
        loginTime: act.loginTime,
        logoutTime: act.logoutTime,
        totalOnlineMinutes: act.totalOnlineTime || 0,
        totalBreakTime: act.totalBreakTime || 0,
        breakCount: act.breakCount || 0,
      });
    });

    return res.status(200).json({
      status: true,
      message: 'Daily breakdown fetched successfully',
      data: breakdownMap,
    });
  } catch (error) {
    console.error('Error fetching daily breakdown:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch daily breakdown',
      error: error.message,
    });
  }
};

/**
 * Overwrite login hours for an employee (or all employees) in a saved invoice
 * PUT /api/invoices/overwrite-login-hours
 * Body: { month, year, updates: [{ userId, loginHours }] }
 */
exports.overwriteLoginHours = async (req, res) => {
  try {
    const { month, year, updates } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    if (!month || !year || !updates || !Array.isArray(updates)) {
      return res.status(400).json({
        status: false,
        message: 'Month, year, and updates array are required',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      organizationId,
      month: parseInt(month),
      year: parseInt(year),
    });

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Invoice not found. Please save the invoice first.',
      });
    }

    // Apply updates
    updates.forEach(({ userId, loginHours }) => {
      const emp = invoice.employees.find(
        (e) => e.userId.toString() === userId
      );
      if (emp) {
        emp.loginHours = parseFloat(loginHours) || 0;
      }
    });

    await invoice.save();

    return res.status(200).json({
      status: true,
      message: 'Login hours updated successfully',
      data: invoice,
    });
  } catch (error) {
    console.error('Error overwriting login hours:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to overwrite login hours',
      error: error.message,
    });
  }
};

/**
 * Update excluded employees list for an invoice
 * PUT /api/invoices/excluded-employees
 */
exports.updateExcludedEmployees = async (req, res) => {
  try {
    const { month, year, excludedEmployees } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    if (!month || !year || !Array.isArray(excludedEmployees)) {
      return res.status(400).json({
        status: false,
        message: 'Month, year, and excludedEmployees array are required',
      });
    }

    // Upsert: find or create the invoice record to store excluded employees
    let invoice = await SalaryInvoice.findOne({
      organizationId,
      month: parseInt(month),
      year: parseInt(year),
    });

    if (invoice) {
      invoice.excludedEmployees = excludedEmployees;
      await invoice.save();
    } else {
      invoice = await SalaryInvoice.create({
        organizationId,
        month: parseInt(month),
        year: parseInt(year),
        employees: [],
        excludedEmployees,
        grandTotal: 0,
        createdBy: req.user?.id,
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Excluded employees updated',
      data: invoice,
    });
  } catch (error) {
    console.error('Error updating excluded employees:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to update excluded employees',
      error: error.message,
    });
  }
};

/**
 * Add or update bank details (Client/Aggregator only)
 * PUT /api/invoices/:id/bank-details
 */
const normalizeRoleKey = (value = '') => {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'aggerator') return 'aggregator';
  if (role === 'assosiate') return 'associate';
  return role;
};

const normalizeCenterCode = (value = '') => String(value || '').trim().toUpperCase();

exports.updateBankDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { centerCode, beneficiaryName, bankName, accountNumber, ifscCode, swiftCode, country, state } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;
    const currentUser = await User.findById(userId).select('role customRole employee_id').lean();
    const userRole = normalizeRoleKey(currentUser?.customRole || currentUser?.role || req.user?.role);

    // Client, Aggregator, and Admin roles can add/update bank details
    const allowedRoles = ['client', 'aggregator', 'admin'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Only Client, Aggregator, and Admin roles can manage bank details',
      });
    }

    const normalizedCenterCode = normalizeCenterCode(centerCode);

    // Validate required fields
    if (!normalizedCenterCode || !beneficiaryName || !bankName || !accountNumber || !ifscCode || !swiftCode || !country || !state) {
      return res.status(400).json({
        status: false,
        message: 'All bank details fields are required: centerCode, beneficiaryName, bankName, accountNumber, ifscCode, swiftCode, country, state',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      _id: id,
      organizationId,
    });

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Invoice not found',
      });
    }

    const payload = {
      centerCode: normalizedCenterCode,
      beneficiaryName,
      bankName,
      accountNumber,
      ifscCode,
      swiftCode,
      country,
      state,
      updatedAt: new Date(),
      updatedBy: userId,
    };

    const existingSingle = Array.isArray(invoice.centerBankDetails) && invoice.centerBankDetails.length
      ? invoice.centerBankDetails[0]
      : null;
    invoice.centerBankDetails = [
      {
        ...payload,
        addedAt: existingSingle?.addedAt || new Date(),
        addedBy: existingSingle?.addedBy || userId,
      },
    ];

    // Keep legacy field aligned for compatibility with old UI
    invoice.bankDetails = {
      beneficiaryName,
      bankName,
      accountNumber,
      ifscCode,
      swiftCode,
      country,
      state,
      addedAt: invoice.bankDetails?.addedAt || new Date(),
      addedBy: invoice.bankDetails?.addedBy || userId,
      updatedAt: new Date(),
      updatedBy: userId,
    };

    await invoice.save();

    // Keep one consistent bank mapping across all months/years in this organization
    const otherInvoices = await SalaryInvoice.find({
      organizationId,
      _id: { $ne: invoice._id },
    });

    await Promise.all(
      otherInvoices.map(async (otherInvoice) => {
        const sharedPayload = {
          centerCode: normalizedCenterCode,
          beneficiaryName,
          bankName,
          accountNumber,
          ifscCode,
          swiftCode,
          country,
          state,
          updatedAt: new Date(),
          updatedBy: userId,
        };

        const existingSingleForInvoice = Array.isArray(otherInvoice.centerBankDetails) && otherInvoice.centerBankDetails.length
          ? otherInvoice.centerBankDetails[0]
          : null;
        otherInvoice.centerBankDetails = [
          {
            ...sharedPayload,
            addedAt: existingSingleForInvoice?.addedAt || new Date(),
            addedBy: existingSingleForInvoice?.addedBy || userId,
          },
        ];

        otherInvoice.bankDetails = {
          beneficiaryName,
          bankName,
          accountNumber,
          ifscCode,
          swiftCode,
          country,
          state,
          addedAt: otherInvoice.bankDetails?.addedAt || new Date(),
          addedBy: otherInvoice.bankDetails?.addedBy || userId,
          updatedAt: new Date(),
          updatedBy: userId,
        };

        await otherInvoice.save();
      })
    );

    return res.status(200).json({
      status: true,
      message: `Bank details updated successfully for center code ${normalizedCenterCode}`,
      data: invoice.centerBankDetails?.[0] || null,
    });
  } catch (error) {
    console.error('Error updating bank details:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to update bank details',
      error: error.message,
    });
  }
};

/**
 * Get bank details (All management roles can view)
 * GET /api/invoices/:id/bank-details
 */
exports.getBankDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const requestedCenterCode = normalizeCenterCode(req.query?.centerCode);
    const organizationId = req.user?.organizationId;
    const currentUser = await User.findById(req.user?.id).select('role customRole employee_id').lean();
    const userRole = normalizeRoleKey(currentUser?.customRole || currentUser?.role || req.user?.role);
    const viewerCenterCode = normalizeCenterCode(currentUser?.employee_id || req.user?.employee_id || req.user?.centerCode);

    // All management roles can view bank details
    const allowedRoles = ['client', 'aggregator', 'center', 'associate', 'management', 'admin'];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Unauthorized to view bank details',
      });
    }

    const invoice = await SalaryInvoice.findOne({
      _id: id,
      organizationId,
    })
      .populate('bankDetails.addedBy', 'name email')
      .populate('bankDetails.updatedBy', 'name email')
      .populate('centerBankDetails.addedBy', 'name email')
      .populate('centerBankDetails.updatedBy', 'name email');

    if (!invoice) {
      return res.status(404).json({
        status: false,
        message: 'Invoice not found',
      });
    }

    let centerEntries = Array.isArray(invoice.centerBankDetails) ? invoice.centerBankDetails : [];

    // Fallback: if requested invoice has no entries, search organization-wide
    if (!centerEntries.length) {
      const orgInvoices = await SalaryInvoice.find({ organizationId })
        .select('centerBankDetails bankDetails updatedAt')
        .populate('centerBankDetails.addedBy', 'name email')
        .populate('centerBankDetails.updatedBy', 'name email')
        .sort({ updatedAt: -1 })
        .lean();

      const aggregated = [];
      orgInvoices.forEach((inv) => {
        if (Array.isArray(inv.centerBankDetails) && inv.centerBankDetails.length) {
          inv.centerBankDetails.forEach((entry) => aggregated.push(entry));
        }
      });

      centerEntries = aggregated;

      if (!centerEntries.length) {
        const fallbackLegacy = orgInvoices.find((inv) => inv?.bankDetails)?.bankDetails || invoice.bankDetails;
        if (fallbackLegacy) {
          return res.status(200).json({
            status: true,
            data: fallbackLegacy,
          });
        }
      }
    }

    // Backward compatibility for legacy invoices
    if (!centerEntries.length && invoice.bankDetails) {
      return res.status(200).json({
        status: true,
        data: invoice.bankDetails || null,
      });
    }

    // Center/Associate prefer their own center mapping, else fallback to shared entry
    if (['center', 'associate'].includes(userRole)) {
      const ownEntry = viewerCenterCode
        ? centerEntries.find((entry) => normalizeCenterCode(entry?.centerCode) === viewerCenterCode)
        : null;

      return res.status(200).json({
        status: true,
        data: ownEntry || centerEntries[0] || null,
      });
    }

    // Client/Aggregator/Admin/Management can query any center by code
    if (requestedCenterCode) {
      const matchedEntry = centerEntries.find(
        (entry) => normalizeCenterCode(entry?.centerCode) === requestedCenterCode
      );

      return res.status(200).json({
        status: true,
        data: matchedEntry || centerEntries[0] || null,
      });
    }

    return res.status(200).json({
      status: true,
      data: centerEntries[0] || null,
      allCenterBankDetails: centerEntries,
    });
  } catch (error) {
    console.error('Error fetching bank details:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch bank details',
      error: error.message,
    });
  }
};
