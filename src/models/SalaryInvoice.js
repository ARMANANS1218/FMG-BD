const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const SalaryInvoiceSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
    },
    employees: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        name: String,
        role: String,
        presentDays: Number,
        halfDays: Number,
        absentDays: Number,
        payableDays: Number,
        dailyRate: Number,
        totalSalary: Number,
      },
    ],
    grandTotal: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdAt: {
      type: Date,
      default: getIndiaTime,
    },
    updatedAt: {
      type: Date,
      default: getIndiaTime,
    },
  },
  { timestamps: true }
);

// Unique compound index to prevent duplicate invoices for same month/org
SalaryInvoiceSchema.index({ organizationId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('SalaryInvoice', SalaryInvoiceSchema);
