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

    // Check if SuperAdmin already exists
    const existingSuperAdmin = await User.findOne({ email: 'arman.bitmax@gmail.com', role: 'SuperAdmin' });

    // Seed SuperAdmin (not linked to any organization)
    if (!existingSuperAdmin) {
      const superAdmin = new User({
        user_name: 'superadmin',
        name: 'Super Admin',
        email: 'arman.bitmax@gmail.com',
        password: hashedPassword,
        role: 'SuperAdmin',
        mobile: '1234567890',
        is_active: true,
      });
      await superAdmin.save();
      console.log('✅ SuperAdmin user created');
    } else {
      console.log('ℹ️  SuperAdmin user already exists');
    }

    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n📝 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUPERADMIN:');
    console.log('  Email: arman.bitmax@gmail.com');
    console.log('  Password: An183890@#');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedUsers();
