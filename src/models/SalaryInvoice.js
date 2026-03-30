const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const EmployeeInvoiceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: { type: String, required: true },
  email: { type: String },
  employee_id: { type: String },
  role: { type: String },
  presentDays: { type: Number, default: 0 },
  halfDays: { type: Number, default: 0 },
  absentDays: { type: Number, default: 0 },
  payableDays: { type: Number, default: 0 },
  dailyRate: { type: Number, default: 0 },
  hourlyRate: { type: Number, default: 0 },
  totalSalary: { type: Number, default: 0 },
  loginHours: { type: Number, default: 0 },
});

const BankDetailsSchema = new mongoose.Schema({
  beneficiaryName: {
    type: String,
    required: true,
  },
  bankName: {
    type: String,
    required: true,
  },
  accountNumber: {
    type: String,
    required: true,
  },
  ifscCode: {
    type: String,
    required: true,
  },
  swiftCode: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    default: null,
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  updatedAt: {
    type: Date,
    default: null,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
});

const CenterBankDetailsSchema = new mongoose.Schema({
  centerCode: {
    type: String,
    required: true,
    trim: true,
  },
  beneficiaryName: {
    type: String,
    required: true,
  },
  bankName: {
    type: String,
    required: true,
  },
  accountNumber: {
    type: String,
    required: true,
  },
  ifscCode: {
    type: String,
    required: true,
  },
  swiftCode: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    default: null,
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  updatedAt: {
    type: Date,
    default: null,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
});

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
    invoiceNumber: {
      type: String,
      default: '',
    },
    issueDate: {
      type: String,
      default: '',
    },
    projectCode: {
      type: String,
      default: '',
    },
    clientCode: {
      type: String,
      default: '',
    },
    companyName: {
      type: String,
      default: '',
    },
    companyEmail: {
      type: String,
      default: '',
    },
    companyAddress: {
      type: String,
      default: '',
    },
    employees: [EmployeeInvoiceSchema],
    excludedEmployees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    bankDetails: BankDetailsSchema,
    centerBankDetails: {
      type: [CenterBankDetailsSchema],
      default: [],
    },
    grandTotal: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishRemark: {
      type: String,
      default: '',
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    managementApprovalStatus: {
      type: String,
      enum: ['Pending', 'Accepted', 'Denied'],
      default: 'Pending',
    },
    managementDecisionRemark: {
      type: String,
      default: '',
    },
    managementDecisionAt: {
      type: Date,
      default: null,
    },
    managementDecisionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    creditedDate: {
      type: Date,
      default: null,
    },
    transactionDate: {
      type: Date,
      default: null,
    },
    transactionReferenceNumber: {
      type: String,
      default: '',
    },
    transactionStatus: {
      type: String,
      enum: ['Pending', 'Success', 'Decline'],
      default: 'Pending',
    },
    transactionType: {
      type: String,
      enum: ['Wire Transfer', 'Forex Transfer'],
      default: 'Wire Transfer',
    },
    transactionStatusUpdatedAt: {
      type: Date,
      default: null,
    },
    transactionStatusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index to ensure one invoice per org per month
SalaryInvoiceSchema.index({ organizationId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('SalaryInvoice', SalaryInvoiceSchema);
