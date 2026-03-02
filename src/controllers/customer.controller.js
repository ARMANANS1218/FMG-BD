const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


// REGISTER
exports.customerRegister = async (req, res) => {
  const { name, email, password, mobile } = req.body;

  try {
    const existingUser = await User.findOne({
      $or: [{ email }, { mobile }]
    });

    if (existingUser) {
      return res.status(400).json({
        status: false,
        message: existingUser.email === email
          ? 'Email is already registered.'
          : 'Mobile number is already registered.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newCustomer = await User.create({
      name,
      user_name: email.split('@')[0], // Generate username from email
      email,
      mobile,
      password: hashedPassword,
      role: 'Customer'
    });

    res.status(201).json({
      status: true,
      message: 'Customer registered successfully',
      data: newCustomer
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ status: false, message: 'Registration failed', error: error.message });
  }
};
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select('-password');
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
    const customer = await User.findOne({ email, role: 'Customer' });
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
      { id: customer._id, role: customer.role },
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
      data: customerData
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

    const {
      user_name, name, mobile,
      customerType, address, governmentId
    } = req.body;
    const profileImage = req.file?.filename;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false });
    }

    // Only allow customers to update their own profile
    if (user.role !== 'Customer') {
      return res.status(403).json({ message: 'Only customers can use this endpoint', status: false });
    }

    // Update fields if provided
    if (user_name) user.user_name = user_name;
    if (name) user.name = name;
    if (mobile) user.mobile = mobile;
    if (profileImage) user.profileImage = profileImage;

    // Airline CRM Fields updates
    if (customerType) user.customerType = customerType;
    if (address) user.address = { ...user.address, ...address };
    if (governmentId) user.governmentId = { ...user.governmentId, ...governmentId };

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
    const customer = await User.find({ role: 'Customer' }).select('-password');
    if (!customer || customer.length === 0) {
      return res.status(404).json({ status: false, message: 'No customers found' });
    }

    res.status(200).json({ status: true, data: customer });
  } catch (error) {
    console.error('Get Customer Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get customer', error: error.message });
  }
};

// CREATE CUSTOMER (by Agent/TL/QA)
exports.createCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const agent = await User.findById(agentId);

    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const {
      customerId,
      name,
      email,
      mobile,
      alternatePhone,
      dateOfBirth,
      gender,
      preferredContactMethod,
      customerType,
      vulnerableCustomerFlag,
      address,
      petitionId, // Optional: Link current query to this customer
      agentNotes,
      profileImage
    } = req.body;

    // Validate required fields
    if (!name || !email || !mobile) {
      return res.status(400).json({
        status: false,
        message: 'Name, email, and mobile are required'
      });
    }

    // Check if email or mobile already exists
    const existing = await User.findOne({
      organizationId: agent.organizationId,
      $or: [{ email }, { mobile }]
    });

    if (existing) {
      return res.status(400).json({
        status: false,
        message: existing.email === email ? 'Email already exists' : 'Mobile number already exists'
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
        const existingCustomer = await User.findOne({
          customerId: finalCustomerId,
          organizationId: agent.organizationId
        });

        if (!existingCustomer) {
          isUnique = true;
        }
      }
    }

    // Generate default password
    const defaultPassword = `Welcome@${Math.floor(1000 + Math.random() * 9000)}`;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // Clean emergency contact

    if (address && (address.postCode || address.postcode)) {
      address.postalCode = address.postCode || address.postcode;
      delete address.postCode;
      delete address.postcode;
    }

    const newCustomer = await User.create({
      organizationId: agent.organizationId,
      customerId: finalCustomerId,
      name,
      user_name: email.split('@')[0],
      email,
      mobile,
      alternatePhone: alternatePhone || null,
      password: hashedPassword,
      visiblePassword: defaultPassword, // Store for recovery
      role: 'Customer',
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      preferredContactMethod: preferredContactMethod || 'Email',
      customerType: customerType || 'End Consumer',
      vulnerableCustomerFlag: vulnerableCustomerFlag || false,
      address: address || null,
      agentNotes: agentNotes || null,
      queryHistory: [], // Initialize empty query history
      createdBy: agentId,
      profileImage: profileImage || null
    });

    // If petitionId provided, link query to this customer
    if (petitionId) {
      const Query = require('../models/Query');
      const query = await Query.findOne({
        petitionId,
        organizationId: agent.organizationId
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
      defaultPassword // Send to agent to share with customer
    });
  } catch (error) {
    console.error('Create Customer Error:', error);
    res.status(500).json({ status: false, message: 'Failed to create customer', error: error.message });
  }
};

// UPDATE CUSTOMER (by Agent/TL/QA)
exports.updateCustomerDetails = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.id;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }
    const {
      name,
      email,
      mobile,
      alternatePhone,
      dateOfBirth,
      gender,
      preferredContactMethod,
      customerType,
      vulnerableCustomerFlag,
      address,
      agentNotes,
      profileImage,
    } = req.body;

    // Update fields
    if (name) customer.name = name;
    if (email) customer.email = email;
    if (mobile) customer.mobile = mobile;
    if (alternatePhone !== undefined) customer.alternatePhone = alternatePhone;

    // Airline Fields
    if (dateOfBirth) customer.dateOfBirth = dateOfBirth;
    if (gender) customer.gender = gender;
    if (preferredContactMethod) customer.preferredContactMethod = preferredContactMethod;
    if (customerType) customer.customerType = customerType;
    if (vulnerableCustomerFlag !== undefined) customer.vulnerableCustomerFlag = vulnerableCustomerFlag;
    if (agentNotes !== undefined) customer.agentNotes = agentNotes;


    if (address) {
      if (address.postCode || address.postcode) {
        address.postalCode = address.postCode || address.postcode;
        delete address.postCode;
        delete address.postcode;
      }
      customer.address = {
        ...(customer.address || {}),
        ...address
      };
    }
    if (profileImage) customer.profileImage = profileImage;

    await customer.save();

    const customerData = customer.toObject();
    delete customerData.password;

    res.status(200).json({
      status: true,
      message: 'Customer updated successfully',
      data: customerData
    });
  } catch (error) {
    console.error('Update Customer Error:', error);
    res.status(500).json({ status: false, message: 'Failed to update customer', error: error.message });
  }
};

// DELETE CUSTOMER (by Agent/TL/QA/Admin)
exports.deleteCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.id;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Delete the customer
    await User.findByIdAndDelete(customerId);

    res.status(200).json({
      status: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Delete Customer Error:', error);
    res.status(500).json({ status: false, message: 'Failed to delete customer', error: error.message });
  }
};

// SEARCH CUSTOMERS (by Agent/TL/QA)
exports.searchCustomers = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const searchQuery = req.query.q;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    if (!searchQuery) {
      return res.status(400).json({ status: false, message: 'Search query required' });
    }

    const customers = await User.find({
      organizationId: agent.organizationId,
      role: 'Customer',
      $or: [
        { name: { $regex: searchQuery, $options: 'i' } },
        { email: { $regex: searchQuery, $options: 'i' } },
        { mobile: { $regex: searchQuery, $options: 'i' } },
        { customerId: { $regex: searchQuery, $options: 'i' } }
      ]
    }).select('-password').limit(20);

    res.status(200).json({
      status: true,
      data: customers
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

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Customer'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    }).select('-password');

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    res.status(200).json({
      status: true,
      data: customer
    });
  } catch (error) {
    console.error('Get Customer By ID Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get customer', error: error.message });
  }
};

// GET CUSTOMER LIST WITH PAGINATION
exports.getCustomerList = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const query = {
      organizationId: agent.organizationId,
      role: 'Customer'
    };

    // Filter by creator if requested
    const filterByCreator = req.query.filterByCreator === 'true';
    if (filterByCreator) {
      query.createdBy = agentId;
    }

    const total = await User.countDocuments(query);
    const customers = await User.find(query)
      .select('customerId name email profileImage mobile alternatePhone governmentId address planType billingType billingCycle validityPeriod activationDate deactivationDate serviceStatus createdAt createdBy planHistory queryHistory')
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
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get Customer List Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get customers', error: error.message });
  }
};

// ==================== QUERY HISTORY MANAGEMENT ====================

// ADD QUERY TO CUSTOMER HISTORY
exports.addQueryToCustomer = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, petitionId } = req.body;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // Find customer
    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Find query
    const Query = require('../models/Query');
    const query = await Query.findOne({
      petitionId,
      organizationId: agent.organizationId
    });

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Check if query is already in customer's history
    if (customer.queryHistory && customer.queryHistory.includes(query._id)) {
      return res.status(400).json({ status: false, message: 'Query already linked to this customer' });
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
      data: { customerId: customer._id, petitionId: query.petitionId }
    });
  } catch (error) {
    console.error('Add Query to Customer Error:', error);
    res.status(500).json({ status: false, message: 'Failed to add query to customer', error: error.message });
  }
};

// GET CUSTOMER QUERY HISTORY
exports.getCustomerQueryHistory = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const customerId = req.params.customerId;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Customer'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // If customer role, only allow viewing their own history
    const targetCustomerId = agent.role === 'Customer' ? agentId : customerId;

    const customer = await User.findOne({
      _id: targetCustomerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    }).populate({
      path: 'queryHistory',
      options: { sort: { createdAt: -1 } },
      populate: {
        path: 'assignedTo',
        select: 'name email role alias'
      }
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    res.status(200).json({
      status: true,
      data: customer.queryHistory || []
    });
  } catch (error) {
    console.error('Get Customer Query History Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get query history', error: error.message });
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
      notes
    } = req.body;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // Validate required fields
    if (!planType || !billingType || !billingCycle || !validityPeriod || !activationDate) {
      return res.status(400).json({
        status: false,
        message: 'Missing required fields: planType, billingType, billingCycle, validityPeriod, activationDate'
      });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
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
      notes: notes || null
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
      data: customer.planHistory
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

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    const planIndex = customer.planHistory.findIndex(p => p._id.toString() === planId);
    if (planIndex === -1) {
      return res.status(404).json({ status: false, message: 'Plan not found' });
    }

    // Update plan fields
    const allowedFields = ['planType', 'billingType', 'billingCycle', 'validityPeriod', 'activationDate', 'deactivationDate', 'serviceStatus', 'notes'];
    allowedFields.forEach(field => {
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
      data: customer.planHistory
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

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin', 'Customer'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    }).populate('planHistory.addedBy', 'name email role');

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    res.status(200).json({
      status: true,
      data: customer.planHistory || []
    });
  } catch (error) {
    console.error('Get Plan History Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get plan history', error: error.message });
  }
};

// DELETE PLAN FROM HISTORY
exports.deletePlanFromHistory = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, planId } = req.params;

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: agent.organizationId,
      role: 'Customer'
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // Remove the plan from planHistory array
    customer.planHistory = customer.planHistory.filter(
      plan => plan._id.toString() !== planId
    );

    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Plan deleted successfully',
      data: customer.planHistory
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

    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    // Find the query first to get its _id
    const Query = require('../models/Query');
    const query = await Query.findOne({ petitionId: queryId, organizationId: agent.organizationId });

    if (!query) {
      return res.status(404).json({ status: false, message: 'Query not found' });
    }

    // Find customer with this query in their queryHistory
    const customer = await User.findOne({
      organizationId: agent.organizationId,
      role: 'Customer',
      queryHistory: query._id
    }).select('_id customerId name email mobile alternatePhone governmentId address planType billingType billingCycle validityPeriod activationDate deactivationDate serviceStatus createdAt createdBy planHistory queryHistory');

    if (!customer) {
      return res.status(404).json({ status: false, message: 'No customer found for this query' });
    }

    res.status(200).json({
      status: true,
      data: customer
    });
  } catch (error) {
    console.error('Find Customer By Query Error:', error);
    res.status(500).json({ status: false, message: 'Failed to find customer', error: error.message });
  }
};

// UPDATE CUSTOMER PROFILE IMAGE (by Agent/TL/QA)
exports.updateCustomerProfileImage = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { customerId, imageUrl } = req.body;

    // Validate agent
    const agent = await User.findById(agentId);
    if (!agent || !['Agent', 'TL', 'QA', 'Admin'].includes(agent.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    if (!customerId || !imageUrl) {
      return res.status(400).json({ status: false, message: 'Customer ID and image URL are required' });
    }

    // Find customer by ID (can be MongoDB _id or customerId field)
    let customer = await User.findOne({
      organizationId: agent.organizationId,
      role: 'Customer',
      $or: [{ _id: customerId }, { customerId: customerId }]
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
      data: customerData
    });
  } catch (error) {
    console.error('Update Customer Profile Image Error:', error);
    res.status(500).json({ status: false, message: 'Failed to update profile image', error: error.message });
  }
};

// ==================== GDPR COMPLIANCE ====================

// REQUEST DATA DELETION
exports.requestDataDeletion = async (req, res) => {
  try {
    const customerId = req.params.id;
    // Both the customer themselves and agents should be able to trigger this request. 
    // Usually it goes into a pending state.
    const userId = req.user?.id;
    const user = await User.findById(userId);

    const customer = await User.findOne({ _id: customerId, role: 'Customer' });
    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    // If customer role, only allow modifying their own profile
    if (user.role === 'Customer' && String(customer._id) !== String(user._id)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    customer.dataDeleteRequest = true;
    customer.dataDeleteRequestDate = new Date();
    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Data deletion request submitted successfully',
    });
  } catch (error) {
    console.error('Data Deletion Request Error:', error);
    res.status(500).json({ status: false, message: 'Failed to submit data deletion request', error: error.message });
  }
};

// REQUEST SUBJECT ACCESS (SAR)
exports.requestSubjectAccess = async (req, res) => {
  try {
    const customerId = req.params.id;
    const userId = req.user?.id;
    const user = await User.findById(userId);

    const customer = await User.findOne({ _id: customerId, role: 'Customer' });
    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    if (user.role === 'Customer' && String(customer._id) !== String(user._id)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    customer.subjectAccessRequest = true;
    customer.subjectAccessRequestDate = new Date();
    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Subject Access Request (SAR) submitted successfully',
    });
  } catch (error) {
    console.error('SAR Request Error:', error);
    res.status(500).json({ status: false, message: 'Failed to submit SAR', error: error.message });
  }
};

// UPDATE CONSENT
exports.updateConsent = async (req, res) => {
  try {
    const customerId = req.params.id;
    const userId = req.user?.id;
    const user = await User.findById(userId);
    const { captured, gdprStatementVersion } = req.body;

    const customer = await User.findOne({ _id: customerId, role: 'Customer' });
    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    if (user.role === 'Customer' && String(customer._id) !== String(user._id)) {
      return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    customer.consentCaptured = {
      captured: captured !== undefined ? captured : true,
      timestamp: new Date(),
      gdprStatementVersion: gdprStatementVersion || customer.consentCaptured?.gdprStatementVersion || '1.0'
    };

    await customer.save();

    res.status(200).json({
      status: true,
      message: 'Consent updated successfully',
    });
  } catch (error) {
    console.error('Update Consent Error:', error);
    res.status(500).json({ status: false, message: 'Failed to update consent', error: error.message });
  }
};

// GET GDPR REQUESTS (Admin/DPO)
exports.getPendingGdprRequests = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId);

    const statusFilter = req.query.status || 'Pending';

    // Typically only Admins or specific compliance roles should access this.
    if (!admin || !['Admin', 'Management'].includes(admin.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized: Admin access required' });
    }

    let queryConditions = [];

    if (statusFilter === 'Pending') {
      queryConditions = [
        { dataDeleteRequest: true, dataDeleteRequestStatus: 'Pending' },
        { subjectAccessRequest: true, subjectAccessRequestStatus: 'Pending' }
      ];
    } else if (statusFilter === 'Resolved') {
      queryConditions = [
        { dataDeleteRequest: true, dataDeleteRequestStatus: 'Resolved' },
        { subjectAccessRequest: true, subjectAccessRequestStatus: 'Resolved' }
      ];
    } else { // All
      queryConditions = [
        { dataDeleteRequest: true },
        { subjectAccessRequest: true }
      ];
    }

    const requests = await User.find({
      organizationId: admin.organizationId,
      role: 'Customer',
      $or: queryConditions
    }).select('name email mobile customerId dataDeleteRequest dataDeleteRequestDate dataDeleteRequestStatus subjectAccessRequest subjectAccessRequestDate subjectAccessRequestStatus consentCaptured');

    res.status(200).json({
      status: true,
      data: requests
    });
  } catch (error) {
    console.error('Get GDPR Requests Error:', error);
    res.status(500).json({ status: false, message: 'Failed to get GDPR requests', error: error.message });
  }
};

// RESOLVE GDPR REQUEST (Admin/DPO)
exports.resolveGdprRequest = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const customerId = req.params.id;
    const { requestType } = req.body; // 'Deletion' or 'SAR'

    const admin = await User.findById(adminId);
    if (!admin || !['Admin', 'Management'].includes(admin.role)) {
      return res.status(403).json({ status: false, message: 'Unauthorized: Admin access required' });
    }

    const customer = await User.findOne({
      _id: customerId,
      organizationId: admin.organizationId,
      role: 'Customer'
    });

    if (!customer) {
      return res.status(404).json({ status: false, message: 'Customer not found' });
    }

    if (requestType === 'Deletion') {
      customer.dataDeleteRequestStatus = 'Resolved';
    } else if (requestType === 'SAR') {
      customer.subjectAccessRequestStatus = 'Resolved';
    } else {
      return res.status(400).json({ status: false, message: 'Invalid request type. Must be Deletion or SAR.' });
    }

    await customer.save();

    res.status(200).json({
      status: true,
      message: `${requestType} request resolved successfully.`
    });

  } catch (error) {
    console.error('Resolve GDPR Request Error:', error);
    res.status(500).json({ status: false, message: 'Failed to resolve GDPR request', error: error.message });
  }
};
