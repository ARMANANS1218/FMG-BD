const mongoose = require('mongoose');

// Weight map (percentage-based as per client requirements)
// Chat Handling: 55%, Soft Skills: 20%, System & Compliance: 15%, Documentation: 10%
// TOTAL: 100%
const WEIGHTS = {
  // Chat Handling Parameters (55%)
  greeting: 5,              // Greeting & Introduction
  probing: 10,              // Probing & Understanding Issue
  accuracy: 15,             // Accuracy of Information Provided
  resolution: 10,           // Resolution / FCR
  processAdherence: 10,     // Adherence to Process/CRM Updates
  compliance: 5,            // Compliance / Policy Adherence (reduced from 10% to fit 55% total)
  closure: 0,               // Closure & Summary (removed to fit 55% total)
  
  // Soft Skills / Communication (20%)
  grammar: 5,               // Grammar, Spelling, and Sentence Formation
  tone: 5,                  // Tone & Empathy
  personalization: 5,       // Personalization & Human Touch
  flow: 5,                  // Chat Flow & Response Time
  
  // System & Process Compliance (15%)
  toolEfficiency: 7.5,      // Tool Navigation Efficiency
  escalation: 7.5,          // Transfer / Escalation Handling
  
  // Documentation (10%)
  documentation: 10,        // Overall documentation quality
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
  // Chat Handling Parameters
  greeting: metricSchema,
  probing: metricSchema,
  accuracy: metricSchema,
  resolution: metricSchema,
  processAdherence: metricSchema,
  compliance: metricSchema,
  closure: metricSchema,
  // Soft Skills / Communication
  grammar: metricSchema,
  tone: metricSchema,
  personalization: metricSchema,
  flow: metricSchema,
  // System & Process Compliance
  toolEfficiency: metricSchema,
  tagging: metricSchema,
  escalation: metricSchema,
  // Documentation
  documentation: metricSchema,

  totalWeightedScore: { type: Number, default: 0 }, // 0-100
  performanceCategory: { type: String, enum: ['Very Poor', 'Poor', 'Average', 'Good', 'Excellent'], default: 'Very Poor' },
  result: { type: String, enum: ['Pass', 'Fail'], default: 'Fail' }, // Kept for backward compatibility
  passThreshold: { type: Number, default: 80 },

  remarks: { type: String, default: '' },
  coachingArea: { type: String, default: '' },
  csat: { type: Number, min: 0, max: 100 },
}, { timestamps: true });

// Pre-save compute total weighted score (percentage-based)
queryEvaluationSchema.pre('save', function(next) {
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