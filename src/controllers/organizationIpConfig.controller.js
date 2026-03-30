const OrganizationIpConfig = require('../models/OrganizationIpConfig');

// Get organization IP configuration
exports.getOrganizationIpConfig = async (req, res) => {
  try {
    // SuperAdmin can pass organizationId via query, others use req.user.organizationId
    const organizationId = req.user.role === 'SuperAdmin' 
      ? req.query.organizationId 
      : req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    const config = await OrganizationIpConfig.findOne({ organizationId })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!config) {
      return res.status(200).json({
        success: true,
        message: 'No IP configuration found for organization',
        data: null
      });
    }

    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('Error fetching organization IP config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch IP configuration',
      error: error.message
    });
  }
};

// Create or update organization IP configuration
exports.createOrUpdateOrgIpConfig = async (req, res) => {
  try {
    const { allowedIps, isActive, applyToRoles, organizationId: bodyOrgId } = req.body;
    
    // SuperAdmin can pass organizationId in body, others use req.user.organizationId
    const organizationId = req.user.role === 'SuperAdmin' 
      ? (bodyOrgId || req.query.organizationId)
      : req.user.organizationId;
    
    const adminId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    // Validate IPs
    if (!allowedIps || !Array.isArray(allowedIps) || allowedIps.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one IP address is required'
      });
    }

    // Clean and format IPs
    const cleanedIps = allowedIps.map(item => {
      const cleanIp = typeof item === 'string' 
        ? item.split('/')[0].trim() 
        : item.ip.split('/')[0].trim();
      
      return {
        ip: cleanIp,
        description: typeof item === 'string' ? 'Organization IP' : (item.description || 'Organization IP'),
        addedAt: new Date(),
        addedBy: adminId
      };
    });

    // Check if configuration exists
    let config = await OrganizationIpConfig.findOne({ organizationId });

    if (config) {
      // Update existing
      config.allowedIps = cleanedIps;
      config.isActive = isActive !== undefined ? isActive : config.isActive;
      config.applyToRoles = applyToRoles || config.applyToRoles;
      config.updatedBy = adminId;
      await config.save();

      return res.status(200).json({
        success: true,
        message: 'Organization IP configuration updated successfully',
        data: config
      });
    } else {
      // Create new
      config = await OrganizationIpConfig.create({
        organizationId,
        allowedIps: cleanedIps,
        isActive: isActive !== undefined ? isActive : true,
        applyToRoles: applyToRoles || ['Agent', 'TL', 'QA'],
        createdBy: adminId
      });

      return res.status(201).json({
        success: true,
        message: 'Organization IP configuration created successfully',
        data: config
      });
    }
  } catch (error) {
    console.error('Error creating/updating organization IP config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save IP configuration',
      error: error.message
    });
  }
};

// Add IP to organization configuration
exports.addIpToOrgConfig = async (req, res) => {
  try {
    const { ip, description, organizationId: bodyOrgId } = req.body;
    
    // SuperAdmin can pass organizationId in body, others use req.user.organizationId
    const organizationId = req.user.role === 'SuperAdmin' 
      ? (bodyOrgId || req.query.organizationId)
      : req.user.organizationId;
    
    const adminId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
    }

    const cleanIp = ip.split('/')[0].trim();

    const config = await OrganizationIpConfig.findOne({ organizationId });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Organization IP configuration not found. Please create it first.'
      });
    }

    // Check if IP already exists
    const ipExists = config.allowedIps.some(item => item.ip === cleanIp);
    if (ipExists) {
      return res.status(400).json({
        success: false,
        message: 'IP address already exists in configuration'
      });
    }

    config.allowedIps.push({
      ip: cleanIp,
      description: description || 'Organization IP',
      addedAt: new Date(),
      addedBy: adminId
    });

    config.updatedBy = adminId;
    await config.save();

    res.status(200).json({
      success: true,
      message: 'IP address added successfully',
      data: config
    });
  } catch (error) {
    console.error('Error adding IP to organization config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add IP address',
      error: error.message
    });
  }
};

// Remove IP from organization configuration
exports.removeIpFromOrgConfig = async (req, res) => {
  try {
    const { ipId } = req.params;
    
    // SuperAdmin can pass organizationId via query, others use req.user.organizationId
    const organizationId = req.user.role === 'SuperAdmin' 
      ? req.query.organizationId
      : req.user.organizationId;
    
    const adminId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    const config = await OrganizationIpConfig.findOne({ organizationId });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Organization IP configuration not found'
      });
    }

    config.allowedIps = config.allowedIps.filter(item => item._id.toString() !== ipId);
    config.updatedBy = adminId;
    await config.save();

    res.status(200).json({
      success: true,
      message: 'IP address removed successfully',
      data: config
    });
  } catch (error) {
    console.error('Error removing IP from organization config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove IP address',
      error: error.message
    });
  }
};

// Toggle organization IP configuration status
exports.toggleOrgIpConfigStatus = async (req, res) => {
  try {
    // SuperAdmin can pass organizationId via query or body, others use req.user.organizationId
    const organizationId = req.user.role === 'SuperAdmin' 
      ? (req.query.organizationId || req.body.organizationId)
      : req.user.organizationId;
    
    const adminId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    const config = await OrganizationIpConfig.findOne({ organizationId });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Organization IP configuration not found'
      });
    }

    const previousState = config.isActive;
    config.isActive = !config.isActive;
    config.updatedBy = adminId;
    await config.save();

    console.log(`🔄 Organization IP Config Toggled: ${previousState} → ${config.isActive}`);
    console.log(`🔄 Organization: ${organizationId}`);
    console.log(`🔄 Config will now: ${config.isActive ? 'BLOCK unauthorized IPs' : 'ALLOW all IPs (disabled)'}`);

    res.status(200).json({
      success: true,
      message: `IP configuration ${config.isActive ? 'activated' : 'deactivated'} successfully`,
      data: config
    });
  } catch (error) {
    console.error('Error toggling organization IP config status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle status',
      error: error.message
    });
  }
};

// Delete organization IP configuration
exports.deleteOrgIpConfig = async (req, res) => {
  try {
    // SuperAdmin can pass organizationId via query, others use req.user.organizationId
    const organizationId = req.user.role === 'SuperAdmin' 
      ? req.query.organizationId
      : req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    const config = await OrganizationIpConfig.findOneAndDelete({ organizationId });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Organization IP configuration not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Organization IP configuration deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting organization IP config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete IP configuration',
      error: error.message
    });
  }
};

// Verify IP access
exports.verifyOrgIpAccess = async (req, res) => {
  try {
    const { organizationId, userRole, clientIp } = req.body;

    if (!organizationId || !userRole || !clientIp) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters'
      });
    }

    const result = await OrganizationIpConfig.verifyOrgIpAccess(organizationId, userRole, clientIp);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error verifying organization IP access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify IP access',
      error: error.message
    });
  }
};
