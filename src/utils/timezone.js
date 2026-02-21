const moment = require('moment-timezone');

// Return a real Date object in IST (UTC+5:30) by constructing from UTC offset.
// Storing formatted string breaks Date semantics; schemas expecting Date should use a Date instance.
const getIndiaTime = () => {
  // moment().tz returns a moment with correct offset; convert to native Date
  return moment().tz("Asia/Kolkata").toDate();
};

module.exports = getIndiaTime;