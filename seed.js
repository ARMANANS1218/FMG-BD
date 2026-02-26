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

    // =====================================================
    // Create FMG organization + SuperAdmin
    // =====================================================
    let fmgOrg = await Organization.findOne({ organizationId: 'ORG-FMG-001' });

    if (!fmgOrg) {
      const fmgApiKey = crypto.randomBytes(32).toString('hex');
      fmgOrg = new Organization({
        organizationId: 'ORG-FMG-001',
        name: 'FMG',
        displayName: 'FMG',
        domain: 'fmg.local',
        adminEmail: 'arman.bitmax@gmail.com',
        apiKey: fmgApiKey,
        subscription: {
          plan: 'enterprise',
          status: 'active',
          startDate: new Date(),
          maxUsers: 500,
          maxCustomers: 10000,
        },
        features: {
          chat: { enabled: true, maxConcurrentChats: 200 },
          email: { enabled: true, maxEmailsPerMonth: 50000 },
          query: { enabled: true, maxQueriesPerMonth: 20000 },
          videoCalls: { enabled: true, maxCallDuration: 120, maxCallsPerMonth: 2000 },
          audioCalls: { enabled: true, maxCallDuration: 120, maxCallsPerMonth: 5000 },
          analytics: { enabled: true, advancedReports: true },
          customBranding: { enabled: true, whiteLabel: true },
          apiAccess: { enabled: true, rateLimitPerMinute: 300 },
        },
        isActive: true,
      });
      await fmgOrg.save();
      console.log('✅ FMG organization created: ORG-FMG-001');
    } else {
      console.log('ℹ️  FMG organization already exists');
    }

    const fmgOrgId = fmgOrg._id;

    // Seed SuperAdmin for FMG
    const existingSuperAdmin = await User.findOne({ email: 'arman.bitmax@gmail.com' });
    if (!existingSuperAdmin) {
      const superAdmin = new User({
        organizationId: fmgOrgId,
        employee_id: 'FMG-SA-001',
        user_name: 'superadmin_fmg',
        name: 'FMG SuperAdmin',
        email: 'arman.bitmax@gmail.com',
        password: hashedPassword,
        role: 'SuperAdmin',
        mobile: '+447911123456',
        is_active: true,
      });
      await superAdmin.save();
      console.log('✅ FMG SuperAdmin created: arman.bitmax@gmail.com');
    } else {
      console.log('ℹ️  FMG SuperAdmin already exists');
    }

    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n📝 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUPERADMIN (FMG):');
    console.log('  Employee ID: FMG-SA-001');
    console.log('  Email: arman.bitmax@gmail.com');
    console.log('  Password: An183890@#');
    console.log('  Organization: FMG (ORG-FMG-001)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedUsers();
