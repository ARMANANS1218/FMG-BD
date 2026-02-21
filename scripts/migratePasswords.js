/**
 * Migration Script: Encrypt Existing Passwords
 * 
 * This script will encrypt existing visiblePassword fields
 * and store them in the new encryptedPassword field.
 * 
 * Run this ONCE after deploying the encryption feature.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { encryptPassword } = require('../src/utils/encryption');

async function migratePasswords() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27017/chatcrm';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Find all users with visiblePassword but no encryptedPassword
    const users = await User.find({
      visiblePassword: { $exists: true, $ne: null },
      encryptedPassword: { $exists: false }
    });

    console.log(`📊 Found ${users.length} users to migrate`);

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        const encrypted = encryptPassword(user.visiblePassword);
        if (encrypted) {
          user.encryptedPassword = encrypted;
          await user.save({ validateModifiedOnly: true });
          successCount++;
          console.log(`✅ Encrypted password for: ${user.name} (${user.email})`);
        } else {
          errorCount++;
          console.log(`❌ Failed to encrypt password for: ${user.name} (${user.email})`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error encrypting password for ${user.email}:`, error.message);
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   Total Users: ${users.length}`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    // Close connection
    await mongoose.connection.close();
    console.log('\n✅ Migration completed. Database connection closed.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migratePasswords();
