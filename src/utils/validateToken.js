const jwt = require('jsonwebtoken');
const LoginTiming = require('../models/LoginTiming');

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

const isWithinWindowIST = (startTime, endTime) => {
  const [startH, startM] = String(startTime || '00:00').split(':').map(Number);
  const [endH, endM] = String(endTime || '23:59').split(':').map(Number);

  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const current = ist.getHours() * 60 + ist.getMinutes();
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  return current >= start && current <= end;
};

exports.validateToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // ✅ Attach decoded user to request

    // Enforce login timing for all APIs (except Admin and Dev)
    const userRole = decoded?.role;
    if (!['Admin', 'Dev'].includes(userRole) && decoded?.organizationId) {
      const loginTiming = await LoginTiming.findOne({
        organizationId: decoded.organizationId,
        isActive: true,
      }).lean();

      if (loginTiming) {
        const mappedCustomRole = customRoleMap[normalizeCustomRole(decoded?.customRole || '')] || null;
        const roleCandidates = [userRole, mappedCustomRole].filter(Boolean);
        const hasManagementUmbrella =
          loginTiming.restrictedRoles?.includes('Management') && userRole === 'Management';

        const isRestrictedRole =
          roleCandidates.some((roleKey) => loginTiming.restrictedRoles?.includes(roleKey)) ||
          hasManagementUmbrella;

        if (isRestrictedRole) {
          const allowedNow = isWithinWindowIST(loginTiming.startTime, loginTiming.endTime);
          if (!allowedNow) {
            return res.status(401).json({
              status: false,
              message: 'Session expired: login window has ended',
              reason: 'login_window_expired',
              loginTimings: {
                startTime: loginTiming.startTime,
                endTime: loginTiming.endTime,
              },
            });
          }
        }
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

exports.isAdmin = (req, res, next) => {
  if (req.user?.role === 'Admin') return next();
  return res.status(403).json({ status: false, message: 'Admin access: Admins only' });
};

exports.isAdminOrTL = (req, res, next) => {
  if (req.user?.role === 'Admin' || req.user?.role === 'TL') return next();
  return res.status(403).json({ status: false, message: 'Access denied: Admin or TL only' });
};

exports.isAgent = (req, res, next) => {
  if (req.user?.role === 'Agent') return next();
  return res.status(403).json({ status: false, message: 'Agent access: Agents only' });
};

exports.isAgentOrTL = (req, res, next) => {
  if (req.user?.role === 'Agent' || req.user?.role === 'TL') return next();
  return res.status(403).json({ status: false, message: 'Access denied: Agent or TL only' });
};

exports.isQA = (req, res, next) => {
  if (req.user.role !== 'QA') {
    return res.status(403).json({ message: 'Access denied: QA only' });
  }
  next();
};

exports.isQAandAgent = (req, res, next) => {
  const user = req?.user;
  if (user?.role === 'QA' || user?.roles?.includes('QA')) {
    if (user?.role === 'Agent' || user?.roles?.includes('Agent')) {
      return next();
    }
  }
  return res
    .status(403)
    .json({ success: false, message: 'Access denied: QA and Agent roles required' });
};

// Management role middleware (read-only monitoring)
exports.isManagement = (req, res, next) => {
  if (req.user?.role === 'Management') return next();
  return res.status(403).json({
    status: false,
    message: 'Access denied: Management only',
  });
};

// Allows Admin, TL, or Management (for read-only views)
exports.isAdminTLOrManagement = (req, res, next) => {
  const allowedRoles = ['Admin', 'TL', 'Management', 'Dev'];
  if (allowedRoles.includes(req.user?.role)) return next();
  return res.status(403).json({
    status: false,
    message: 'Access denied: Admin, TL, Management, or Dev only',
  });
};

// Dev role middleware
exports.isDev = (req, res, next) => {
  if (req.user?.role === 'Dev') return next();
  return res.status(403).json({ status: false, message: 'Access denied: Dev only' });
};
