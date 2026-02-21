/**
 * ONE-TIME FIX: Update Admin user to have organizationId
 * 
 * This endpoint allows SuperAdmin to link an existing Admin to an organization
 * 
 * Usage: POST /api/v1/superadmin/link-admin-to-org
 * Body: { adminId: "xxx", organizationId: "yyy" }
 */

const User = require('../models/User');
const Organization = require('../models/Organization');

exports.linkAdminToOrganization = async (req, res) => {
  try {
    const { adminId, organizationId } = req.body;

    if (!adminId || !organizationId) {
      return res.status(400).json({ 
        status: false, 
        message: 'adminId and organizationId are required' 
      });
    }

    // Verify organization exists
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({ 
        status: false, 
        message: 'Organization not found' 
      });
    }

    // Find admin user
    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ 
        status: false, 
        message: 'Admin user not found' 
      });
    }

    if (admin.role !== 'Admin') {
      return res.status(400).json({ 
        status: false, 
        message: 'User is not an Admin' 
      });
    }

    // Update admin with organization
    admin.organizationId = organizationId;
    await admin.save();

    res.status(200).json({
      status: true,
      message: 'Admin successfully linked to organization',
      data: {
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
        },
        organization: {
          id: organization._id,
          name: organization.name,
        }
      }
    });

  } catch (error) {
    console.error('Link Admin to Organization Error:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to link admin to organization', 
      error: error.message 
    });
  }
};

/**
 * Get all unlinked Admin users
 */
exports.getUnlinkedAdmins = async (req, res) => {
  try {
    const unlinkedAdmins = await User.find({ 
      role: 'Admin',
      $or: [
        { organizationId: null },
        { organizationId: { $exists: false } }
      ]
    }).select('name email employee_id is_active createdAt');

    res.status(200).json({
      status: true,
      message: 'Unlinked admins fetched successfully',
      count: unlinkedAdmins.length,
      data: unlinkedAdmins
    });

  } catch (error) {
    console.error('Get Unlinked Admins Error:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to fetch unlinked admins', 
      error: error.message 
    });
  }
};
