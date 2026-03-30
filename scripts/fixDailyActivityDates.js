/**
 * Migration Script: Fix DailyActivity dates
 *
 * The old code used setHours(0,0,0,0) after moment.tz().startOf('day').toDate(),
 * which corrupted IST midnight dates to server-local (UTC) midnight.
 * This caused activity dates to be off by 1 day relative to attendance dates.
 *
 * This script recalculates each DailyActivity.date from its loginTime field
 * using moment.tz(loginTime, 'Asia/Kolkata').startOf('day').toDate().
 *
 * Usage: node scripts/fixDailyActivityDates.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const DailyActivity = require('../src/models/DailyActivity');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function fixDates() {
  if (!MONGO_URI) {
    console.error('No MONGODB_URI or MONGO_URI found in environment');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const activities = await DailyActivity.find({ loginTime: { $exists: true, $ne: null } }).lean();
  console.log(`Found ${activities.length} DailyActivity records with loginTime`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const act of activities) {
    try {
      const correctDate = moment.tz(act.loginTime, 'Asia/Kolkata').startOf('day').toDate();
      const currentDate = new Date(act.date);

      // Only update if the date differs
      if (currentDate.getTime() !== correctDate.getTime()) {
        await DailyActivity.updateOne(
          { _id: act._id },
          { $set: { date: correctDate } }
        );
        updated++;
        if (updated <= 10) {
          console.log(
            `  Fixed: ${act._id} | login: ${moment(act.loginTime).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm')} IST | old date: ${moment(currentDate).utc().format('YYYY-MM-DD HH:mm')} UTC | new date: ${moment(correctDate).utc().format('YYYY-MM-DD HH:mm')} UTC`
          );
        }
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      console.error(`  Error fixing ${act._id}:`, err.message);
    }
  }

  console.log(`\nDone! Updated: ${updated}, Skipped (already correct): ${skipped}, Errors: ${errors}`);
  await mongoose.disconnect();
}

fixDates().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
