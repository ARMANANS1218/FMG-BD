const SalaryInvoice = require('../models/SalaryInvoice');
const User = require('../models/User');
// const Attendance = require('../models/Attendance'); // Not used directly in logic, kept for ref if needed
const { startOfMonth, endOfMonth, getDaysInMonth } = require('date-fns');

/**
 * Generate/Save invoice for a month
 * POST /api/invoices/generate
 */
exports.generateInvoice = async (req, res) => {
  try {
    const { month, year, employees } = req.body;
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
    const organizationId = req.user?.organizationId;

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
    invoice.publishedAt = new Date();
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
    invoice.publishedAt = null;
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
      .populate('createdBy', 'name email');

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
      .populate('createdBy', 'name email');

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
