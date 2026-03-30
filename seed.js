const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

// Import models
const Staff = require('./src/models/Staff');
const Organization = require('./src/models/Organization');

const seedUsers = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('? MongoDB Connected for seeding');

    // Hash password
    const hashedPassword = await bcrypt.hash('An183890@#', 10);

    // Step 1: Create or get default organization
    let organization = await Organization.findOne({ organizationId: 'ORG-001' });

    if (!organization) {
      const apiKey = crypto.randomBytes(32).toString('hex');
      organization = new Organization({
        organizationId: 'ORG-001',
        name: 'FMG',
        displayName: 'FMG',
        domain: 'fmg.local',
        adminEmail: 'arman.bitmax@gmail.com',
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
      console.log('? Default organization created: ORG-001');
    } else {
      console.log('?? Default organization already exists');
    }

    const orgId = organization._id;

    // Check if user already exists
    const existingSuperAdmin = await Staff.findOne({ email: 'arman.bitmax@gmail.com' });

    // Seed SuperAdmin
    if (!existingSuperAdmin) {
      const superadmin = new Staff({
        organizationId: orgId,
        employee_id: 'SA1001',
        user_name: 'superadmin_fmg',
        name: 'FMG',
        email: 'arman.bitmax@gmail.com',
        password: hashedPassword,
        role: 'SuperAdmin',
        mobile: '9140797819',
        is_active: true,
      });
      await superadmin.save();
      console.log('? SuperAdmin user created: SA1001');
    } else {
      console.log('?? SuperAdmin user already exists');
    }

    console.log('\n?? Seeding completed successfully!');
    console.log('\n?? Login Credentials:');
    console.log('---------------------------------');
    console.log('SUPERADMIN:');
    console.log('  Name: FMG');
    console.log('  Email: arman.bitmax@gmail.com');
    console.log('  Password: An183890@#');
    console.log('  Phone: 9140797819');
    console.log('  Organization: ORG-001');
    console.log('---------------------------------\n');

    process.exit(0);
  } catch (error) {
    console.error('? Error seeding database:', error);
    process.exit(1);
  }
};

seedUsers();
