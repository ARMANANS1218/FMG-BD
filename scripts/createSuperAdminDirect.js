require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../src/models/User');

const createSuperAdmin = async () => {
  try {
    // MongoDB connection
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/chat-crm';

    console.log('\n═══════════════════════════════════════');
    console.log('   CREATE SUPERADMIN USER');
    console.log('═══════════════════════════════════════\n');

    console.log('📡 Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Check if SuperAdmin already exists
    const existingSuperAdmin = await User.findOne({ role: 'SuperAdmin' });
    if (existingSuperAdmin) {
      console.log('⚠️  SuperAdmin already exists!');
      console.log(`📧 Email: ${existingSuperAdmin.email}`);
      console.log(`👤 Name: ${existingSuperAdmin.name}\n`);
      process.exit(0);
    }

    // Create SuperAdmin
    const superAdminData = {
      user_name: 'superadmin_arman',
      name: 'Super Admin Arman',
      email: 'arman.bitmax@gmail.com',
      password: 'An183890@#',
      mobile: '+447123456789', // Optional
      role: 'SuperAdmin'
      // No organizationId for SuperAdmin
    };

    console.log('🔐 Hashing password...');
    const hashedPassword = await bcrypt.hash(superAdminData.password, 10);

    console.log('👤 Creating SuperAdmin user...');
    const superAdmin = await User.create({
      user_name: superAdminData.user_name,
      name: superAdminData.name,
      email: superAdminData.email,
      password: hashedPassword,
      mobile: superAdminData.mobile,
      role: superAdminData.role
    });

    console.log('\n✅ SuperAdmin created successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📋 LOGIN CREDENTIALS');
    console.log('═══════════════════════════════════════');
    console.log(`👤 Name     : ${superAdmin.name}`);
    console.log(`📧 Email    : ${superAdmin.email}`);
    console.log(`🔑 Password : An183890@#`);
    console.log(`🆔 Role     : ${superAdmin.role}`);
    console.log('═══════════════════════════════════════\n');
    console.log('🚀 Next Steps:');  
    console.log('1. Login at: POST http://localhost:5000/api/v1/user/login');
    console.log('2. Create organizations via SuperAdmin API');
    console.log('3. Refer to QUICK_START_GUIDE.md for full workflow\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating SuperAdmin:', error.message);
    process.exit(1);
  }
};

createSuperAdmin();
