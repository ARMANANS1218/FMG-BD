/**
 * List all Admin users in the database
 * Usage: node src/utils/listAdmins.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
require('dotenv').config();

async function listAdmins() {
  try {
    const dbUri = process.env.CONNECTION_STRING || process.env.MONGO_URI;
    await mongoose.connect(dbUri);
    console.log('✅ Connected to database\n');

    const admins = await User.find({ role: 'Admin' })
      .select('name email employee_id organizationId is_active createdAt')
      .sort({ createdAt: -1 });
    
    if (admins.length === 0) {
      console.log('❌ No Admin users found');
      process.exit(0);
    }

    console.log(`📋 Found ${admins.length} Admin user(s):\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    for (const admin of admins) {
      let orgName = 'NOT LINKED ⚠️';
      if (admin.organizationId) {
        const org = await Organization.findById(admin.organizationId).select('name');
        orgName = org ? org.name : 'Organization not found';
      }

      console.log(`\n📧 ${admin.email}`);
      console.log(`   Name: ${admin.name}`);
      console.log(`   ID: ${admin._id}`);
      console.log(`   Employee ID: ${admin.employee_id || 'N/A'}`);
      console.log(`   Organization: ${orgName}`);
      console.log(`   Active: ${admin.is_active ? '✅ Yes' : '❌ No'}`);
      console.log(`   Created: ${admin.createdAt.toLocaleDateString()}`);
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const unlinked = admins.filter(a => !a.organizationId);
    if (unlinked.length > 0) {
      console.log(`\n⚠️  ${unlinked.length} Admin(s) not linked to any organization`);
      console.log('💡 Run linkAdminToOrganization.js to fix this');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

listAdmins();
