const express = require('express');
const upload = require('../utils/uploadProfile');
const {
  register,
  deleteAccount,
  changePasswordByOtp,
  getProfile,
  updateProfile,
  otpResetPassword,
  toggleBreak,
  resetWorkStatus,
  loginUser,
  logoutUser,
  getAllAgents,
  getAllCustomer,
  getAllEmployees,
  updateEmployeeStatus,
  unblockLoginAccount,
  updateUserAuthorizedIP,
  updateEmployeeByAdmin,
  acceptTerms,
  getEscalationHierarchy,
  resetEmployeePassword,
  getAssignableAgents,
  get30DayActivity,
  getCurrentActiveTime,
  getOrganizationInfo,
  getActivityReport,
} = require('../controllers/user.controller');
const { validateToken, isAdmin, isAdminOrTL } = require('../utils/validateToken');

const router = express.Router();

// Create a new user (Admin creates employees)
router.post('/sign-up', upload.single('profileImage'), validateToken, isAdmin, register);
// Login user
router.post('/login', loginUser);
// Logout user
router.post('/logout', validateToken, logoutUser);
// User break
router.put('/break', validateToken, toggleBreak);
// Reset work status to active (fixes stuck break/offline status)
router.put('/reset-status', validateToken, resetWorkStatus);

// Get organization info for authenticated user
router.get('/organization-info', validateToken, getOrganizationInfo);
// Get user active time
router.get('/active-time', validateToken, getCurrentActiveTime);
// Get 30-day activity history for a user
router.get('/activity/30-days/:userId', validateToken, get30DayActivity);
// Get activity report for all agents (daily/weekly/monthly)
router.get('/activity/report', validateToken, isAdminOrTL, getActivityReport);

// Check-in / Check-out (Removed - Login based)
// router.post("/check-in", validateToken, checkIn);
// router.post("/check-out", validateToken, checkOut);

// Get all agents (MUST BE AFTER SPECIFIC ROUTES)
router.get('/', getAllAgents);
// Get all employees (Admin, Agent, QA, TL) - Admin and TL can access
router.get('/employees', validateToken, isAdminOrTL, getAllEmployees);
// Get assignable agents for ticket assignment/escalation - All authenticated users
router.get('/assignable-agents', validateToken, getAssignableAgents);
// Escalation hierarchy: tier -> department -> users (Agent/QA/TL)
router.get('/escalation/hierarchy', validateToken, getEscalationHierarchy);
// Update employee status
router.put('/status/:id', validateToken, isAdmin, updateEmployeeStatus);
// Unblock login account (failed password attempts)
router.put('/unblock-login/:id', validateToken, isAdmin, unblockLoginAccount);
// Update user authorized IP address
router.put('/update-authorized-ip', validateToken, isAdmin, updateUserAuthorizedIP);
// Reset employee password by admin
router.put('/reset-password/:id', validateToken, isAdmin, resetEmployeePassword);
// Update employee by admin
router.put(
  '/profile/:id',
  upload.single('profileImage'),
  validateToken,
  isAdmin,
  updateEmployeeByAdmin
);
// Get all customer
router.get('/customers', getAllCustomer);
// View profile by token
router.get('/profile', validateToken, getProfile);
// Update profile by token
router.put('/profile-update', upload.single('profileImage'), validateToken, updateProfile);
// Delete account by token
router.delete('/account/:id', validateToken, deleteAccount);
// Send otp reset password
router.post('/reset-otp-pass', otpResetPassword);
// Change password by token
router.post('/change-otp-pass/verify', changePasswordByOtp);

// Accept Terms & Conditions (protected)
router.post('/accept-terms', validateToken, acceptTerms);

module.exports = router;
