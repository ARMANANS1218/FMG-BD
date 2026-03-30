const otpGenerator = require('otp-generator');
const transporter = require('../config/emailConfig');
const user = require('../models/Staff');

const resendOTP = async (email) => {
    // Generate a new OTP
    const newOTP = otpGenerator.generate(5, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false, });
    await user.updateOne({ email: email.toLowerCase() }, { otp: newOTP });
    
    const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME || 'Support'}" <${process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || process.env.SMTP_USERNAME}>`,
        to: email,
        subject: 'Your new OTP',
        text: `Your new OTP is ${newOTP}`
    };
    await transporter.sendMail(mailOptions);

    return { message: 'OTP has been resent successfully' };
};

module.exports = resendOTP;
