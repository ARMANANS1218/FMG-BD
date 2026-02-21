/**
 * Script to add display names for existing Agent, TL, QA users
 * This adds sample display names/aliases for testing purposes
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import the User model
const User = require('../src/models/User');

async function addDisplayNames() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/chat-crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    // Find all Agent, TL, QA users
    const staffUsers = await User.find({ 
      role: { $in: ['Agent', 'TL', 'QA'] } 
    });

    console.log(`Found ${staffUsers.length} staff members to update`);

    // Update each user with alias only
    for (const user of staffUsers) {
      let alias = '';
      
      // Generate alias based on role and name
      const firstName = user.name.split(' ')[0];
      
      switch (user.role) {
        case 'Agent':
          alias = `Agent ${firstName}`;
          break;
        case 'TL':
          alias = `TL ${firstName}`;
          break;
        case 'QA':
          alias = `QA ${firstName}`;
          break;
      }
      
      // Update the user
      await User.findByIdAndUpdate(user._id, {
        alias: alias,
        $unset: { displayName: 1 } // Remove displayName field
      });
      
      console.log(`Updated ${user.name} (${user.role}) -> Alias: "${alias}"`);
    }

    console.log('✅ All staff members updated with alias names');
    
  } catch (error) {
    console.error('❌ Error updating display names:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
addDisplayNames();