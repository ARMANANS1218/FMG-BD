const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

// Import models
const User = require('./src/models/User');
const Organization = require('./src/models/Organization');

const seedUsers = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected for seeding');

    // Hash password
    const hashedPassword = await bcrypt.hash('An183890@#', 10);

    // Step 1: Create or get default organization
    let organization = await Organization.findOne({ organizationId: 'ORG-SEED-001' });
    
    if (!organization) {
      const apiKey = crypto.randomBytes(32).toString('hex');
      organization = new Organization({
        organizationId: 'ORG-SEED-001',
        name: 'Default Organization',
        displayName: 'Default Org',
        domain: 'default.local',
        apiKey: apiKey,
        subscription: {
          plan: 'enterprise',
          status: 'active',
          startDate: new Date(),
          maxUsers: 100,
          maxCustomers: 1000,
        },
        features: {
          chat: { enabled: true, maxConcurrentChats: 100 },
          email: { enabled: true, maxEmailsPerMonth: 10000 },
          query: { enabled: true, maxQueriesPerMonth: 5000 },
          videoCalls: { enabled: true, maxCallDuration: 60, maxCallsPerMonth: 500 },
          audioCalls: { enabled: true, maxCallDuration: 60, maxCallsPerMonth: 1000 },
          analytics: { enabled: true, advancedReports: true },
          customBranding: { enabled: true, whiteLabel: true },
          apiAccess: { enabled: true, rateLimitPerMinute: 120 },
        },
        isActive: true,
      });
      await organization.save();
      console.log('✅ Default organization created: ORG-SEED-001');
    } else {
      console.log('ℹ️  Default organization already exists');
    }

    const orgId = organization._id;

    // Check if users already exist
    const existingAdmin = await User.findOne({ email: 'armanansarig813@gmail.com' });
    const existingAgent = await User.findOne({ email: 'armanansarig814@gmail.com' });
    const existingQA = await User.findOne({ email: 'armanansarig815@gmail.com' });
    const existingCustomer = await User.findOne({ email: 'armanansarig816@gmail.com', role: 'Customer' });

    // Seed Admin
    if (!existingAdmin) {
      const admin = new User({
        organizationId: orgId,
        employee_id: 'EMP1001',
        user_name: 'admin_user',
        name: 'Admin User',
        email: 'armanansarig813@gmail.com',
        password: hashedPassword,
        role: 'Admin',
        mobile: '1234567890',
        is_active: true,
      });
      await admin.save();
      console.log('✅ Admin user created: EMP1001');
    } else {
      console.log('ℹ️  Admin user already exists: EMP1001');
    }

    // Seed Agent
    if (!existingAgent) {
      const agent = new User({
        organizationId: orgId,
        employee_id: 'EMP1002',
        user_name: 'agent_user',
        name: 'Agent User',
        email: 'armanansarig814@gmail.com',
        password: hashedPassword,
        role: 'Agent',
        mobile: '1234567891',
        is_active: true,
      });
      await agent.save();
      console.log('✅ Agent user created: EMP1002');
    } else {
      console.log('ℹ️  Agent user already exists: EMP1002');
    }

    // Seed QA
    if (!existingQA) {
      const qa = new User({
        organizationId: orgId,
        employee_id: 'EMP1003',
        user_name: 'qa_user',
        name: 'QA User',
        email: 'armanansarig815@gmail.com',
        password: hashedPassword,
        role: 'QA',
        mobile: '1234567892',
        is_active: true,
      });
      await qa.save();
      console.log('✅ QA user created: EMP1003');
    } else {
      console.log('ℹ️  QA user already exists: EMP1003');
    }

    // Seed Customer
    if (!existingCustomer) {
      const customer = new User({
        organizationId: orgId,
        user_name: 'customer_user',
        name: 'Customer User',
        email: 'armanansarig816@gmail.com',
        password: hashedPassword,
        mobile: '1234567893',
        role: 'Customer',
        is_active: true,
        customerType: 'registered',
      });
      await customer.save();
      console.log('✅ Customer user created');
    } else {
      console.log('ℹ️  Customer user already exists');
    }

    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n📝 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ADMIN:');
    console.log('  Employee ID: EMP1001');
    console.log('  Email: armanansarig813@gmail.com');
    console.log('  Password: An183890@#');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('AGENT:');
    console.log('  Employee ID: EMP1002');
    console.log('  Email: armanansarig814@gmail.com');
    console.log('  Password: An183890@#');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('QA:');
    console.log('  Employee ID: EMP1003');
    console.log('  Email: armanansarig815@gmail.com');
    console.log('  Password: An183890@#');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('CUSTOMER:');
    console.log('  Email: armanansarig816@gmail.com');
    console.log('  Password: An183890@#');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedUsers();
