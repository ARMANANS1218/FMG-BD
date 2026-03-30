/**
 * Script to update existing query assignedToName fields to use agent aliases
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Query = require('../src/models/Query');
const User = require('../src/models/User');

async function updateQueryAgentNames() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/chat-crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    // Find all queries that have assignedTo but may have old names
    const queries = await Query.find({ 
      assignedTo: { $exists: true, $ne: null },
      assignedToName: { $exists: true }
    });

    console.log(`Found ${queries.length} assigned queries to check`);

    let updatedCount = 0;

    for (const query of queries) {
      // Get the current assigned agent
      const agent = await User.findById(query.assignedTo);
      
      if (agent && ['Agent', 'TL', 'QA'].includes(agent.role)) {
        const agentDisplayName = agent.alias || agent.name;
        
        // Only update if the current assignedToName is different from the display name
        if (query.assignedToName !== agentDisplayName) {
          await Query.findByIdAndUpdate(query._id, {
            assignedToName: agentDisplayName
          });
          
          console.log(`Updated Query ${query.petitionId} - Agent: ${query.assignedToName} → ${agentDisplayName}`);
          updatedCount++;
        }
      }
    }

    console.log(`✅ Updated ${updatedCount} queries with agent alias names`);
    
  } catch (error) {
    console.error('❌ Error updating query agent names:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
updateQueryAgentNames();