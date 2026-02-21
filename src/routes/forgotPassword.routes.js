const express = require('express');
const { sendForgotPasswordOTP, resetPasswordWithOTP } = require('../controllers/forgotPassword.controller');

const router = express.Router();

// Send OTP to email for password reset
router.post('/send-otp', sendForgotPasswordOTP);

// Verify OTP and reset password
router.post('/reset-password', resetPasswordWithOTP);

module.exports = router;
