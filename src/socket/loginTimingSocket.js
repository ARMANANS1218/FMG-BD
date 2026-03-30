// Backend socket handler for Login Timing enforcement
// Emits force_logout event to users when login window ends

const LoginTiming = require('../models/LoginTiming');
const Staff = require('../models/Staff');

const normalizeCustomRole = (value = '') => {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'assosiate') return 'associate';
  if (normalized === 'aggerator') return 'aggregator';
  return normalized;
};

const customRoleMap = {
  center: 'Center',
  associate: 'Associate',
  aggregator: 'Aggregator',
  client: 'Client',
};

const isRestrictedForUser = (restrictedRoles = [], user = {}) => {
  const mappedCustomRole = customRoleMap[normalizeCustomRole(user.customRole || '')] || null;
  const roleCandidates = [user.role, mappedCustomRole].filter(Boolean);
  const hasManagementUmbrella = restrictedRoles.includes('Management') && user.role === 'Management';
  return roleCandidates.some((r) => restrictedRoles.includes(r)) || hasManagementUmbrella;
};

const getIstNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

const getIstDateKey = () =>
  new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });

// Track which users have been notified of logout for today
const logoutNotifiedUsers = new Set();

/**
 * Initialize login timing auto-logout scheduler
 * Checks every minute if it's time to logout users based on their organization's login timings
 */
const initLoginTimingAutoLogout = (io) => {
  const runCheck = async () => {
    try {
      const istTime = getIstNow();
      const currentHour = istTime.getHours();
      const currentMinute = istTime.getMinutes();
      const currentTotalMinutes = currentHour * 60 + currentMinute;

      // Get all active login timings
      const loginTimings = await LoginTiming.find({ isActive: true });

      for (const timing of loginTimings) {
        const [endH, endM] = timing.endTime.split(':').map(Number);
        const endTotalMinutes = endH * 60 + endM;

        // Force logout at or after end time (more reliable than exact-minute equality)
        if (currentTotalMinutes >= endTotalMinutes) {
          // Find active users in this organization and filter by effective restricted role
          const orgUsers = await Staff.find({
            organizationId: timing.organizationId,
            is_active: true,
          });

          const affectedUsers = orgUsers.filter((u) => isRestrictedForUser(timing.restrictedRoles, u));

          // Emit logout event to each user
          for (const user of affectedUsers) {
            const userId = user._id.toString();
            
            // Avoid duplicate notifications for the same day
            const todayKey = `${timing.organizationId}-${userId}-${getIstDateKey()}`;
            if (!logoutNotifiedUsers.has(todayKey)) {
              logoutNotifiedUsers.add(todayKey);

              // Emit to user's socket rooms
              io.to(`user-${userId}`).emit('force_logout_at_end_time', {
                reason: 'login_window_ended',
                endTime: timing.endTime,
                message: `CRM login window closed at ${timing.endTime} IST. Please login again during business hours.`,
              });

              console.log(`📤 Logout event sent to user ${userId} in org ${timing.organizationId}`);
            }
          }
        }
      }

      // Clear notifications at midnight (for next day)
      if (currentTotalMinutes === 0) {
        logoutNotifiedUsers.clear();
      }
    } catch (error) {
      console.error('❌ Error in login timing auto-logout scheduler:', error);
    }
  };

  // Run immediately once, then every minute
  runCheck();
  setInterval(runCheck, 60 * 1000);

  console.log('✅ Login Timing Auto-Logout scheduler initialized');
};

/**
 * Alternative implementation using socket middleware
 * This sends logout signal when a user connects or every interval
 */
const setupLoginTimingSocketHandler = (io) => {
  io.of('/').on('connection', (socket) => {
    const userId = socket.handshake.auth?.userId || socket.userId?.toString?.();

    if (!userId) return;

    // Join user-specific room for targeted events
    socket.join(`user-${userId}`);

    // Optional: Check if user should be logged out on connection
    socket.on('check-login-status', async (data, callback) => {
      try {
        const user = await Staff.findById(userId).select('organizationId role customRole');
        if (!user) {
          callback({ shouldLogout: true, reason: 'user_not_found' });
          return;
        }

        const loginTiming = await LoginTiming.findOne({
          organizationId: user.organizationId,
          isActive: true,
        });

        if (!loginTiming) {
          callback({ shouldLogout: false });
          return;
        }

        const istTime = getIstNow();
        const currentHour = istTime.getHours();
        const currentMinute = istTime.getMinutes();
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        const [endH, endM] = loginTiming.endTime.split(':').map(Number);
        const endTotalMinutes = endH * 60 + endM;

        // Check if user's effective role is restricted and if current time is past end time
        const isRestricted = isRestrictedForUser(loginTiming.restrictedRoles, user);
        const isPastEndTime = currentTotalMinutes > endTotalMinutes;

        if (isRestricted && isPastEndTime) {
          callback({
            shouldLogout: true,
            reason: 'login_window_expired',
            endTime: loginTiming.endTime,
          });
        } else {
          callback({ shouldLogout: false });
        }
      } catch (error) {
        console.error('Error checking login status:', error);
        callback({ shouldLogout: false, error: error.message });
      }
    });
  });
};

module.exports = {
  initLoginTimingAutoLogout,
  setupLoginTimingSocketHandler,
};
