const Plan = require('../models/Plan');

// Get all Plans for an organization
exports.getPlans = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { category, search } = req.query;

    const query = { organizationId, isActive: true };
    
    if (category && category !== 'all') {
      query.category = category;
    }

    if (search) {
      // Escape special characters for regex
      const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      
      query.$or = [
        { name: searchRegex },
        { data: searchRegex },
        { price: searchRegex },
        { category: searchRegex },
        { type: searchRegex },
        { tags: searchRegex },
        { details: searchRegex }
      ];
    }

    const plans = await Plan.find(query)
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching Plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Plans',
      error: error.message
    });
  }
};

// Create a new Plan (Admin only)
exports.createPlan = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.user?.organization;
    const userId = req.user?.id || req.user?._id;
    const userName = req.user?.name || req.user?.user_name || 'Unknown';
    const userRole = req.user?.role;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    if (userRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin can create Plans'
      });
    }

    const { name, price, data, details, category, type, tags } = req.body;
    console.log('Creates Plan Request Body:', req.body);
    console.log('User Role:', userRole);
    console.log('Org ID:', organizationId);

    if (!name || !price || !data) {
      return res.status(400).json({
        success: false,
        message: 'Name, price, and data limit are required'
      });
    }

    const planData = {
      organizationId,
      name: name.trim(),
      price: price.trim(),
      data: data.trim(),
      createdBy: userId,
      createdByName: userName
    };

    if (details && Array.isArray(details)) {
      planData.details = details.filter(d => d && d.trim()).map(d => d.trim());
    }
    
    if (category) {
      planData.category = category.trim();
    }
    
    if (type) {
      planData.type = type.trim();
    }

    if (tags && Array.isArray(tags)) {
      planData.tags = tags.filter(t => t && t.trim()).map(t => t.trim().toLowerCase());
    } else if (tags && typeof tags === 'string') {
        planData.tags = tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
    }

    const plan = await Plan.create(planData);

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      data: plan
    });
  } catch (error) {
    console.error('Error creating Plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create Plan',
      error: error.message
    });
  }
};

// Update an existing Plan (Admin only)
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.user?.organization;
    const userRole = req.user?.role;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID not found'
      });
    }

    if (userRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin can update Plans'
      });
    }

    const { name, price, data, details, category, type, isActive, tags } = req.body;

    const plan = await Plan.findOne({ _id: id, organizationId });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    if (name) plan.name = name.trim();
    if (price) plan.price = price.trim();
    if (data) plan.data = data.trim();
    if (category) plan.category = category.trim();
    if (type) plan.type = type.trim();
    if (details && Array.isArray(details)) {
       plan.details = details.filter(d => d && d.trim()).map(d => d.trim());
    }
    if (typeof isActive === 'boolean') {
        plan.isActive = isActive;
    }
    if (tags && Array.isArray(tags)) {
        plan.tags = tags.filter(t => t && t.trim()).map(t => t.trim().toLowerCase());
    } else if (tags && typeof tags === 'string') {
        plan.tags = tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
    }

    await plan.save();

    res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      data: plan
    });
  } catch (error) {
    console.error('Error updating Plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update Plan',
      error: error.message
    });
  }
};

// Delete a Plan (Soft delete) (Admin only)
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.user?.organization;
    const userRole = req.user?.role;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID not found'
      });
    }

    if (userRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin can delete Plans'
      });
    }

    const plan = await Plan.findOne({ _id: id, organizationId });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Soft delete
    plan.isActive = false;
    await plan.save();

    res.status(200).json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting Plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete Plan',
      error: error.message
    });
  }
};
