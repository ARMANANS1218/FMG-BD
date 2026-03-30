const nodemailer = require("nodemailer");
require("dotenv").config();

// OLD Gmail transporter - COMMENTED OUT (replaced by brevoEmailService)
// const transporter = nodemailer.createTransport({
//   service: "Gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// Stub function (replaced by brevoEmailService in email.controller.js)
exports.sendEmail = async (to, subject, html) => {
  console.warn('⚠️ emailService.sendEmail deprecated - use brevoEmailService or email-ticketing module instead');
  // No-op to prevent errors
};

exports.sendEmail = async (to, subject, html) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  });
};
