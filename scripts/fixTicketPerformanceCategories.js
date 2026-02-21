const mongoose = require('mongoose');
require('dotenv').config();

const TicketEvaluation = require('../src/models/TicketEvaluation');

function deriveCategory(total) {
  if (total >= 95) return 'Excellent';
  if (total >= 85) return 'Good';
  if (total >= 75) return 'Needs Improvement';
  return 'Fail';
}

async function fixPerformanceCategories() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const evaluations = await TicketEvaluation.find({});
    console.log(`Found ${evaluations.length} ticket evaluations`);

    let updated = 0;
    for (const evaluation of evaluations) {
      const correctCategory = deriveCategory(evaluation.totalScore);
      if (evaluation.performanceCategory !== correctCategory) {
        console.log(`Fixing ${evaluation.ticketId}: ${evaluation.totalScore}% -> ${correctCategory} (was ${evaluation.performanceCategory})`);
        evaluation.performanceCategory = correctCategory;
        await evaluation.save();
        updated++;
      }
    }

    console.log(`\nUpdated ${updated} records`);
    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixPerformanceCategories();
