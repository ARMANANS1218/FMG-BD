const mongoose = require('mongoose');

// Metric weights must align with frontend (total 100)
const METRIC_WEIGHTS = {
  // Communication & Language (15)
  grammarSpelling: 5,
  sentenceStructure: 3,
  professionalLanguage: 4,
  toneCourtesy: 3,
  // Greeting & Closing (10)
  properGreeting: 3,
  personalization: 3,
  standardClosing: 2,
  brandTone: 2,
  // Issue Understanding (15)
  issueIdentified: 5,
  issueAcknowledged: 5,
  noAssumptions: 5,
  // Resolution & Accuracy (25)
  correctResolution: 8,
  allQueriesAddressed: 6,
  sopCompliance: 6,
  firstContactResolution: 5,
  // Empathy & Ownership (15)
  empathyStatement: 5,
  ownershipTaken: 5,
  reassuranceProvided: 5,
  // Formatting & Readability (10)
  properFormatting: 4,
  readableStructure: 3,
  noOverFormatting: 3,
  // Compliance & Security (10)
  dataPrivacy: 4,
  authenticationFollowed: 3,
  policyAdherence: 3,
};

const criticalErrorSchema = new mongoose.Schema({
  incorrectInfo: { type: Boolean, default: false },
  dataPrivacyBreach: { type: Boolean, default: false },
  rudeLanguage: { type: Boolean, default: false },
  processDeviation: { type: Boolean, default: false },
  wrongResolution: { type: Boolean, default: false },
}, { _id: false });

const ticketEvaluationSchema = new mongoose.Schema({
  ticketRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTicket', required: true },
  ticketId: { type: String, required: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  agentName: String,
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  evaluatorRole: { type: String, enum: ['QA', 'TL'], required: true },

  // Scores are stored as numeric fields for easy aggregation
  grammarSpelling: { type: Number, min: 1, max: 10 },
  sentenceStructure: { type: Number, min: 1, max: 10 },
  professionalLanguage: { type: Number, min: 1, max: 10 },
  toneCourtesy: { type: Number, min: 1, max: 10 },
  properGreeting: { type: Number, min: 1, max: 10 },
  personalization: { type: Number, min: 1, max: 10 },
  standardClosing: { type: Number, min: 1, max: 10 },
  brandTone: { type: Number, min: 1, max: 10 },
  issueIdentified: { type: Number, min: 1, max: 10 },
  issueAcknowledged: { type: Number, min: 1, max: 10 },
  noAssumptions: { type: Number, min: 1, max: 10 },
  correctResolution: { type: Number, min: 1, max: 10 },
  allQueriesAddressed: { type: Number, min: 1, max: 10 },
  sopCompliance: { type: Number, min: 1, max: 10 },
  firstContactResolution: { type: Number, min: 1, max: 10 },
  empathyStatement: { type: Number, min: 1, max: 10 },
  ownershipTaken: { type: Number, min: 1, max: 10 },
  reassuranceProvided: { type: Number, min: 1, max: 10 },
  properFormatting: { type: Number, min: 1, max: 10 },
  readableStructure: { type: Number, min: 1, max: 10 },
  noOverFormatting: { type: Number, min: 1, max: 10 },
  dataPrivacy: { type: Number, min: 1, max: 10 },
  authenticationFollowed: { type: Number, min: 1, max: 10 },
  policyAdherence: { type: Number, min: 1, max: 10 },

  criticalErrors: { type: criticalErrorSchema, default: () => ({}) },
  hasCriticalError: { type: Boolean, default: false },

  remarks: { type: String, default: '' },
  coachingArea: { type: String, default: '' },

  totalScore: { type: Number, default: 0 },
  performanceCategory: { type: String, enum: ['Excellent', 'Good', 'Needs Improvement', 'Fail'], default: 'Fail' },
}, { timestamps: true });

function computeTotalScore(doc) {
  let total = 0;
  Object.entries(METRIC_WEIGHTS).forEach(([key, weight]) => {
    const raw = Number(doc[key] ?? 0);
    const clamped = Math.max(1, Math.min(10, raw));
    const ratio = clamped / 10;
    total += ratio * weight;
  });
  return Number(total.toFixed(2));
}

function deriveCategory(total, hasCriticalError) {
  // Always derive category based on score, regardless of critical error
  // Critical error status is tracked separately in hasCriticalError field
  if (total >= 95) return 'Excellent';
  if (total >= 85) return 'Good';
  if (total >= 75) return 'Needs Improvement';
  return 'Fail';
}

// Normalize scores and compute totals before save
['validate', 'save'].forEach((hook) => {
  ticketEvaluationSchema.pre(hook, function(next) {
    // Normalize missing scores to minimum (1) to avoid NaN in aggregation
    Object.keys(METRIC_WEIGHTS).forEach((k) => {
      if (!this[k]) this[k] = 1;
      const num = Number(this[k]);
      this[k] = Math.max(1, Math.min(10, Number.isFinite(num) ? num : 1));
    });

    this.hasCriticalError = Object.values(this.criticalErrors || {}).some(Boolean);
    this.totalScore = computeTotalScore(this);
    this.performanceCategory = deriveCategory(this.totalScore, this.hasCriticalError);
    next();
  });
});

module.exports = mongoose.model('TicketEvaluation', ticketEvaluationSchema);
