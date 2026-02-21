const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  type: {
    type: String,
    enum: ['common', 'faq'],
    required: true
  },
  // For common replies (type: 'common')
  text: {
    type: String,
    required: function() {
      return this.type === 'common';
    }
  },
  // For FAQs (type: 'faq')
  question: {
    type: String,
    required: function() {
      return this.type === 'faq';
    }
  },
  answer: {
    type: String,
    required: function() {
      return this.type === 'faq';
    }
  },
  // Category for organizing FAQs and Common Replies
  category: {
    type: String,
    default: 'General',
    trim: true
  },
  // Tags for better searchability (multiple tags allowed)
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdByName: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for faster queries
faqSchema.index({ organizationId: 1, type: 1, isActive: 1 });
faqSchema.index({ organizationId: 1, category: 1 });
faqSchema.index({ organizationId: 1, tags: 1 });

module.exports = mongoose.model('Faq', faqSchema);
