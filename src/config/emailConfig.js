const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || process.env.SMTP_HOST,
  port: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '465'),
  secure: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '465') === 465,
  auth: {
    user: process.env.EMAIL_USER || process.env.SMTP_USERNAME,
    pass: process.env.EMAIL_PASS || process.env.SMTP_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false, // Allow self-signed certificates
  },
  authMethod: 'LOGIN', // Try LOGIN instead of PLAIN
  logger: true, // Enable logging
  debug: process.env.NODE_ENV === 'development', // Enable debug in development
});

// Verification disabled to prevent startup connection errors on localhost (port 587)
// If needed, re-enable conditionally:
// if (process.env.ENABLE_SMTP_VERIFY === 'true') {
//   transporter.verify((error) => {
//     if (error) console.error('[SMTP] Verify error:', error.message);
//     else console.log('[SMTP] Transporter verified');
//   });
// }

module.exports = transporter;

console.log('📧 Email Config Loaded:', {
  host: process.env.EMAIL_HOST || process.env.SMTP_HOST,
  port: process.env.EMAIL_PORT || process.env.SMTP_PORT,
  secure: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '465') === 465,
  user: process.env.EMAIL_USER || process.env.SMTP_USERNAME,
  authMethod: 'LOGIN',
  passLength: (process.env.EMAIL_PASS || process.env.SMTP_PASSWORD || '').length,
});
