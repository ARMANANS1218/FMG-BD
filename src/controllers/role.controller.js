const Role = require('../models/Role');

// Create a new dynamic role
exports.createRole = async (req, res) => {
  try {
    const { name, baseRole, description } = req.body;
    const organizationId = req.user?.organizationId;

    if (!name || !baseRole) {
      return res.status(400).json({
        status: false,
        message: 'Role name and base role are required',
      });
    }

    const allowedBaseRoles = ['Admin', 'Agent', 'QA', 'TL', 'Management', 'Dev'];
    if (!allowedBaseRoles.includes(baseRole)) {
      return res.status(400).json({
        status: false,
        message: `Base role must be one of: ${allowedBaseRoles.join(', ')}`,
      });
    }

    // Check for duplicate role name in same org
    const existing = await Role.findOne({ organizationId, name: name.trim() });
    if (existing) {
      return res.status(400).json({
        status: false,
        message: 'A role with this name already exists in your organization',
      });
    }

    const newRole = await Role.create({
      organizationId,
      name: name.trim(),
      baseRole,
      description: description || null,
      createdBy: req.user?.id,
    });

    res.status(201).json({
      status: true,
      message: 'Role created successfully',
      data: newRole,
    });
  } catch (error) {
    console.error('Create Role Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to create role',
      error: error.message,
    });
  }
};

// Get all roles for the organization
exports.getRoles = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    const roles = await Role.find({ organizationId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    // Include default system roles
    const systemRoles = [
      { _id: 'system-admin', name: 'Admin', baseRole: 'Admin', isSystem: true, isActive: true },
      { _id: 'system-agent', name: 'Agent', baseRole: 'Agent', isSystem: true, isActive: true },
      { _id: 'system-qa', name: 'QA', baseRole: 'QA', isSystem: true, isActive: true },
      { _id: 'system-tl', name: 'TL', baseRole: 'TL', isSystem: true, isActive: true },
      {
        _id: 'system-management',
        name: 'Management',
        baseRole: 'Management',
        isSystem: true,
        isActive: true,
      },
      { _id: 'system-dev', name: 'Dev', baseRole: 'Dev', isSystem: true, isActive: true },
    ];

    res.status(200).json({
      status: true,
      data: {
        systemRoles,
        customRoles: roles,
        all: [...systemRoles, ...roles],
      },
    });
  } catch (error) {
    console.error('Get Roles Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch roles',
      error: error.message,
    });
  }
};

// Update a dynamic role
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, baseRole, description, isActive } = req.body;
    const organizationId = req.user?.organizationId;

    const role = await Role.findOne({ _id: id, organizationId });
    if (!role) {
      return res.status(404).json({ status: false, message: 'Role not found' });
    }

    if (name) {
      // Check uniqueness
      const existing = await Role.findOne({
        organizationId,
        name: name.trim(),
        _id: { $ne: id },
      });
      if (existing) {
        return res.status(400).json({
          status: false,
          message: 'A role with this name already exists',
        });
      }
      role.name = name.trim();
    }
    if (baseRole) role.baseRole = baseRole;
    if (description !== undefined) role.description = description;
    if (isActive !== undefined) role.isActive = isActive;

    await role.save();

    res.status(200).json({
      status: true,
      message: 'Role updated successfully',
      data: role,
    });
  } catch (error) {
    console.error('Update Role Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update role',
      error: error.message,
    });
  }
};

// Delete a dynamic role
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    const role = await Role.findOneAndDelete({ _id: id, organizationId });
    if (!role) {
      return res.status(404).json({ status: false, message: 'Role not found' });
    }

    res.status(200).json({
      status: true,
      message: 'Role deleted successfully',
      data: role,
    });
  } catch (error) {
    console.error('Delete Role Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to delete role',
      error: error.message,
    });
  }
};
