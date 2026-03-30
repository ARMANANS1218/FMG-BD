const Faq = require('../models/Faq');

// Get all FAQs and Common Replies for an organization
exports.getFaqs = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { type } = req.query; // 'common' or 'faq' or undefined (all)

    const query = { organizationId, isActive: true };
    if (type) {
      query.type = type;
    }

    const faqs = await Faq.find(query)
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: faqs
    });
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQs',
      error: error.message
    });
  }
};

// Create a new FAQ or Common Reply
exports.createFaq = async (req, res) => {
  try {
    // Get user info from req.user set by authenticateToken middleware
    const organizationId = req.user?.organizationId || req.user?.organization;
    const userId = req.user?.id || req.user?._id;  // middleware sets 'id', not '_id'
    const userName = req.user?.name || req.user?.user_name || 'Unknown';
    const userRole = req.user?.role;

    console.log('Create FAQ - User Info:', { organizationId, userId, userName, userRole });
    console.log('Full req.user object:', JSON.stringify(req.user, null, 2));

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    // Only Admin can create FAQs
    // TL, QA, and Agent can only view/use FAQs
    if (userRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin can create FAQs and Common Replies. Your role: ' + userRole
      });
    }

    const { type, text, question, answer, category, tags } = req.body;

    console.log('Create FAQ - Request body:', { type, text, question, answer, category, tags });

    // Validate based on type
    if (type === 'common' && !text) {
      return res.status(400).json({
        success: false,
        message: 'Text is required for common replies'
      });
    }

    if (type === 'faq' && (!question || !answer)) {
      return res.status(400).json({
        success: false,
        message: 'Question and answer are required for FAQs'
      });
    }

    const faqData = {
      organizationId,
      type,
      createdBy: userId,
      createdByName: userName
    };

    if (type === 'common') {
      faqData.text = text;
    } else if (type === 'faq') {
      faqData.question = question;
      faqData.answer = answer;
    }

    // Add category and tags if provided
    if (category) {
      faqData.category = category;
    }
    if (tags && Array.isArray(tags) && tags.length > 0) {
      faqData.tags = tags.filter(tag => tag.trim()).map(tag => tag.trim().toLowerCase());
    }

    console.log('Creating FAQ with data:', faqData);

    const faq = await Faq.create(faqData);

    console.log('FAQ created successfully:', faq._id);

    res.status(201).json({
      success: true,
      message: `${type === 'common' ? 'Common reply' : 'FAQ'} created successfully`,
      data: faq
    });
  } catch (error) {
    console.error('Error creating FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create FAQ',
      error: error.message
    });
  }
};

// Update an existing FAQ or Common Reply
exports.updateFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.user?.organization;
    const userRole = req.user?.role;

    console.log('Update FAQ - User Info:', { organizationId, userRole, faqId: id });

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID not found'
      });
    }

    // Only Admin can update FAQs
    // TL, QA, and Agent can only view/use FAQs
    if (userRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin can update FAQs and Common Replies. Your role: ' + userRole
      });
    }

    const { text, question, answer, category, tags } = req.body;

    const faq = await Faq.findOne({ _id: id, organizationId, isActive: true });

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    // Update based on type
    if (faq.type === 'common') {
      faq.text = text || faq.text;
    } else if (faq.type === 'faq') {
      faq.question = question || faq.question;
      faq.answer = answer || faq.answer;
    }

    // Update category and tags if provided
    if (category !== undefined) {
      faq.category = category;
    }
    if (tags !== undefined && Array.isArray(tags)) {
      faq.tags = tags.filter(tag => tag.trim()).map(tag => tag.trim().toLowerCase());
    }

    await faq.save();

    res.status(200).json({
      success: true,
      message: `${faq.type === 'common' ? 'Common reply' : 'FAQ'} updated successfully`,
      data: faq
    });
  } catch (error) {
    console.error('Error updating FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ',
      error: error.message
    });
  }
};

// Delete an FAQ or Common Reply (soft delete)
exports.deleteFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.user?.organization;
    const userRole = req.user?.role;

    console.log('Delete FAQ - User Info:', { organizationId, userRole, faqId: id });

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID not found'
      });
    }

    // Only Admin can delete FAQs
    // TL, QA, and Agent can only view/use FAQs
    if (userRole !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin can delete FAQs and Common Replies. Your role: ' + userRole
      });
    }

    const faq = await Faq.findOne({ _id: id, organizationId });

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    faq.isActive = false;
    await faq.save();

    res.status(200).json({
      success: true,
      message: `${faq.type === 'common' ? 'Common reply' : 'FAQ'} deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ',
      error: error.message
    });
  }
};
