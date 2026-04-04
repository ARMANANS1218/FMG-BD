const LoginTiming = require('../models/LoginTiming');
const Staff = require('../models/Staff');
const Organization = require('../models/Organization');
const mongoose = require('mongoose');

const resolveOrganizationObjectId = async (rawOrganizationId) => {
  const value = Array.isArray(rawOrganizationId)
    ? rawOrganizationId[0]
    : rawOrganizationId;

  const normalized = typeof value === 'string' ? value.trim() : value;
  if (!normalized) return null;

  // Already a MongoDB ObjectId
  if (mongoose.isValidObjectId(normalized)) {
    return normalized;
  }

  // Support business org IDs like ORG-001
  const org = await Organization.findOne({ organizationId: normalized })
    .select('_id')
    .lean();

  return org?._id ? org._id.toString() : null;
};

// GET login timings for organization
exports.getLoginTimings = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID is required',
      });
    }

    let loginTiming = await LoginTiming.findOne({ organizationId });

    // If no timing exists, create default one
    if (!loginTiming) {
      loginTiming = await LoginTiming.create({
        organizationId,
        startTime: '09:00',
        endTime: '18:00',
        restrictedRoles: ['Agent', 'QA', 'TL', 'Management', 'Center', 'Associate', 'Aggregator', 'Client'],
        isActive: false, // Disabled by default
        createdBy: req.user?.id,
      });
    }

    res.status(200).json({
      status: true,
      message: 'Login timings retrieved successfully',
      data: loginTiming,
    });
  } catch (error) {
    console.error('Get Login Timings Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to retrieve login timings',
      error: error.message,
    });
  }
};

// UPDATE login timings for organization
exports.updateLoginTimings = async (req, res) => {
  try {
    const { startTime, endTime, restrictedRoles, isActive, description } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    // Validate organization
    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID is required',
      });
    }

    // Validate required fields
    if (!startTime || !endTime) {
      return res.status(400).json({
        status: false,
        message: 'Start time and end time are required',
      });
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({
        status: false,
        message: 'Time must be in HH:MM format (24-hour)',
      });
    }

    // Validate roles
    const validRoles = [
      'Agent',
      'QA',
      'TL',
      'Management',
      'Center',
      'Associate',
      'Aggregator',
      'Client',
      'Dev',
    ];
    const rolesToApply = Array.isArray(restrictedRoles)
      ? restrictedRoles.filter((role) => validRoles.includes(role))
      : ['Agent', 'QA', 'TL', 'Management', 'Center', 'Associate', 'Aggregator', 'Client'];

    // Dev should not be included by default (user's preference)
    if (rolesToApply.includes('Dev')) {
      console.warn('⚠️ Warning: Dev role included in login timing restrictions');
    }

    let loginTiming = await LoginTiming.findOne({ organizationId });

    if (loginTiming) {
      // Update existing
      loginTiming.startTime = startTime;
      loginTiming.endTime = endTime;
      loginTiming.restrictedRoles = rolesToApply;
      loginTiming.isActive = isActive !== undefined ? isActive : loginTiming.isActive;
      loginTiming.description = description || loginTiming.description;
      loginTiming.updatedBy = userId;
      loginTiming.updatedAt = new Date();

      await loginTiming.save();
    } else {
      // Create new
      loginTiming = await LoginTiming.create({
        organizationId,
        startTime,
        endTime,
        restrictedRoles: rolesToApply,
        isActive: isActive !== undefined ? isActive : true,
        description: description || 'CRM Login Hours',
        createdBy: userId,
        updatedBy: userId,
      });
    }

    console.log('✅ Login timings updated:', {
      organizationId,
      startTime,
      endTime,
      restrictedRoles: rolesToApply,
      isActive: loginTiming.isActive,
    });

    res.status(200).json({
      status: true,
      message: 'Login timings updated successfully',
      data: loginTiming,
    });
  } catch (error) {
    console.error('Update Login Timings Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update login timings',
      error: error.message,
    });
  }
};

// GET login timing status (for login page)
exports.getLoginTimingStatus = async (req, res) => {
  try {
    const requestedOrganizationId =
      req.query?.organizationId ||
      req.headers?.['x-organization-id'] ||
      req.headers?.['X-Organization-Id'];

    let organizationId = await resolveOrganizationObjectId(requestedOrganizationId);

    // Fallback for single-tenant login pages where org id isn't explicitly passed
    if (!organizationId) {
      const fallbackTiming = await LoginTiming.findOne({})
        .sort({ updatedAt: -1 })
        .select('organizationId')
        .lean();

      if (fallbackTiming?.organizationId) {
        organizationId = fallbackTiming.organizationId.toString();
      }
    }

    // Secondary fallback via Organization collection (oldest created org)
    if (!organizationId) {
      const org = await Organization.findOne({})
        .sort({ createdAt: 1 })
        .select('_id')
        .lean();

      if (org?._id) {
        organizationId = org._id.toString();
      }
    }

    if (!organizationId) {
      return res.status(200).json({
        status: true,
        message: 'No organization context found',
        data: null,
        isLoginAllowedNow: true,
      });
    }

    const loginTiming = await LoginTiming.findOne({ organizationId });

    if (!loginTiming) {
      return res.status(200).json({
        status: true,
        message: 'No login timing configured',
        data: null,
        isLoginAllowed: true, // Default allow
      });
    }

    // Check if current time is within allowed window
    const isLoginAllowedNow =
      loginTiming.isActive &&
      loginTiming.restrictedRoles.length > 0 &&
      loginTiming.isLoginAllowed('Agent'); // Use Agent as example

    const response = {
      status: true,
      message: 'Login timing status retrieved',
      data: loginTiming,
      organizationId,
      requestedOrganizationId: requestedOrganizationId || null,
      isLoginAllowedNow,
    };

    // If login not allowed now and it's active
    if (!isLoginAllowedNow && loginTiming.isActive) {
      const nextStartTime = loginTiming.getNextLoginStartTime();
      response.nextLoginTime = nextStartTime;
      response.currentLoggingClosedTime = loginTiming.endTime;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Get Login Timing Status Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to retrieve login timing status',
      error: error.message,
    });
  }
};

// TOGGLE login timing active status
exports.toggleLoginTiming = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID is required',
      });
    }

    let loginTiming = await LoginTiming.findOne({ organizationId });

    if (!loginTiming) {
      return res.status(404).json({
        status: false,
        message: 'Login timing not configured',
      });
    }

    loginTiming.isActive = !loginTiming.isActive;
    loginTiming.updatedBy = userId;
    loginTiming.updatedAt = new Date();

    await loginTiming.save();

    console.log(`✅ Login timing ${loginTiming.isActive ? 'enabled' : 'disabled'}`);

    res.status(200).json({
      status: true,
      message: `Login timing ${loginTiming.isActive ? 'enabled' : 'disabled'} successfully`,
      data: loginTiming,
    });
  } catch (error) {
    console.error('Toggle Login Timing Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to toggle login timing',
      error: error.message,
    });
  }
};
