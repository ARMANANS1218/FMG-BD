/**
 * MULTI-TENANT AUTHENTICATION & AUTHORIZATION MIDDLEWARE
 * 
 * Identifies tenant (organization) from:
 * 1. Subdomain (xyz.chatcrm.com)
 * 2. API Key (for widget integration)
 * 3. JWT Token (for logged-in users)
 */

const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');
const User = require('../models/User');

/**
 * Identify tenant/organization from request
 */
const identifyTenant = async (req, res, next) => {
  try {
    let organizationId = null;
    let identificationMethod = null;
    
    // ==================== METHOD 1: FROM SUBDOMAIN ====================
    const host = req.headers.host || req.hostname;
    const subdomain = host?.split('.')[0];
    
    if (subdomain && subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'localhost') {
      const org = await Organization.findOne({ 
        subdomain,
        isActive: true 
      });
      
      if (org) {
        organizationId = org._id;
        identificationMethod = 'subdomain';
      }
    }
    
    // ==================== METHOD 2: FROM API KEY (for widget) ====================
    if (!organizationId) {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      
      if (apiKey) {
        const org = await Organization.findOne({
          'apiKeys.key': apiKey,
          'apiKeys.isActive': true,
          isActive: true
        });
        
        if (org) {
          organizationId = org._id;
          identificationMethod = 'apiKey';
          
          // Update API key usage
          await Organization.updateOne(
            { _id: org._id, 'apiKeys.key': apiKey },
            {
              $set: { 'apiKeys.$.lastUsed': new Date() },
              $inc: { 'apiKeys.$.usageCount': 1 }
            }
          );
        }
      }
    }
    
    // ==================== METHOD 3: FROM JWT TOKEN ====================
    if (!organizationId) {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        
        try {
          const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET);
          
          // SuperAdmin doesn't have organizationId
          if (decoded.role === 'SuperAdmin') {
            req.user = decoded;
            req.isSuperAdmin = true;
            return next(); // SuperAdmin bypasses tenant check
          }
          
          organizationId = decoded.organizationId;
          identificationMethod = 'jwt';
          req.user = decoded;
        } catch (err) {
          return res.status(401).json({
            status: false,
            message: 'Invalid or expired token'
          });
        }
      }
    }
    
    // ==================== VALIDATION ====================
    if (!organizationId) {
      return res.status(403).json({
        status: false,
        message: 'Organization could not be identified',
        hint: 'Provide subdomain, API key, or valid JWT token'
      });
    }
    
    // Attach to request
    req.organizationId = organizationId;
    req.tenantIdentificationMethod = identificationMethod;
    
    next();
  } catch (error) {
    console.error('Tenant Identification Error:', error);
    res.status(500).json({
      status: false,
      message: 'Error identifying tenant',
      error: error.message
    });
  }
};

/**
 * Authenticate JWT token
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: false,
        message: 'Authorization token required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET);
    
    // Fetch full user details
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        status: false,
        message: 'User not found'
      });
    }
    
    // SuperAdmin bypasses organization checks
    if (user.role === 'SuperAdmin') {
      req.user = {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
      req.isSuperAdmin = true;
      return next();
    }
    
    // Check if user belongs to the identified organization
    if (req.organizationId) {
      if (!user.organizationId || user.organizationId.toString() !== req.organizationId.toString()) {
        return res.status(403).json({
          status: false,
          message: 'User does not belong to this organization'
        });
      }
    }
    
    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: false,
        message: 'Token expired'
      });
    }
    
    console.error('Authentication Error:', error);
    res.status(500).json({
      status: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Authorize based on roles
 * @param  {...string} allowedRoles - Roles that can access the route
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role;
    
    if (!userRole) {
      return res.status(401).json({
        status: false,
        message: 'User not authenticated'
      });
    }
    
    // SuperAdmin can access everything
    if (userRole === 'SuperAdmin') {
      return next();
    }
    
    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Insufficient permissions',
        requiredRoles: allowedRoles,
        yourRole: userRole
      });
    }
    
    // Check tenant isolation (users can only access their org's data)
    if (req.organizationId && req.user.organizationId) {
      if (req.user.organizationId.toString() !== req.organizationId.toString()) {
        return res.status(403).json({
          status: false,
          message: 'Access denied - Different organization'
        });
      }
    }
    
    next();
  };
};

/**
 * SuperAdmin only access
 */
const superAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'SuperAdmin') {
    return res.status(403).json({
      status: false,
      message: 'SuperAdmin access required'
    });
  }
  next();
};

/**
 * Optional authentication (doesn't fail if no token)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET);
      
      const user = await User.findById(decoded.id).select('-password');
      
      if (user) {
        req.user = {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId
        };
      }
    }
    
    next();
  } catch (error) {
    // Don't fail, just continue without user
    next();
  }
};

module.exports = {
  identifyTenant,
  authenticateToken,
  authorize,
  superAdminOnly,
  optionalAuth
};
