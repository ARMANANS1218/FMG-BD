/**
 * List all organizations in the database
 * Usage: node src/utils/listOrganizations.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const Organization = require('../models/Organization');

async function listOrganizations() {
  try {
    const dbUri = process.env.CONNECTION_STRING || process.env.MONGO_URI;
    await mongoose.connect(dbUri);
    console.log('✅ Connected to database\n');

    const organizations = await Organization.find().select('name email phone address createdAt');
    
    if (organizations.length === 0) {
      console.log('❌ No organizations found');
      console.log('\n💡 Create an organization first via SuperAdmin panel');
      process.exit(0);
    }

    console.log(`📋 Found ${organizations.length} organization(s):\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    organizations.forEach((org, index) => {
      console.log(`\n${index + 1}. ${org.name}`);
      console.log(`   ID: ${org._id}`);
      console.log(`   Email: ${org.email}`);
      console.log(`   Phone: ${org.phone || 'N/A'}`);
      console.log(`   Created: ${org.createdAt.toLocaleDateString()}`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 Copy the Organization ID to use in linkAdminToOrganization.js');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

listOrganizations();
