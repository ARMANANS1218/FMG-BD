const User = require('../models/User');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../config/emailConfig');
const { encryptPassword } = require('../utils/encryption');

/**
 * FORGOT PASSWORD CONTROLLER
 * Handles OTP-based password reset for all user roles
 */

// In-memory OTP storage (consider Redis for production)
const otpStore = new Map();

// OTP expiry time (10 minutes)
const OTP_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Generate 6-digit OTP
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP to user's email
 * POST /api/auth/forgot-password
 * Body: { email }
 */
exports.sendForgotPasswordOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: false,
        message: 'Email is required',
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      // For security, don't reveal if email exists
      return res.status(200).json({
        status: true,
        message: 'If the email exists, an OTP has been sent to reset your password',
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    // Store OTP with email as key
    otpStore.set(email.toLowerCase().trim(), {
      otp,
      expiresAt,
      userId: user._id.toString(),
    });

    // Send OTP via email
    try {
      console.log('📧 Attempting to send OTP email to:', email);
      console.log('📧 Email config:', {
        host: process.env.EMAIL_HOST || process.env.SMTP_HOST,
        port: process.env.EMAIL_PORT || process.env.SMTP_PORT,
        user: process.env.EMAIL_USER || process.env.SMTP_USERNAME,
        from: `"${process.env.SMTP_FROM_NAME || 'Kalinga Support'}" <${
          process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || process.env.SMTP_USERNAME
        }>`,
      });

      await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Kalinga Support'}" <${
          process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || process.env.SMTP_USERNAME
        }>`,
        to: email,
        subject: 'Password Reset OTP - Chat CRM',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .otp-box { background: white; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
              .otp-code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px; }
              .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Password Reset Request</h1>
              </div>
              <div class="content">
                <p>Hi <strong>${user.name}</strong>,</p>
                <p>We received a request to reset your password for your <strong>${
                  user.role
                }</strong> account.</p>
                
                <div class="otp-box">
                  <p style="margin: 0; font-size: 14px; color: #666;">Your OTP Code:</p>
                  <p class="otp-code">${otp}</p>
                  <p style="margin: 0; font-size: 12px; color: #999;">Valid for 10 minutes</p>
                </div>
                
                <p>Enter this OTP in the password reset page to create a new password.</p>
                
                <div class="warning">
                  <strong>⚠️ Security Notice:</strong><br>
                  • This OTP will expire in 10 minutes<br>
                  • Never share this OTP with anyone<br>
                  • If you didn't request this, please ignore this email
                </div>
                
                <p>For security reasons, this link can only be used once.</p>
                
                <div class="footer">
                  <p>This is an automated email. Please do not reply.</p>
                  <p>&copy; ${new Date().getFullYear()} ${
          process.env.COMPANY_NAME || 'Chat CRM'
        }. All rights reserved.</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      // Clean up expired OTPs periodically
      cleanupExpiredOTPs();

      console.log('✅ OTP email sent successfully to:', email);
      res.status(200).json({
        status: true,
        message: 'OTP sent successfully to your email',
      });
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);
      console.error('❌ Error details:', {
        message: emailError.message,
        code: emailError.code,
        command: emailError.command,
        response: emailError.response,
        stack: emailError.stack,
      });
      res.status(500).json({
        status: false,
        message: 'Failed to send OTP email. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? emailError.message : undefined,
        details:
          process.env.NODE_ENV === 'development'
            ? {
                code: emailError.code,
                response: emailError.response,
              }
            : undefined,
      });
    }
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({
      status: false,
      message: 'Server error. Please try again later.',
      error: error.message,
    });
  }
};

/**
 * Verify OTP and Reset Password
 * POST /api/auth/reset-password
 * Body: { email, otp, newPassword }
 */
exports.resetPasswordWithOTP = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate input
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        status: false,
        message: 'Email, OTP, and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        status: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if OTP exists
    const storedData = otpStore.get(normalizedEmail);

    if (!storedData) {
      return res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP',
      });
    }

    // Check if OTP is expired
    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({
        status: false,
        message: 'OTP has expired. Please request a new one.',
      });
    }

    // Verify OTP
    if (storedData.otp !== otp.trim()) {
      return res.status(400).json({
        status: false,
        message: 'Invalid OTP',
      });
    }

    // Find user
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      otpStore.delete(normalizedEmail);
      return res.status(404).json({
        status: false,
        message: 'User not found',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const encryptedPass = encryptPassword(newPassword); // Store encrypted version

    // Update user password
    user.password = hashedPassword;
    user.encryptedPassword = encryptedPass; // Store encrypted version for admin viewing

    // Reset account blocking if applicable
    if (user.isBlocked) {
      user.isBlocked = false;
      user.failedLoginAttempts = 0;
      user.blockedAt = null;
      user.blockedReason = null;
    }

    await user.save({ validateModifiedOnly: true });

    // Delete OTP after successful reset
    otpStore.delete(normalizedEmail);

    // Send confirmation email
    try {
      await transporter.sendMail({
        from: `"${process.env.COMPANY_NAME || 'Chat CRM'}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Changed Successfully - Chat CRM',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .success-icon { font-size: 48px; margin: 20px 0; }
              .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
              .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="success-icon">✅</div>
                <h1>Password Changed Successfully</h1>
              </div>
              <div class="content">
                <p>Hi <strong>${user.name}</strong>,</p>
                <p>Your password has been successfully changed for your <strong>${
                  user.role
                }</strong> account.</p>
                
                <p>You can now log in with your new password.</p>
                
                <div class="warning">
                  <strong>⚠️ Security Notice:</strong><br>
                  If you did not make this change, please contact your administrator immediately.
                </div>
                
                <div class="footer">
                  <p>This is an automated email. Please do not reply.</p>
                  <p>&copy; ${new Date().getFullYear()} ${
          process.env.COMPANY_NAME || 'Chat CRM'
        }. All rights reserved.</p>
                </div❌ Confirmation email failed:', emailError);
      console.error('❌ Error details:', emailError.message
              </div>
            </div>
          </body>
          </html>
        `,
      });
    } catch (emailError) {
      console.error('Confirmation email failed:', emailError);
      // Don't fail the request if confirmation email fails
    }

    res.status(200).json({
      status: true,
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({
      status: false,
      message: 'Server error. Please try again later.',
      error: error.message,
    });
  }
};

/**
 * Clean up expired OTPs from memory
 */
function cleanupExpiredOTPs() {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (now > data.expiresAt) {
      otpStore.delete(email);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredOTPs, 5 * 60 * 1000);
