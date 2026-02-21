const jwt = require('jsonwebtoken');

exports.validateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // ✅ Attach decoded user to request
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
  if (req.user?.role === 'Admin' || req.user?.role === 'TL' || req.user?.role === 'Management') {
    return next();
  }
  return res
    .status(403)
    .json({ status: false, message: 'Access denied: Admin, TL or Management only' });
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
