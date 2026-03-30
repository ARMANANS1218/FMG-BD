/**
 * Script to link an existing Admin user to an organization
 * 
 * This script is needed when:
 * - An Admin user was created before the organization system was implemented
 * - An Admin user needs to be reassigned to a different organization
 * 
 * Usage:
 * 1. Update the EMAIL and ORG_ID constants below
 * 2. Run: node src/utils/linkAdminToOrganization.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
require('dotenv').config();

// ⚠️ CONFIGURE THESE VALUES
const ADMIN_EMAIL = 'admin@example.com'; // Change to your admin's email
const ORGANIZATION_ID = '673f9e7f1c3a9f001234abcd'; // Change to the organization ID

async function linkAdminToOrganization() {
  try {
    // Connect to database
    const dbUri = process.env.CONNECTION_STRING || process.env.MONGO_URI;
    await mongoose.connect(dbUri);
    console.log('✅ Connected to database');

    // Find the organization
    const organization = await Organization.findById(ORGANIZATION_ID);
    if (!organization) {
      console.error('❌ Organization not found with ID:', ORGANIZATION_ID);
      console.log('\n💡 To list all organizations, run:');
      console.log('   node src/utils/listOrganizations.js');
      process.exit(1);
    }

    console.log('✅ Organization found:', organization.name);

    // Find the admin user
    const admin = await User.findOne({ email: ADMIN_EMAIL, role: 'Admin' });
    if (!admin) {
      console.error('❌ Admin user not found with email:', ADMIN_EMAIL);
      console.log('\n💡 To list all admins, run:');
      console.log('   node src/utils/listAdmins.js');
      process.exit(1);
    }

    console.log('✅ Admin found:', admin.name, `(${admin.email})`);

    // Check if already linked
    if (admin.organizationId) {
      console.log('⚠️  Admin is already linked to organization:', admin.organizationId);
      console.log('Updating to new organization:', ORGANIZATION_ID);
    }

    // Update admin with organization
    admin.organizationId = ORGANIZATION_ID;
    await admin.save();

    console.log('\n✅ SUCCESS! Admin user linked to organization');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin:', admin.name);
    console.log('Email:', admin.email);
    console.log('Organization:', organization.name);
    console.log('Organization ID:', ORGANIZATION_ID);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 Next steps:');
    console.log('1. Admin user should logout and login again');
    console.log('2. New token will include organizationId');
    console.log('3. Admin can now create employees (Agent/QA)');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  }
}

linkAdminToOrganization();
