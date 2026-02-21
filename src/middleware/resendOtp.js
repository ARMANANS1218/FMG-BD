const otpGenerator = require('otp-generator');
const transporter = require('../../CONFIG/emailConfig');

const resendOTP = async (email) => {
    // Generate a new OTP
    const newOTP = otpGenerator.generate(5, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false, });
    await user.updateOne({ email }, { otp: newOTP });
    // Send the OTP via email
    await transporter.sendEmail(email, 'Your new OTP', `Your new OTP is ${newOTP}`);

    return { message: 'OTP has been resent successfully' };
};

module.exports = resendOTP;