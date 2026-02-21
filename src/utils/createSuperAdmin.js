/**
 * Create SuperAdmin account in database
 * Run this to create initial SuperAdmin for production
 * 
 * Usage: node src/utils/createSuperAdmin.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcrypt');
require('dotenv').config();

// ⚠️ CONFIGURE THESE VALUES
const SUPERADMIN_DATA = {
  name: 'Super Admin',
  email: 'superadmin@bitmax.com',
  password: 'SuperAdmin@123', // Change this!
  employee_id: 'SUPERADMIN001',
  user_name: 'superadmin',
  mobile: '9999999999'
};

async function createSuperAdmin() {
  try {
    const dbUri = process.env.CONNECTION_STRING || process.env.MONGO_URI;
    await mongoose.connect(dbUri);
    console.log('✅ Connected to database\n');

    // Check if SuperAdmin already exists
    const existing = await User.findOne({ email: SUPERADMIN_DATA.email });
    if (existing) {
      console.log('⚠️  SuperAdmin already exists with email:', SUPERADMIN_DATA.email);
      console.log('   Name:', existing.name);
      console.log('   Role:', existing.role);
      console.log('\n❌ Aborted: SuperAdmin account already exists');
      process.exit(0);
    }

    // Check if any SuperAdmin exists
    const anySuperAdmin = await User.findOne({ role: 'SuperAdmin' });
    if (anySuperAdmin) {
      console.log('⚠️  A SuperAdmin account already exists:');
      console.log('   Name:', anySuperAdmin.name);
      console.log('   Email:', anySuperAdmin.email);
      console.log('\n💡 If you want to create another SuperAdmin, modify the script');
      process.exit(0);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(SUPERADMIN_DATA.password, 10);

    // Create SuperAdmin
    const superAdmin = await User.create({
      name: SUPERADMIN_DATA.name,
      email: SUPERADMIN_DATA.email,
      password: hashedPassword,
      employee_id: SUPERADMIN_DATA.employee_id,
      user_name: SUPERADMIN_DATA.user_name,
      mobile: SUPERADMIN_DATA.mobile,
      role: 'SuperAdmin',
      is_active: true,
      profileImage: 'not available'
    });

    console.log('✅ SUCCESS! SuperAdmin account created');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Name:', superAdmin.name);
    console.log('Email:', superAdmin.email);
    console.log('Password:', SUPERADMIN_DATA.password);
    console.log('Employee ID:', superAdmin.employee_id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 Next Steps:');
    console.log('1. Login to SuperAdmin panel: /superadmin/login');
    console.log('2. Create an Organization');
    console.log('3. Create Admin for that Organization');
    console.log('4. ⚠️  IMPORTANT: Change the password after first login!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  }
}

createSuperAdmin();
