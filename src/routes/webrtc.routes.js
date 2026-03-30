const express = require('express');
const { getIceServers } = require('../controllers/webrtc.controller');
// const { getIceServersFromMeteredAPI } = require('../controllers/webrtc.controller'); // Commented out

const router = express.Router();

// Get ICE servers configuration (STUN/TURN)
// This endpoint provides WebRTC connection configuration
router.get('/ice-servers', getIceServers);

// Alternative: Fetch from Metered.ca REST API
// router.get('/ice-servers/metered', getIceServersFromMeteredAPI); // Commented out - using custom TURN server

module.exports = router;
