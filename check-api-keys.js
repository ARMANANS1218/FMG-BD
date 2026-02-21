// Quick script to check organization API keys
require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('./src/models/Organization');

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Find the organization that the agent is logged into
    const agentOrgId = '696d1e714f2108d52fd83b08';
    const agentOrg = await Organization.findById(agentOrgId);
    
    if (agentOrg) {
      console.log('\n=== AGENT ORGANIZATION ===');
      console.log('Name:', agentOrg.name);
      console.log('Organization ID:', agentOrg._id.toString());
      console.log('Active API Keys:');
      agentOrg.apiKeys.filter(k => k.isActive).forEach(k => {
        console.log(`  - ${k.name}: ${k.key}`);
      });
    } else {
      console.log('Agent organization not found!');
    }
    
    // Find the organization with the current API key
    const currentApiKey = 'sk_b074a4aa6f4429933fff4be7c1c1b639a78fa488e64577c6883a911b173c9b14';
    const currentOrg = await Organization.findOne({
      'apiKeys.key': currentApiKey,
      'apiKeys.isActive': true
    });
    
    if (currentOrg) {
      console.log('\n=== CURRENT API KEY ORGANIZATION ===');
      console.log('Name:', currentOrg.name);
      console.log('Organization ID:', currentOrg._id.toString());
      console.log('API Key:', currentApiKey);
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
