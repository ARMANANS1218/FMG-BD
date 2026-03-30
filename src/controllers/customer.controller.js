const Staff = require('../models/Staff');
const Customer = require('../models/Customer');
const Plan = require('../models/Plan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');

// REGISTER
exports.customerRegister = async (req, res) => {
  const { name, email, password, mobile, organizationId } = req.body;

  try {
    const existingUser = await Customer.findOne({
      $or: [{ email }, { mobile }],
    });

    if (existingUser) {
      return res.status(400).json({
        status: false,
        message:
          existingUser.email === email
            ? 'Email is already registered.'
            : 'Mobile number is already registered.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newCustomer = await Customer.create({
      organizationId: organizationId || null,
      name,
      user_name: email.split('@')[0],
      email,
      mobile,
      password: hashedPassword,
      customerType: 'registered',
    });

    res.status(201).json({
      status: true,
      message: 'Customer registered successfully',
      data: newCustomer,
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ status: false, message: 'Registration failed', error: error.message });
  }
};
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    // Try Customer first, fallback to Staff (non-customer roles)
    let user = await Customer.findById(userId).select('-password');
    if (!user) {
      user = await Staff.findById(userId).select('-password');
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false, data: null });
    }
    res.status(200).json({ message: 'Profile fetched successfully', status: true, data: user });
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ message: 'Internal server error', status: false, data: null });
  }
};
// LOGIN
exports.customerLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const customer = await Customer.findOne({ email });
    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.status(400).json({ status: false, message: 'Invalid email or password' });
    }

    customer.is_active = true;
    customer.login_time = new Date();
    customer.workStatus = 'active';
    await customer.save();

    const token = jwt.sign(
      { id: customer._id, role: 'Customer' },
      process.env.ACCESS_TOKEN_SECRET || 'secret_key',
      { expiresIn: '1d' }
    );

    // Remove password from response
    const customerData = customer.toObject();
    delete customerData.password;

    res.status(200).json({
      status: true,
      message: 'Login successful',
      token,
      data: customerData,
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ status: false, message: 'Login failed', error: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required', status: false });
    }

    const { user_name, name, mobile } = req.body;
    const profileImage = req.file?.filename;

    const user = await Customer.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false });
    }

    // Update fields if provided
    if (user_name) user.user_name = user_name;
    if (name) user.name = name;
    if (mobile) user.mobile = mobile;
    if (profileImage) user.profileImage = profileImage;

    const updatedUser = await user.save();

    // Remove password from response
    const userData = updatedUser.toObject();
    delete userData.password;

    return res.status(200).json({
      message: 'Profile updated successfully!',
      status: true,
      data: userData,
    });
  } catch (error) {
    console.error('Error in updateProfile:', error);
    return res.status(500).json({ message: 'Internal Server Error', status: false });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const customer = await Customer.find({}).select('-password');
    if (!customer || customer.length === 0) {
      return res.status(404).json({ status: false, message: 'No customers found' });
    }

    res.status(200).json({ status: true, data: customer });
  } catch (error) {
    console.error('Get Customer Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to get customer', error: error.message });
  }
};

// CREATE CUSTOMER (by Agent/TL/QA)
exports.createCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const agent = await Staff.findById(agentId);

    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const {
      customerId,
      name,
      email,
      mobile,
      alternatePhone,
      governmentId,
      address,
      planType,
      billingType,
      billingCycle,
      validityPeriod,
      activationDate,
      deactivationDate,
      serviceStatus,
      petitionId, // Optional: Link current query to this customer
      notes,
      profileImage,
    } = req.body;

    // Check if email or mobile already exists
    const existing = await Customer.findOne({
      organizationId: agent.organizationId,
      $or: [{ email }, { mobile }],
    });

    if (existing) {
      return res.status(400).json({
        status: false,
        message: existing.email === email ? 'Email already exists' : 'Mobile number already exists',
      });
    }

    // Generate customerId if not provided (BM/8-digits/YY format)
    let finalCustomerId = customerId;
    if (!customerId) {
      const currentYear = new Date().getFullYear();
      const yearSuffix = currentYear.toString().slice(-2); // Get last 2 digits of year

      let isUnique = false;
      while (!isUnique) {
        const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
        finalCustomerId = `BM/${randomDigits}/${yearSuffix}`;

        // Check if this customerId already exists
        const existingCustomer = await Customer.findOne({
          customerId: finalCustomerId,
          organizationId: agent.organizationId,
        });

        if (!existingCustomer) {
          isUnique = true;
        }
      }
    }

    // Generate default password
    const defaultPassword = `Welcome@${Math.floor(1000 + Math.random() * 9000)}`;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // Prepare plan history if plan details provided
    const planHistory = [];
    if (planType && billingType && billingCycle && validityPeriod && activationDate) {
      planHistory.push({
        planType,
        billingType,
        billingCycle,
        validityPeriod,
        activationDate,
        deactivationDate: deactivationDate || null,
        serviceStatus: serviceStatus || 'Active',
        addedAt: new Date(),
        addedBy: agentId,
        notes: notes || null,
      });
    }

    const newCustomer = await Customer.create({
      organizationId: agent.organizationId,
      customerId: finalCustomerId,
      name,
      user_name: email.split('@')[0],
      email,
      mobile,
      alternatePhone,
      password: hashedPassword,
      visiblePassword: defaultPassword,
      customerType: 'registered',
      governmentId,
      address,
      planType,
      billingType,
      billingCycle,
      validityPeriod,
      activationDate,
      deactivationDate,
      serviceStatus: serviceStatus || 'Active',
      planHistory, // Add initial plan to history
      queryHistory: [], // Initialize empty query history
      createdBy: agentId,
      profileImage,
    });

    // If petitionId provided, link query to this customer
    if (petitionId) {
      const Query = require('../models/Query');
      const query = await Query.findOne({
        petitionId,
        organizationId: agent.organizationId,
      });

      if (query) {
        // Add query to customer's history
        newCustomer.queryHistory.push(query._id);
        await newCustomer.save();

        // Update query with customer reference
        query.customer = newCustomer._id;
        query.customerName = newCustomer.name;
        query.customerEmail = newCustomer.email;
        query.customerPhone = newCustomer.mobile;
        query.isGuestCustomer = false;
        await query.save();
      }
    }

    const customerData = newCustomer.toObject();
    delete customerData.password;

    res.status(201).json({
      status: true,
      message: 'Customer created successfully',
      data: customerData,
      defaultPassword, // Send to agent to share with customer
    });
  } catch (error) {
    console.error('Create Customer Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to create customer', error: error.message });
  }
};

// UPDATE CUSTOMER (by Agent/TL/QA)
exports.updateCustomerDetails = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.id;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    const {
      name,
      email,
      mobile,
      alternatePhone,
      governmentId,
      address,
      planType,
      billingType,
      billingCycle,
      validityPeriod,
      activationDate,
      deactivationDate,
      serviceStatus,
      profileImage,
    } = req.body;

    // Update fields
    if (name) customer.name = name;
    if (email) customer.email = email;
    if (mobile) customer.mobile = mobile;
    if (alternatePhone !== undefined) customer.alternatePhone = alternatePhone;
    if (governmentId) customer.governmentId = governmentId;
    if (address) customer.address = address;
    if (planType !== undefined) customer.planType = planType;
    if (billingType !== undefined) customer.billingType = billingType;
    if (billingCycle !== undefined) customer.billingCycle = billingCycle;
    if (validityPeriod !== undefined) customer.validityPeriod = validityPeriod;
    if (activationDate !== undefined) customer.activationDate = activationDate;
    if (deactivationDate !== undefined) customer.deactivationDate = deactivationDate;
    if (serviceStatus !== undefined) customer.serviceStatus = serviceStatus;
    if (profileImage) customer.profileImage = profileImage;

    await customer.save();

    const customerData = customer.toObject();
    delete customerData.password;

    res.status(200).json({
      status: true,
      message: 'Customer updated successfully',
      data: customerData,
    });
  } catch (error) {
    console.error('Update Customer Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to update customer', error: error.message });
  }
};

// DELETE CUSTOMER (by Agent/TL/QA/Admin)
exports.deleteCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.id;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Delete the customer
    await Customer.findByIdAndDelete(customerId);

    res.status(200).json({
      status: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    console.error('Delete Customer Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to delete customer', error: error.message });
  }
};

// SEARCH CUSTOMERS (by Agent/TL/QA)
exports.searchCustomers = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const searchQuery = req.query.q;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    if (!searchQuery) {
      return res.status(400).json({ status: false, message: 'Search query required' });
    }

    const customers = await Customer.find({
      organizationId: agent.organizationId,
      $or: [
        { name: { $regex: searchQuery, $options: 'i' } },
        { email: { $regex: searchQuery, $options: 'i' } },
        { mobile: { $regex: searchQuery, $options: 'i' } },
        { customerId: { $regex: searchQuery, $options: 'i' } },
      ],
    })
      .select('-password')
      .limit(20);

    res.status(200).json({
      status: true,
      data: customers,
    });
  } catch (error) {
    console.error('Search Customers Error:', error);
    res.status(500).json({ status: false, message: 'Search failed', error: error.message });
  }
};

// GET CUSTOMER BY ID
exports.getCustomerById = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.id;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Customer', 'Management', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    }).select('-password');

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    res.status(200).json({
      status: true,
      data: customer,
    });
  } catch (error) {
    console.error('Get Customer By ID Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to get customer', error: error.message });
  }
};

// GET CUSTOMER LIST WITH PAGINATION
exports.getCustomerList = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Management', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const query = {
      organizationId: agent.organizationId,
    };

    // Filter by creator if requested
    const filterByCreator = req.query.filterByCreator === 'true';
    if (filterByCreator) {
      query.createdBy = agentId;
    }

    const total = await Customer.countDocuments(query);
    const customers = await Customer.find(query)
      .select(
        'customerId name email profileImage mobile alternatePhone governmentId address planType billingType billingCycle validityPeriod activationDate deactivationDate serviceStatus createdAt createdBy planHistory queryHistory deviceInfo simNumber simType dateOfBirth gender notes'
      )
      .populate('createdBy', 'name email role')
      .populate('queryHistory', 'petitionId subject status category createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      status: true,
      data: customers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get Customer List Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to get customers', error: error.message });
  }
};

// ==================== QUERY HISTORY MANAGEMENT ====================

// ADD QUERY TO CUSTOMER HISTORY
exports.addQueryToCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, petitionId } = req.body;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // Find customer
    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Find query
    const Query = require('../models/Query');
    const query = await Query.findOne({
      petitionId,
      organizationId: agent.organizationId,
    });

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Check if query is already in customer's history
    if (customer.queryHistory && customer.queryHistory.includes(query._id)) {
      return res
        .status(400)
        .json({ status: false, message: 'Query already linked to this customer' });
    }

    // Add query to customer's history
    if (!customer.queryHistory) {
      customer.queryHistory = [];
    }
    customer.queryHistory.push(query._id);
    await customer.save();

    // Update query customer reference if not set
    if (!query.customer || query.customer.toString() !== customerId) {
      query.customer = customerId;
      query.customerName = customer.name;
      query.customerEmail = customer.email;
      query.customerPhone = customer.mobile;
      await query.save();
    }

    res.status(200).json({
      status: true,
      message: 'Query added to customer history successfully',
      data: { customerId: customer._id, petitionId: query.petitionId },
    });
  } catch (error) {
    console.error('Add Query to Customer Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to add query to customer', error: error.message });
  }
};

// GET CUSTOMER QUERY HISTORY
exports.getCustomerQueryHistory = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.customerId;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Customer', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // If customer role, only allow viewing their own history
    const targetCustomerId = agent.role === 'Customer' ? agentId : customerId;

    const customer = await Customer.findOne({
      _id: targetCustomerId,
      organizationId: agent.organizationId,
    }).populate({
      path: 'queryHistory',
      options: { sort: { createdAt: -1 } },
      populate: {
        path: 'assignedTo',
        select: 'name email role alias',
      },
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    res.status(200).json({
      status: true,
      data: customer.queryHistory || [],
    });
  } catch (error) {
    console.error('Get Customer Query History Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to get query history', error: error.message });
  }
};

// ==================== PLAN HISTORY MANAGEMENT ====================

// ADD NEW PLAN TO CUSTOMER
exports.addPlanToCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.customerId;
    const {
      planType,
      billingType,
      billingCycle,
      validityPeriod,
      activationDate,
      deactivationDate,
      serviceStatus,
      notes,
    } = req.body;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // Validate required fields
    if (!planType || !billingType || !billingCycle || !validityPeriod || !activationDate) {
      return res.status(400).json({
        status: false,
        message:
          'Missing required fields: planType, billingType, billingCycle, validityPeriod, activationDate',
      });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Create new plan object
    const newPlan = {
      planType,
      billingType,
      billingCycle,
      validityPeriod,
      activationDate,
      deactivationDate: deactivationDate || null,
      serviceStatus: serviceStatus || 'Active',
      addedAt: new Date(),
      addedBy: agentId,
      notes: notes || null,
    };

    // Initialize planHistory if not exists
    if (!customer.planHistory) {
      customer.planHistory = [];
    }

    // Add new plan to the beginning (most recent first)
    customer.planHistory.unshift(newPlan);

    // Update legacy fields with the latest plan (for backward compatibility)
    customer.planType = planType;
    customer.billingType = billingType;
    customer.billingCycle = billingCycle;
    customer.validityPeriod = validityPeriod;
    customer.activationDate = activationDate;
    customer.deactivationDate = deactivationDate;
    customer.serviceStatus = serviceStatus || 'Active';

    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Plan added successfully',
      data: customer.planHistory,
    });
  } catch (error) {
    console.error('Add Plan to Customer Error:', error);
    res.status(500).json({ status: false, message: 'Failed to add plan', error: error.message });
  }
};

// UPDATE PLAN IN CUSTOMER HISTORY
exports.updatePlanInHistory = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, planId } = req.params;
    const updateData = req.body;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    const planIndex = customer.planHistory.findIndex((p) => p._id.toString() === planId);
    if (planIndex === -1) {
      return res.status(404).json({ status: false, message: 'Plan not found' });
    }

    // Update plan fields
    const allowedFields = [
      'planType',
      'billingType',
      'billingCycle',
      'validityPeriod',
      'activationDate',
      'deactivationDate',
      'serviceStatus',
      'notes',
    ];
    allowedFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        customer.planHistory[planIndex][field] = updateData[field];
      }
    });

    // If updating the most recent plan, update legacy fields too
    if (planIndex === 0) {
      customer.planType = customer.planHistory[0].planType;
      customer.billingType = customer.planHistory[0].billingType;
      customer.billingCycle = customer.planHistory[0].billingCycle;
      customer.validityPeriod = customer.planHistory[0].validityPeriod;
      customer.activationDate = customer.planHistory[0].activationDate;
      customer.deactivationDate = customer.planHistory[0].deactivationDate;
      customer.serviceStatus = customer.planHistory[0].serviceStatus;
    }

    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Plan updated successfully',
      data: customer.planHistory,
    });
  } catch (error) {
    console.error('Update Plan Error:', error);
    res.status(500).json({ status: false, message: 'Failed to update plan', error: error.message });
  }
};

// GET CUSTOMER PLAN HISTORY
exports.getCustomerPlanHistory = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.customerId;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Customer', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    }).populate('planHistory.addedBy', 'name email role');

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    res.status(200).json({
      status: true,
      data: customer.planHistory || [],
    });
  } catch (error) {
    console.error('Get Plan History Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to get plan history', error: error.message });
  }
};

// DELETE PLAN FROM HISTORY
exports.deletePlanFromHistory = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, planId } = req.params;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Remove the plan from planHistory array
    customer.planHistory = customer.planHistory.filter((plan) => plan._id.toString() !== planId);

    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Plan deleted successfully',
      data: customer.planHistory,
    });
  } catch (error) {
    console.error('Delete Plan Error:', error);
    res.status(500).json({ status: false, message: 'Failed to delete plan', error: error.message });
  }
};

// Find customer by query ID
exports.findCustomerByQuery = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { queryId } = req.params;

    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // Find the query first to get its _id
    const Query = require('../models/Query');
    const query = await Query.findOne({
      petitionId: queryId,
      organizationId: agent.organizationId,
    });

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Find customer with this query in their queryHistory
    const customer = await Customer.findOne({
      organizationId: agent.organizationId,
      queryHistory: query._id,
    }).select(
      '_id customerId name email mobile alternatePhone governmentId address planType billingType billingCycle validityPeriod activationDate deactivationDate serviceStatus createdAt createdBy planHistory queryHistory deviceInfo simNumber simType'
    );

    if (!customer) {
      return res.status(404).json({ status: false, message: 'No customer found for this query' });
    }

    res.status(200).json({
      status: true,
      data: customer,
    });
  } catch (error) {
    console.error('Find Customer By Query Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to find customer', error: error.message });
  }
};

// UPDATE CUSTOMER PROFILE IMAGE (by Agent/TL/QA)
exports.updateCustomerProfileImage = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, imageUrl } = req.body;

    // Validate agent
    const agent = await Staff.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Dev'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    if (!customerId || !imageUrl) {
      return res
        .status(400)
        .json({ status: false, message: 'Customer ID and image URL are required' });
    }

    // Find customer by ID (can be MongoDB _id or customerId field)
    let customer = await Customer.findOne({
      organizationId: agent.organizationId,
      $or: [{ _id: customerId }, { customerId: customerId }],
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Update profile image
    customer.profileImage = imageUrl;
    await customer.save();

    // Remove password from response
    const customerData = customer.toObject();
    delete customerData.password;

    res.status(200).json({
      status: true,
      message: 'Customer profile image updated successfully',
      data: customerData,
    });
  } catch (error) {
    console.error('Update Customer Profile Image Error:', error);
    res
      .status(500)
      .json({ status: false, message: 'Failed to update profile image', error: error.message });
  }
};

// =========================== BULK UPLOAD FROM EXCEL ===========================

/**
 * Bulk Upload Customers from Excel File
 * @route POST /api/customers/bulk-upload
 * @access Private (Admin only)
 */
exports.bulkUploadCustomers = async (req, res) => {
  try {
    // Check if user is Admin or SuperAdmin
    const userRole = req.user?.role;
    if (!userRole || !['Admin', 'SuperAdmin'].includes(userRole)) {
      return res.status(403).json({
        status: false,
        message: 'Access denied. Only Admin can upload customer data.',
      });
    }

    // Check if file is uploaded
    if (!req.file) {
      return res.status(400).json({
        status: false,
        message: 'No file uploaded. Please upload an Excel file.',
      });
    }

    // Get organization ID from admin user
    const organizationId = req.user.organizationId;
    const uploadedBy = req.user.id;

    // Read the uploaded Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const rawData = xlsx.utils.sheet_to_json(worksheet);

    if (!rawData || rawData.length === 0) {
      return res.status(400).json({
        status: false,
        message: 'Excel file is empty or invalid.',
      });
    }

    const results = {
      total: rawData.length,
      successful: [],
      updated: [],
      failed: [],
      skipped: [],
    };

    // Process each row
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNumber = i + 2; // Excel row number (1-indexed + header)

      try {
        // Extract and validate required fields
        const name = row['Name'] || row['Customer Name'] || row['name'];
        const email = row['Email'] || row['email'];
        const mobile = row['Mobile'] || row['Phone'] || row['Primary Phone'] || row['phone'];
        const customerId = row['Customer ID'] || row['customerId'] || row['BM ID'];

        // Validate required fields
        if (!name || !email) {
          results.failed.push({
            row: rowNumber,
            reason: 'Missing required fields: Name and Email are mandatory',
            data: { name, email },
          });
          continue;
        }

        // Check if customer already exists
        const existingCustomer = await Customer.findOne({
          organizationId,
          $or: [
            { email: email.toLowerCase().trim() },
            { mobile: mobile?.trim() },
            { customerId: customerId?.trim() },
          ],
        });

        // Password handling - Optional (only if provided in Excel or use default)
        const providedPassword = row['Password'] || null;
        const defaultPassword = providedPassword || (mobile ? `Cust${mobile.slice(-4)}` : `Cust${customerId?.slice(-4) || Math.floor(1000 + Math.random() * 9000)}`);
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        // Parse plan information
        const planName = row['Plan'] || row['Plan Name'] || row['plan'];
        let planId = null;
        
        if (planName) {
          const plan = await Plan.findOne({
            organizationId,
            name: { $regex: new RegExp(planName, 'i') },
          });
          if (plan) {
            planId = plan._id;
          }
        }

        // Build customer data object
        const customerData = {
          organizationId,
          name: name.trim(),
          user_name: email.split('@')[0],
          email: email.toLowerCase().trim(),
          mobile: mobile?.trim() || null,
          alternatePhone: row['Alternate Phone'] || row['Secondary Phone'] || null,
          password: hashedPassword,
          visiblePassword: defaultPassword,
          customerType: 'registered',
          customerId: customerId?.trim() || null,

          // Address Information
          address: {
            street: row['Address'] || row['Street'] || null,
            city: row['City'] || null,
            state: row['State'] || null,
            postalCode: row['ZIP'] || row['Postal Code'] || null,
            country: row['Country'] || 'USA',
          },

          // Personal Information
          dateOfBirth: row['DOB'] || row['Date of Birth'] ? new Date(row['DOB'] || row['Date of Birth']) : null,
          gender: row['Gender'] || null,

          // Government ID
          governmentId: {
            type: row['ID Type'] || row['Document Type'] || null,
            number: row['ID Number'] || row['Document Number'] || null,
          },

          // Service Information
          planType: planName || null,
          billingType: row['Billing Type'] || row['Plan Type'] || null,
          billingCycle: row['Billing Cycle'] || null,
          activationDate: row['Activation Date'] ? new Date(row['Activation Date']) : null,
          serviceStatus: row['Status'] || row['Service Status'] || 'Active',

          // Device Information
          deviceInfo: {
            model: row['Device'] || row['Device Model'] || null,
            imei: row['IMEI'] || null,
          },

          // SIM Information
          simNumber: row['SIM Number'] || row['SIM'] || null,
          simType: row['SIM Type'] || null,

          // Notes
          notes: row['Notes'] || null,
        };

        // Add plan to planHistory if plan exists
        if (planId && planName) {
          customerData.planHistory = [
            {
              planType: planName,
              billingType: row['Billing Type'] || 'Prepaid',
              billingCycle: row['Billing Cycle'] || 'Monthly',
              validityPeriod: row['Validity'] || '30 Days',
              activationDate: row['Activation Date'] ? new Date(row['Activation Date']) : new Date(),
              serviceStatus: row['Status'] || 'Active',
              addedBy: uploadedBy,
              notes: 'Added via bulk upload',
            },
          ];
        }

        // Create or Update the customer
        let customer;
        let isUpdate = false;

        if (existingCustomer) {
          // Update existing customer - manually update to handle nested objects properly
          existingCustomer.name = customerData.name;
          existingCustomer.user_name = customerData.user_name;
          existingCustomer.email = customerData.email;
          existingCustomer.mobile = customerData.mobile;
          existingCustomer.alternatePhone = customerData.alternatePhone;
          existingCustomer.customerId = customerData.customerId;
          existingCustomer.customerType = customerData.customerType;
          existingCustomer.dateOfBirth = customerData.dateOfBirth;
          existingCustomer.gender = customerData.gender;
          existingCustomer.planType = customerData.planType;
          existingCustomer.billingType = customerData.billingType;
          existingCustomer.billingCycle = customerData.billingCycle;
          existingCustomer.activationDate = customerData.activationDate;
          existingCustomer.serviceStatus = customerData.serviceStatus;
          
          // Update nested objects
          existingCustomer.address = customerData.address;
          existingCustomer.governmentId = customerData.governmentId;
          existingCustomer.deviceInfo = customerData.deviceInfo;
          existingCustomer.simNumber = customerData.simNumber;
          existingCustomer.simType = customerData.simType;
          existingCustomer.notes = customerData.notes;
          
          // Update plan history if provided
          if (customerData.planHistory && customerData.planHistory.length > 0) {
            existingCustomer.planHistory = existingCustomer.planHistory || [];
            existingCustomer.planHistory.push(...customerData.planHistory);
          }
          
          customer = await existingCustomer.save();
          isUpdate = true;
        } else {
          // Create new customer
          customer = await Customer.create(customerData);
        }

        console.log(`✅ ${isUpdate ? 'Updated' : 'Created'} customer: ${customer.email} (ID: ${customer._id})`);

        const resultData = {
          row: rowNumber,
          customerId: customer.customerId || customer._id,
          name: customer.name,
          email: customer.email,
          mobile: customer.mobile,
          defaultPassword: defaultPassword,
        };

        if (isUpdate) {
          results.updated.push(resultData);
        } else {
          results.successful.push(resultData);
        }
      } catch (error) {
        console.error(`❌ Failed to process row ${rowNumber}:`, error.message);
        results.failed.push({
          row: rowNumber,
          reason: error.message,
          data: row,
        });
      }
    }

    // Log summary
    console.log('\n📊 Bulk Upload Summary:');
    console.log(`   Total Rows: ${results.total}`);
    console.log(`   ✅ New Customers: ${results.successful.length}`);
    console.log(`   🔄 Updated Customers: ${results.updated.length}`);
    console.log(`   ❌ Failed: ${results.failed.length}`);
    console.log(`   ⏭️  Skipped: ${results.skipped.length}\n`);

    // Send response
    res.status(200).json({
      status: true,
      message: 'Bulk upload completed',
      results: {
        total: results.total,
        successful: results.successful.length,
        updated: results.updated.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
      },
      details: {
        successful: results.successful,
        updated: results.updated,
        failed: results.failed,
        skipped: results.skipped,
      },
    });
  } catch (error) {
    console.error('Bulk Upload Error:', error);
    res.status(500).json({
      status: false,
      message: 'Bulk upload failed',
      error: error.message,
    });
  }
};

/**
 * Download Excel Template for Bulk Upload
 * @route GET /api/customers/download-template
 * @access Private (Admin only)
 */
exports.downloadBulkUploadTemplate = async (req, res) => {
  try {
    // Create sample template data
    const templateData = [
      {
        'Customer ID': 'BM100001',
        'Name': 'John Doe',
        'Email': 'john.doe@example.com',
        'Mobile': '+1-555-123-4567',
        'Alternate Phone': '+1-555-987-6543',
        'Address': '123 Main St',
        'City': 'New York',
        'State': 'NY',
        'ZIP': '10001',
        'Country': 'USA',
        'Gender': 'Male',
        'DOB': '1990-01-15',
        'Plan': '$50 Unlimited',
        'Billing Type': 'Prepaid',
        'Billing Cycle': 'Monthly',
        'Status': 'Active',
        'Activation Date': '2025-01-01',
        'Device': 'iPhone 13',
        'SIM Number': 'SIM123456789',
        'SIM Type': 'Physical',
        'IMEI': '123456789012345',
        'ID Type': 'Passport',
        'ID Number': 'P12345678',
        'Notes': 'Sample customer data',
      },
    ];

    // Create workbook and worksheet
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(templateData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 12 }, // Customer ID
      { wch: 20 }, // Name
      { wch: 25 }, // Email
      { wch: 18 }, // Mobile
      { wch: 18 }, // Alternate Phone
      { wch: 30 }, // Address
      { wch: 15 }, // City
      { wch: 8 },  // State
      { wch: 10 }, // ZIP
      { wch: 10 }, // Country
      { wch: 10 }, // Gender
      { wch: 12 }, // DOB
      { wch: 18 }, // Plan
      { wch: 12 }, // Billing Type
      { wch: 14 }, // Billing Cycle
      { wch: 10 }, // Status
      { wch: 16 }, // Activation Date
      { wch: 18 }, // Device
      { wch: 16 }, // SIM Number
      { wch: 12 }, // SIM Type
      { wch: 18 }, // IMEI
      { wch: 12 }, // ID Type
      { wch: 15 }, // ID Number
      { wch: 30 }, // Notes
    ];

    xlsx.utils.book_append_sheet(workbook, worksheet, 'Customer Template');

    // Generate buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers
    res.setHeader('Content-Disposition', 'attachment; filename=customer_bulk_upload_template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    res.send(buffer);
  } catch (error) {
    console.error('Download Template Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to download template',
      error: error.message,
    });
  }
};
