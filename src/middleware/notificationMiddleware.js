const jwt = require("jsonwebtoken");
const config = require("../../config");
const dotenv = require("dotenv");
dotenv.config();

const clients = {}; // Store connected clients by userId

/**
 * Validate the token and return the decoded user information
 */
function validateToken(token) {
    try {
        return jwt.verify(token, config.ACCESS_TOKEN_SECRET); // Decodes the token
    } catch (error) {
        console.error("Invalid token:", error.message);
        return null; // Return null if token is invalid
    }
}

/**
 * Add a client to the WebSocket connections
 */
function addClient(token, ws) {
    // Validate and decode the token
    const decoded = validateToken(token);
    if (!decoded || !decoded.user) {
        console.error("Invalid or missing user in token.");
        ws.close(); 
        return;
    }

    const userId = decoded.user; 
    console.log(`User ${userId} is connecting...`);

    // Store the WebSocket connection
    clients[userId] = { ws };
    console.log(`User ${userId} connected.`);

    // Handle client disconnection
    ws.on("close", () => {
        console.log(`User ${userId} disconnected.`);
        delete clients[userId];
    });
}

/**
 * Send a real-time notification to the user
 */
function sendRealTimeNotification(userId, data) {
    const client = clients[userId];
    if (client && client.ws.readyState === 1) { // Ensure the WebSocket is open
        client.ws.send(JSON.stringify(data)); // Send notification to the client
        console.log(`Notification sent to user ${userId}:`, data);
    } else {
        console.error(`User with ID ${userId} is not connected or WebSocket is not open.`);
    }
}

module.exports = { sendRealTimeNotification, addClient };