/**
 * CREATE SUPER ADMIN USER
 * 
 * Run this script ONCE to create the first SuperAdmin user
 * 
 * Usage:
 * node scripts/createSuperAdmin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Question helper
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const createSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/chatcrm', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Get User model
    const User = require('../src/models/User');
    
    // Check if SuperAdmin already exists
    const existingSuperAdmin = await User.findOne({ role: 'SuperAdmin' });
    
    if (existingSuperAdmin) {
      console.log('⚠️  SuperAdmin already exists!');
      console.log('Email:', existingSuperAdmin.email);
      console.log('Name:', existingSuperAdmin.name);
      
      const overwrite = await question('\nDo you want to create another SuperAdmin? (yes/no): ');
      
      if (overwrite.toLowerCase() !== 'yes') {
        console.log('Exiting...');
        process.exit(0);
      }
    }
    
    console.log('📝 Create SuperAdmin User\n');
    
    // Get user input
    const name = await question('Name: ');
    const email = await question('Email: ');
    const password = await question('Password: ');
    const confirmPassword = await question('Confirm Password: ');
    
    // Validation
    if (!name || !email || !password) {
      console.log('❌ All fields are required!');
      process.exit(1);
    }
    
    if (password !== confirmPassword) {
      console.log('❌ Passwords do not match!');
      process.exit(1);
    }
    
    if (password.length < 6) {
      console.log('❌ Password must be at least 6 characters!');
      process.exit(1);
    }
    
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('❌ User with this email already exists!');
      process.exit(1);
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create SuperAdmin
    const superAdmin = await User.create({
      name,
      user_name: email.split('@')[0],
      email,
      password: hashedPassword,
      role: 'SuperAdmin',
      is_active: true,
      // Note: SuperAdmin doesn't need organizationId
    });
    
    console.log('\n✅ SuperAdmin created successfully!');
    console.log('\n📊 Details:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ID:', superAdmin._id);
    console.log('Name:', superAdmin.name);
    console.log('Email:', superAdmin.email);
    console.log('Role:', superAdmin.role);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🚀 You can now login with these credentials');
    console.log('   POST /api/v1/user/login');
    console.log('   { "email": "' + email + '", "password": "***" }');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating SuperAdmin:', error.message);
    process.exit(1);
  }
};

// Run
console.log('═══════════════════════════════════════');
console.log('   CREATE SUPERADMIN USER');
console.log('═══════════════════════════════════════\n');

createSuperAdmin();
