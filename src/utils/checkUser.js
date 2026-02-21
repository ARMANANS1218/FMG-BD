/**
 * Check if user exists and show details
 * Usage: node src/utils/checkUser.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function checkUser() {
  try {
    const dbUri = process.env.CONNECTION_STRING || process.env.MONGO_URI;
    await mongoose.connect(dbUri);
    console.log('✅ Connected to database\n');

    // Search by employee_id
    console.log('🔍 Searching for employee_id: EMP1001');
    const userByEmpId = await User.findOne({ employee_id: 'EMP1001' });
    if (userByEmpId) {
      console.log('✅ Found user by employee_id:');
      console.log('   Name:', userByEmpId.name);
      console.log('   Email:', userByEmpId.email);
      console.log('   Role:', userByEmpId.role);
      console.log('   Organization ID:', userByEmpId.organizationId || 'NOT SET ⚠️');
      console.log('   Active:', userByEmpId.is_active);
    } else {
      console.log('❌ No user found with employee_id: EMP1001');
    }

    console.log('\n🔍 Searching for email: adminbitmax@gamil.com');
    const userByEmail1 = await User.findOne({ email: 'adminbitmax@gamil.com' });
    if (userByEmail1) {
      console.log('✅ Found user by email (gamil):');
      console.log('   Name:', userByEmail1.name);
      console.log('   Employee ID:', userByEmail1.employee_id);
      console.log('   Role:', userByEmail1.role);
      console.log('   Organization ID:', userByEmail1.organizationId || 'NOT SET ⚠️');
    } else {
      console.log('❌ No user found with email: adminbitmax@gamil.com');
    }

    console.log('\n🔍 Searching for email: adminbitmax@gmail.com (correct spelling)');
    const userByEmail2 = await User.findOne({ email: 'adminbitmax@gmail.com' });
    if (userByEmail2) {
      console.log('✅ Found user by email (gmail):');
      console.log('   Name:', userByEmail2.name);
      console.log('   Employee ID:', userByEmail2.employee_id);
      console.log('   Role:', userByEmail2.role);
      console.log('   Organization ID:', userByEmail2.organizationId || 'NOT SET ⚠️');
    } else {
      console.log('❌ No user found with email: adminbitmax@gmail.com');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 All Admin users in database:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const allAdmins = await User.find({ role: 'Admin' }).select('name email employee_id organizationId is_active');
    if (allAdmins.length === 0) {
      console.log('❌ No Admin users found in database!');
      console.log('\n💡 Solution: Create Admin via SuperAdmin panel');
    } else {
      allAdmins.forEach((admin, index) => {
        console.log(`\n${index + 1}. ${admin.name}`);
        console.log(`   Email: ${admin.email}`);
        console.log(`   Employee ID: ${admin.employee_id || 'N/A'}`);
        console.log(`   Organization: ${admin.organizationId || 'NOT LINKED ⚠️'}`);
        console.log(`   Active: ${admin.is_active ? '✅' : '❌'}`);
      });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 All SuperAdmin users in database:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const allSuperAdmins = await User.find({ role: 'SuperAdmin' }).select('name email employee_id is_active');
    if (allSuperAdmins.length === 0) {
      console.log('❌ No SuperAdmin users found in database!');
      console.log('\n💡 Critical: You need to create a SuperAdmin account first');
    } else {
      allSuperAdmins.forEach((sa, index) => {
        console.log(`\n${index + 1}. ${sa.name}`);
        console.log(`   Email: ${sa.email}`);
        console.log(`   Employee ID: ${sa.employee_id || 'N/A'}`);
        console.log(`   Active: ${sa.is_active ? '✅' : '❌'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

checkUser();
