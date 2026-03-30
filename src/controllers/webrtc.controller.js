// WebRTC ICE Servers Configuration Controller
// Provides STUN/TURN server credentials securely from backend

/**
 * Get ICE Servers Configuration
 * Returns STUN and TURN servers for WebRTC connections
 * TURN credentials are kept secure on backend
 */
const getIceServers = async (req, res) => {
  try {
    // Start with free STUN servers (for NAT traversal discovery)
    const iceServers = [
      {
        urls: process.env.TURN_STUN_URL || "stun:stun.l.google.com:19302",
      },
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "stun:stun1.l.google.com:19302",
      },
    ];

    // Add custom TURN server (for relay when direct connection fails)
    if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      const turnServers = [
        {
          urls: process.env.TURN_SERVER_URL,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL,
        },
      ];

      iceServers.push(...turnServers);
      console.log("✅ TURN servers configured from custom server");
    } else {
      console.warn("⚠️ TURN credentials not found - calls may fail across different networks");
    }

    // OLD Metered.ca configuration (commented out)
    /*
    // Add TURN servers from Metered.ca (for relay when direct connection fails)
    if (process.env.METERED_TURN_USERNAME && process.env.METERED_TURN_CREDENTIAL) {
      const turnServers = [
        {
          urls: "turn:standard.relay.metered.ca:80",
          username: process.env.METERED_TURN_USERNAME,
          credential: process.env.METERED_TURN_CREDENTIAL,
        },
        {
          urls: "turn:standard.relay.metered.ca:80?transport=tcp",
          username: process.env.METERED_TURN_USERNAME,
          credential: process.env.METERED_TURN_CREDENTIAL,
        },
        {
          urls: "turn:standard.relay.metered.ca:443",
          username: process.env.METERED_TURN_USERNAME,
          credential: process.env.METERED_TURN_CREDENTIAL,
        },
        {
          urls: "turns:standard.relay.metered.ca:443?transport=tcp",
          username: process.env.METERED_TURN_USERNAME,
          credential: process.env.METERED_TURN_CREDENTIAL,
        },
      ];

      iceServers.push(...turnServers);
      console.log("✅ TURN servers configured from Metered.ca");
    } else {
      console.warn("⚠️ TURN credentials not found - calls may fail across different networks");
    }
    */

    res.json({
      success: true,
      iceServers,
    });

    res.json({
      success: true,
      iceServers,
    });
  } catch (error) {
    console.error("❌ Error fetching ICE servers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get ICE servers configuration",
    });
  }
};

/**
 * Alternative: Fetch from Metered.ca API (if you want to use their REST API)
 * This fetches fresh credentials from Metered.ca on each request
 * NOTE: Commented out since we're now using custom TURN server
 */
/*
const getIceServersFromMeteredAPI = async (req, res) => {
  try {
    const apiKey = process.env.METERED_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "Metered API key not configured",
      });
    }

    // Fetch from Metered.ca API
    const response = await fetch(
      `https://live_chat_crm.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch credentials from Metered.ca");
    }

    const iceServers = await response.json();

    res.json({
      success: true,
      iceServers,
    });
  } catch (error) {
    console.error("❌ Error fetching from Metered.ca API:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ICE servers from Metered.ca",
    });
  }
};
*/

module.exports = {
  getIceServers,
  // getIceServersFromMeteredAPI, // Commented out - using custom TURN server instead
};
