const mongoose = require('mongoose');

// 2. QC PARAMETERS – AGENT (QUALITY MONITORING - CHAT)
// Scorecard (100 Marks)
const WEIGHTS = {
  // Compliance (20%)
  gdprStatementUsed: 5,     // GDPR statement used correctly
  noDataLeakage: 5,         // No data leakage
  properVerification: 5,    // Proper verification
  refundAuthCheck: 5,       // Correct refund authorization

  // Communication Skills (20%)
  professionalTone: 5,      // Professional tone
  ukGrammarSpelling: 5,     // UK grammar & spelling
  empathyStatement: 5,      // Empathy statement used
  resolutionExplanation: 5, // Clear resolution explanation

  // Product & Process Knowledge (15%)
  correctClassification: 4, // Correct classification
  correctCompensation: 4,   // Correct compensation applied
  properBatchCapture: 4,    // Proper batch capture
  accurateTagging: 3,       // Accurate tagging

  // SLA & Efficiency (15%)
  frtWithinSla: 4,          // First Response Time within SLA
  ahtWithinBenchmark: 4,    // AHT within benchmark
  noUnnecessaryHolds: 4,    // No unnecessary holds
  properCaseClosure: 3,     // Proper case closure

  // Resolution Quality (20%)
  rootCauseTagging: 5,      // Correct root cause tagging
  completeDocumentation: 5, // Complete documentation
  noRepeatContact: 5,       // No repeat contact
  csatImpact: 5,            // CSAT impact

  // Soft Skills (10%)
  empathy: 2.5,             // Empathy
  ownership: 2.5,           // Ownership
  reassurance: 2.5,         // Reassurance
  deEscalation: 2.5,        // De-escalation
};

const metricSchema = new mongoose.Schema({
  // Accept raw input scale 1-10 (preferred) or legacy 0-100 (%). We'll normalize in pre-save.
  score: { type: Number, min: 0, max: 100, default: 0 },
});

const queryEvaluationSchema = new mongoose.Schema({
  queryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Query', required: true },
  petitionId: { type: String },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  agentName: String,
  evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  evaluatorRole: { type: String }, // QA or TL
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },

  // Metrics (percentage-based 0-100%)
  // Compliance
  gdprStatementUsed: metricSchema,
  noDataLeakage: metricSchema,
  properVerification: metricSchema,
  refundAuthCheck: metricSchema,
  // Communication
  professionalTone: metricSchema,
  ukGrammarSpelling: metricSchema,
  empathyStatement: metricSchema,
  resolutionExplanation: metricSchema,
  // Knowledge
  correctClassification: metricSchema,
  correctCompensation: metricSchema,
  properBatchCapture: metricSchema,
  accurateTagging: metricSchema,
  // SLA
  frtWithinSla: metricSchema,
  ahtWithinBenchmark: metricSchema,
  noUnnecessaryHolds: metricSchema,
  properCaseClosure: metricSchema,
  // Resolution
  rootCauseTagging: metricSchema,
  completeDocumentation: metricSchema,
  noRepeatContact: metricSchema,
  csatImpact: metricSchema,
  // Soft Skills
  empathy: metricSchema,
  ownership: metricSchema,
  reassurance: metricSchema,
  deEscalation: metricSchema,

  totalWeightedScore: { type: Number, default: 0 }, // 0-100
  performanceCategory: { type: String, enum: ['Very Poor', 'Poor', 'Average', 'Good', 'Excellent'], default: 'Very Poor' },
  result: { type: String, enum: ['Pass', 'Fail'], default: 'Fail' }, // Kept for backward compatibility
  passThreshold: { type: Number, default: 80 },

  remarks: { type: String, default: '' },
  coachingArea: { type: String, default: '' },
  csat: { type: Number, min: 0, max: 100 },
}, { timestamps: true });

// Pre-save compute total weighted score (percentage-based)
queryEvaluationSchema.pre('save', function (next) {
  let total = 0;

  Object.entries(WEIGHTS).forEach(([key, weight]) => {
    const raw = this[key]?.score ?? 0;
    // Support both 1-10 scale and legacy 0-100%.
    // Heuristic: if value <= 10, treat as 1-10 scale and convert to percentage.
    let percent;
    if (raw <= 10) {
      // Convert 1-10 -> 10%-100% (allow 0 as legacy edge-case)
      const clamped = Math.max(0, Math.min(10, raw));
      percent = (clamped / 10) * 100;
    } else {
      percent = Math.min(100, Math.max(0, raw));
    }
    // Apply weight (weight is already in percentage form, total will be out of 100)
    total += (percent / 100) * weight;
    // Store normalized percentage for persistence and reporting
    this[key].score = percent;
  });

  this.totalWeightedScore = Number(total.toFixed(2));

  // Determine performance category based on score
  if (this.totalWeightedScore >= 81) {
    this.performanceCategory = 'Excellent';
  } else if (this.totalWeightedScore >= 61) {
    this.performanceCategory = 'Good';
  } else if (this.totalWeightedScore >= 41) {
    this.performanceCategory = 'Average';
  } else if (this.totalWeightedScore >= 21) {
    this.performanceCategory = 'Poor';
  } else {
    this.performanceCategory = 'Very Poor';
  }

  // Keep Pass/Fail for backward compatibility
  this.result = this.totalWeightedScore >= (this.passThreshold || 80) ? 'Pass' : 'Fail';
  next();
});

module.exports = mongoose.model('QueryEvaluation', queryEvaluationSchema);