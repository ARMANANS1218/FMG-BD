const Organization = require('../models/Organization');
const User = require('../models/User');
const Query = require('../models/Query');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Generate unique organization ID
 */
const generateOrganizationId = async () => {
  // Find the organization with the highest ID number
  const lastOrg = await Organization.findOne()
    .sort({ organizationId: -1 })
    .select('organizationId')
    .lean();
  
  let nextNumber = 1;
  
  if (lastOrg && lastOrg.organizationId) {
    // Extract number from format "ORG-0001"
    const match = lastOrg.organizationId.match(/ORG-(\d+)/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }
  
  const id = `ORG-${String(nextNumber).padStart(4, '0')}`;
  return id;
};

/**
 * Generate secure API key
 */
const generateApiKey = () => {
  return 'sk_' + crypto.randomBytes(32).toString('hex');
};

// ==================== CREATE ORGANIZATION ====================
exports.createOrganization = async (req, res) => {
  try {
    const {
      name,
      displayName,
      domain,
      subdomain,
      adminEmail,
      contactEmail,
      contactPhone,
      website,
      plan = 'trial',
      features = {}
    } = req.body;
    
    // Validation
    if (!name || !adminEmail) {
      return res.status(400).json({
        status: false,
        message: 'Name and admin email are required'
      });
    }
    
    // Check if organization already exists
    if (domain) {
      const existingOrg = await Organization.findOne({ domain });
      if (existingOrg) {
        return res.status(400).json({
          status: false,
          message: 'Organization with this domain already exists'
        });
      }
    }
    
    if (subdomain) {
      const existingSubdomain = await Organization.findOne({ subdomain });
      if (existingSubdomain) {
        return res.status(400).json({
          status: false,
          message: 'Subdomain already taken'
        });
      }
    }
    
    // Generate organization ID
    const organizationId = await generateOrganizationId();
    
    // Generate API key
    const apiKey = generateApiKey();
    
    // Set trial expiry (14 days from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 14);
    
    // Default feature flags based on plan
    let defaultFeatures = {
      chat: { enabled: true, maxConcurrentChats: 50 },
      query: { enabled: true, maxQueriesPerMonth: 500 },
      email: { enabled: false },
      videoCalls: { enabled: false },
      audioCalls: { enabled: false },
      analytics: { enabled: false },
      customBranding: { enabled: false },
      apiAccess: { enabled: true },
    };
    
    // Override with provided features
    if (plan === 'professional' || plan === 'enterprise') {
      defaultFeatures.email = { enabled: true, maxEmailsPerMonth: 5000 };
      defaultFeatures.videoCalls = { enabled: true, maxCallsPerMonth: 500 };
      defaultFeatures.audioCalls = { enabled: true, maxCallsPerMonth: 1000 };
      defaultFeatures.analytics = { enabled: true, advancedReports: true };
      defaultFeatures.customBranding = { enabled: true };
    }
    
    // Merge with custom features
    const finalFeatures = { ...defaultFeatures, ...features };
    
    // Create organization
    const organization = await Organization.create({
      organizationId,
      name,
      displayName: displayName || name,
      domain,
      subdomain,
      adminEmail,
      contactEmail: contactEmail || adminEmail,
      contactPhone,
      website,
      subscription: {
        plan,
        status: 'active',
        expiryDate,
        maxAgents: plan === 'enterprise' ? 100 : plan === 'professional' ? 20 : 5,
      },
      features: finalFeatures,
      apiKeys: [{
        key: apiKey,
        name: 'Primary API Key',
        permissions: ['widget', 'api'],
        isActive: true,
      }],
      createdBy: req.user.id,
      isActive: true,
    });
    
    res.status(201).json({
      status: true,
      message: 'Organization created successfully',
      data: {
        organization,
        apiKey: apiKey, // Return API key only once
        setupUrl: subdomain ? `https://${subdomain}.chatcrm.com/setup` : null,
      }
    });
  } catch (error) {
    console.error('Create Organization Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to create organization',
      error: error.message
    });
  }
};

// ==================== GET ALL ORGANIZATIONS ====================
exports.getAllOrganizations = async (req, res) => {
  try {
    const { status, plan, search, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    
    if (status) filter['subscription.status'] = status;
    if (plan) filter['subscription.plan'] = plan;
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { domain: { $regex: search, $options: 'i' } },
        { organizationId: { $regex: search, $options: 'i' } },
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const organizations = await Organization.find(filter)
      .select('-apiKeys.key') // Hide API keys
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email');
    
    const total = await Organization.countDocuments(filter);
    
    res.status(200).json({
      status: true,
      data: {
        organizations,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get Organizations Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch organizations',
      error: error.message
    });
  }
};

// ==================== GET ORGANIZATION BY ID ====================
exports.getOrganizationById = async (req, res) => {
  try {
    const { orgId } = req.params;
    
    const organization = await Organization.findById(orgId)
      .populate('createdBy', 'name email');
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Get organization stats
    const stats = {
      totalUsers: await User.countDocuments({ organizationId: orgId }),
      totalAgents: await User.countDocuments({ organizationId: orgId, role: 'Agent' }),
      totalQA: await User.countDocuments({ organizationId: orgId, role: 'QA' }),
      totalCustomers: await User.countDocuments({ organizationId: orgId, role: 'Customer' }),
      totalQueries: await Query.countDocuments({ organizationId: orgId }),
      activeQueries: await Query.countDocuments({ organizationId: orgId, status: { $in: ['Pending', 'Accepted', 'In Progress'] } }),
    };
    
    res.status(200).json({
      status: true,
      data: {
        organization,
        stats
      }
    });
  } catch (error) {
    console.error('Get Organization Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch organization',
      error: error.message
    });
  }
};

// ==================== UPDATE ORGANIZATION ====================
exports.updateOrganization = async (req, res) => {
  try {
    const { orgId } = req.params;
    const updates = req.body;
    
    // Don't allow updating certain fields directly
    delete updates.organizationId;
    delete updates.apiKeys;
    delete updates.usage;
    
    const organization = await Organization.findByIdAndUpdate(
      orgId,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    res.status(200).json({
      status: true,
      message: 'Organization updated successfully',
      data: organization
    });
  } catch (error) {
    console.error('Update Organization Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update organization',
      error: error.message
    });
  }
};

// ==================== DELETE ORGANIZATION ====================
exports.deleteOrganization = async (req, res) => {
  try {
    const { orgId } = req.params;
    
    const organization = await Organization.findByIdAndDelete(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // TODO: Optionally delete all associated data (users, queries, etc.)
    // For now, just mark organization as deleted
    
    res.status(200).json({
      status: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    console.error('Delete Organization Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to delete organization',
      error: error.message
    });
  }
};

// ==================== SUSPEND ORGANIZATION ====================
exports.suspendOrganization = async (req, res) => {
  try {
    const { orgId } = req.params;
    const { reason } = req.body;
    
    const organization = await Organization.findByIdAndUpdate(
      orgId,
      {
        isSuspended: true,
        suspensionReason: reason,
        'subscription.status': 'suspended',
        updatedAt: new Date()
      },
      { new: true }
    );
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    res.status(200).json({
      status: true,
      message: 'Organization suspended successfully',
      data: organization
    });
  } catch (error) {
    console.error('Suspend Organization Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to suspend organization',
      error: error.message
    });
  }
};

// ==================== ACTIVATE ORGANIZATION ====================
exports.activateOrganization = async (req, res) => {
  try {
    const { orgId } = req.params;
    
    const organization = await Organization.findByIdAndUpdate(
      orgId,
      {
        isSuspended: false,
        suspensionReason: null,
        'subscription.status': 'active',
        isActive: true,
        updatedAt: new Date()
      },
      { new: true }
    );
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    res.status(200).json({
      status: true,
      message: 'Organization activated successfully',
      data: organization
    });
  } catch (error) {
    console.error('Activate Organization Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to activate organization',
      error: error.message
    });
  }
};

// ==================== UPDATE SUBSCRIPTION ====================
exports.updateSubscription = async (req, res) => {
  try {
    const { orgId } = req.params;
    const { plan, status, expiryDate, maxAgents, features } = req.body;
    
    const updates = { updatedAt: new Date() };
    
    if (plan) updates['subscription.plan'] = plan;
    if (status) updates['subscription.status'] = status;
    if (expiryDate) updates['subscription.expiryDate'] = expiryDate;
    if (maxAgents) updates['subscription.maxAgents'] = maxAgents;
    if (features) updates['features'] = features;
    
    const organization = await Organization.findByIdAndUpdate(
      orgId,
      updates,
      { new: true }
    );
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    res.status(200).json({
      status: true,
      message: 'Subscription updated successfully',
      data: organization
    });
  } catch (error) {
    console.error('Update Subscription Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update subscription',
      error: error.message
    });
  }
};

// ==================== CREATE ORGANIZATION ADMIN (BY SUPERADMIN) ====================
exports.createOrganizationAdmin = async (req, res) => {
  try {
    const { orgId } = req.params;
    const { email, name, user_name, employee_id, mobile, customPassword } = req.body;

    if (!email || !name || !user_name || !employee_id) {
      return res.status(400).json({ status: false, message: 'email, name, user_name and employee_id are required' });
    }

    // Verify organization exists
    const organization = await Organization.findById(orgId);
    if (!organization) {
      return res.status(404).json({ status: false, message: 'Organization not found' });
    }

    // Check duplicates
    const existingByEmail = await User.findOne({ email });
    if (existingByEmail) {
      return res.status(409).json({ status: false, message: 'Email already in use' });
    }

    const existingByEmployee = await User.findOne({ employee_id, organizationId: orgId });
    if (existingByEmployee) {
      return res.status(409).json({ status: false, message: 'Employee ID already in use for this organization' });
    }

    // Use custom password if provided, otherwise generate temporary password
    let tempPassword;
    if (customPassword && customPassword.trim()) {
      tempPassword = customPassword.trim();
    } else {
      tempPassword = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    }
    
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Create Admin user under this organization
    const adminUser = await User.create({
      organizationId: orgId,
      employee_id,
      user_name,
      name,
      email,
      mobile,
      password: hashedPassword,
      visiblePassword: tempPassword, // Store for SuperAdmin viewing
      role: 'Admin',
      is_active: true,
    });

    // Return the password in response (custom or generated)
    res.status(201).json({
      status: true,
      message: 'Organization admin created successfully',
      data: {
        user: {
          id: adminUser._id,
          email: adminUser.email,
          name: adminUser.name,
          employee_id: adminUser.employee_id,
        },
        tempPassword,
        isCustomPassword: !!customPassword
      }
    });
  } catch (error) {
    console.error('Create Organization Admin Error:', error);
    res.status(500).json({ status: false, message: 'Failed to create organization admin', error: error.message });
  }
};

// ==================== REGENERATE API KEY ====================
exports.regenerateApiKey = async (req, res) => {
  try {
    const { orgId } = req.params;
    const { keyName = 'Primary API Key' } = req.body;
    
    const newApiKey = generateApiKey();
    
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Add new API key
    organization.apiKeys.push({
      key: newApiKey,
      name: keyName,
      permissions: ['widget', 'api'],
      isActive: true,
    });
    
    await organization.save();
    
    res.status(200).json({
      status: true,
      message: 'API key generated successfully',
      data: {
        apiKey: newApiKey
      }
    });
  } catch (error) {
    console.error('Regenerate API Key Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to regenerate API key',
      error: error.message
    });
  }
};

// ==================== GET ORGANIZATION ADMINS ====================
exports.getOrganizationAdmins = async (req, res) => {
  try {
    const { orgId } = req.params;
    
    // Check if organization exists
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Get all admins for this organization (include visiblePassword for SuperAdmin)
    const admins = await User.find({
      organizationId: orgId,
      role: 'Admin',
      is_active: { $ne: false } // Include active and undefined
    }).select('name user_name email employee_id mobile is_active createdAt visiblePassword');
    
    res.status(200).json({
      status: true,
      message: 'Admins fetched successfully',
      data: admins
    });
  } catch (error) {
    console.error('Get Organization Admins Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch organization admins',
      error: error.message
    });
  }
};

// ==================== GET ADMIN DETAILS ====================
exports.getAdminDetails = async (req, res) => {
  try {
    const { orgId, adminId } = req.params;
    
    // Check if organization exists
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Find admin
    const admin = await User.findOne({
      _id: adminId,
      organizationId: orgId,
      role: 'Admin'
    }).select('-password');
    
    if (!admin) {
      return res.status(404).json({
        status: false,
        message: 'Admin not found in this organization'
      });
    }
    
    res.status(200).json({
      status: true,
      message: 'Admin details fetched successfully',
      data: admin
    });
  } catch (error) {
    console.error('Get Admin Details Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch admin details',
      error: error.message
    });
  }
};

// ==================== UPDATE ORGANIZATION ADMIN ====================
exports.updateOrganizationAdmin = async (req, res) => {
  try {
    const { orgId, adminId } = req.params;
    const { name, user_name, email, employee_id, mobile, is_active } = req.body;
    
    // Check if organization exists
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Find admin
    const admin = await User.findOne({
      _id: adminId,
      organizationId: orgId,
      role: 'Admin'
    });
    
    if (!admin) {
      return res.status(404).json({
        status: false,
        message: 'Admin not found in this organization'
      });
    }
    
    // Check if email is being changed and if it's already taken
    if (email && email !== admin.email) {
      const existingUser = await User.findOne({ 
        email,
        organizationId: orgId,
        _id: { $ne: adminId }
      });
      
      if (existingUser) {
        return res.status(400).json({
          status: false,
          message: 'Email already exists in this organization'
        });
      }
    }
    
    // Update admin
    const updateData = {};
    if (name) updateData.name = name;
    if (user_name) updateData.user_name = user_name;
    if (email) updateData.email = email;
    if (employee_id) updateData.employee_id = employee_id;
    if (mobile) updateData.mobile = mobile;
    if (typeof is_active !== 'undefined') updateData.is_active = is_active;
    
    const updatedAdmin = await User.findByIdAndUpdate(
      adminId,
      updateData,
      { new: true }
    ).select('-password');
    
    res.status(200).json({
      status: true,
      message: 'Admin updated successfully',
      data: updatedAdmin
    });
  } catch (error) {
    console.error('Update Organization Admin Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update admin',
      error: error.message
    });
  }
};

// ==================== RESET ADMIN PASSWORD ====================
exports.resetAdminPassword = async (req, res) => {
  try {
    const { orgId, adminId } = req.params;
    const { customPassword } = req.body;
    
    // Check if organization exists
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Find admin
    const admin = await User.findOne({
      _id: adminId,
      organizationId: orgId,
      role: 'Admin'
    });
    
    if (!admin) {
      return res.status(404).json({
        status: false,
        message: 'Admin not found in this organization'
      });
    }
    
    // Use custom password if provided, otherwise generate temporary password
    let tempPassword;
    if (customPassword && customPassword.trim()) {
      tempPassword = customPassword.trim();
    } else {
      tempPassword = crypto.randomBytes(4).toString('hex');
    }
    
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    // Update admin password and store visible password for SuperAdmin
    admin.password = hashedPassword;
    admin.visiblePassword = tempPassword;
    await admin.save();
    
    res.status(200).json({
      status: true,
      message: 'Password reset successfully',
      data: {
        tempPassword,
        isCustomPassword: !!customPassword,
        admin: {
          id: admin._id,
          email: admin.email,
          name: admin.name
        }
      }
    });
  } catch (error) {
    console.error('Reset Admin Password Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to reset password',
      error: error.message
    });
  }
};

// ==================== DELETE ORGANIZATION ADMIN ====================
exports.deleteOrganizationAdmin = async (req, res) => {
  try {
    const { orgId, adminId } = req.params;
    
    // Check if organization exists
    const organization = await Organization.findById(orgId);
    
    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }
    
    // Find admin
    const admin = await User.findOne({
      _id: adminId,
      organizationId: orgId,
      role: 'Admin'
    });
    
    if (!admin) {
      return res.status(404).json({
        status: false,
        message: 'Admin not found in this organization'
      });
    }
    
    // Delete admin
    await User.findByIdAndDelete(adminId);
    
    res.status(200).json({
      status: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    console.error('Delete Organization Admin Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to delete admin',
      error: error.message
    });
  }
};

// ==================== GET DASHBOARD STATS ====================
exports.getDashboardStats = async (req, res) => {
  try {
    const totalOrganizations = await Organization.countDocuments();
    const activeOrganizations = await Organization.countDocuments({ 
      'subscription.status': 'active',
      isActive: true 
    });
    const suspendedOrganizations = await Organization.countDocuments({ isSuspended: true });
    const trialOrganizations = await Organization.countDocuments({ 'subscription.plan': 'trial' });
    
    // Get recent organizations (last 10)
    const recentOrganizations = await Organization.find()
      .select('name organizationId domain subscription createdAt isActive isSuspended')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get subscription distribution
    const subscriptionStats = await Organization.aggregate([
      {
        $group: {
          _id: '$subscription.plan',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Total usage across all organizations
    const usageStats = await Organization.aggregate([
      {
        $group: {
          _id: null,
          totalQueries: { $sum: '$usage.totalQueries' },
          totalCalls: { $sum: '$usage.totalCalls' },
          totalUsers: { $sum: '$usage.totalAgents' },
        }
      }
    ]);
    
    res.status(200).json({
      status: true,
      data: {
        overview: {
          totalOrganizations,
          activeOrganizations,
          suspendedOrganizations,
          trialOrganizations,
        },
        subscriptions: subscriptionStats,
        usage: usageStats[0] || {},
        recentOrganizations,
      }
    });
  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};

// ==================== LOCATION ACCESS SETTINGS ====================

/**
 * Toggle Location Access Enforcement for an Organization (SuperAdmin Only)
 */
exports.toggleLocationAccess = async (req, res) => {
  try {
    console.log('========== TOGGLE LOCATION ACCESS (SUPERADMIN) ==========');
    console.log('Org ID:', req.params.orgId);
    console.log('Request Body:', req.body);
    
    const { orgId } = req.params;
    const { enforce, defaultRadiusMeters, roles } = req.body;

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
      orgId,
      updateData,
      { new: true, runValidators: true }
    ).select('name organizationId settings.loginLocationAccess');

    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
    }

    console.log('Location access updated successfully (SuperAdmin)');
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
    console.error('Toggle Location Access Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update location access settings',
      error: error.message
    });
  }
};

/**
 * Get Location Access Settings for an Organization (SuperAdmin)
 */
exports.getLocationAccessSettings = async (req, res) => {
  try {
    const { orgId } = req.params;

    const organization = await Organization.findById(orgId)
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
    console.error('Get Location Access Settings Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch location access settings',
      error: error.message
    });
  }
};
