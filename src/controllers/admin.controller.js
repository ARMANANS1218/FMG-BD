const Organization = require('../models/Organization');
const User = require('../models/User');
const { decryptPassword } = require('../utils/encryption');

/**
 * ADMIN CONTROLLER
 * Handles organization settings that Admin can manage for their own organization
 */

// ==================== LOCATION ACCESS SETTINGS ====================

/**
 * Toggle Location Access Enforcement for Admin's Organization
 */
exports.toggleLocationAccess = async (req, res) => {
  try {
    console.log('========== TOGGLE LOCATION ACCESS (ADMIN) ==========');
    console.log('Request Body:', req.body);
    console.log('User:', req.user);
    
    const { enforce, defaultRadiusMeters, roles } = req.body;

    // Admin can only manage their own organization
    const organizationId = req.user?.organizationId;
    
    console.log('Organization ID:', organizationId);
    
    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID not found. Please login again.'
      });
    }

    if (enforce === undefined) {
      return res.status(400).json({
        status: false,
        message: 'enforce field is required (true/false)'
      });
    }

    const updateData = {
      'settings.loginLocationAccess.enforce': Boolean(enforce),
      updatedAt: new Date()
    };

    // Optional: Update radius if provided
    if (defaultRadiusMeters !== undefined) {
      updateData['settings.loginLocationAccess.defaultRadiusMeters'] = Number(defaultRadiusMeters);
    }

    // Optional: Update roles if provided
    if (Array.isArray(roles)) {
      updateData['settings.loginLocationAccess.roles'] = roles;
    }

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      updateData,
      { new: true, runValidators: true }
    ).select('name organizationId settings.loginLocationAccess');

    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }

    console.log('Location access updated successfully');
    console.log('New settings:', organization.settings.loginLocationAccess);
    
    res.status(200).json({
      status: true,
      message: `Location access ${enforce ? 'enabled' : 'disabled'} successfully`,
      data: {
        organizationId: organization.organizationId,
        organizationName: organization.name,
        loginLocationAccess: organization.settings.loginLocationAccess
      }
    });
  } catch (error) {
    console.error('Toggle Location Access Error (Admin):', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update location access settings',
      error: error.message
    });
  }
};

/**
 * Get Location Access Settings for Admin's Organization
 */
exports.getLocationAccessSettings = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID not found. Please login again.'
      });
    }

    const organization = await Organization.findById(organizationId)
      .select('name organizationId settings.loginLocationAccess')
      .lean();

    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }

    res.status(200).json({
      status: true,
      data: {
        organizationId: organization.organizationId,
        organizationName: organization.name,
        loginLocationAccess: organization.settings?.loginLocationAccess || {
          enforce: false,
          defaultRadiusMeters: 100,
          roles: ['Admin', 'Agent', 'QA', 'TL']
        }
      }
    });
  } catch (error) {
    console.error('Get Location Access Settings Error (Admin):', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch location access settings',
      error: error.message
    });
  }
};

/**
 * Get Admin's Organization Details
 */
exports.getMyOrganization = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID not found'
      });
    }

    const organization = await Organization.findById(organizationId)
      .select('-apiKeys -__v')
      .lean();

    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }

    res.status(200).json({
      status: true,
      data: organization
    });
  } catch (error) {
    console.error('Get Organization Error (Admin):', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch organization details',
      error: error.message
    });
  }
};

/**
 * Get All Employees with Passwords (Admin Only)
 * WARNING: This is a security-sensitive endpoint. Use with caution.
 * Only accessible by Admin role.
 */
exports.getAllEmployeesWithPasswords = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({
        status: false,
        message: 'Organization ID not found'
      });
    }

    // Get all employees in the admin's organization
    // Include encryptedPassword field (normally excluded)
    const employees = await User.find({
      organizationId: organizationId,
      role: { $in: ['Agent', 'TL', 'QA', 'Admin'] }
    })
    .select('employee_id name email mobile role status encryptedPassword createdAt')
    .lean();

    // Decrypt passwords for viewing
    const employeesWithPasswords = employees.map(emp => {
      const decrypted = emp.encryptedPassword ? decryptPassword(emp.encryptedPassword) : null;
      return {
        ...emp,
        password: decrypted || 'No password available',
        // Remove encryptedPassword from response
        encryptedPassword: undefined
      };
    });

    res.status(200).json({
      status: true,
      message: 'Employees retrieved successfully',
      data: employeesWithPasswords,
      count: employeesWithPasswords.length
    });

  } catch (error) {
    console.error('Get Employees With Passwords Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to retrieve employees',
      error: error.message
    });
  }
};
