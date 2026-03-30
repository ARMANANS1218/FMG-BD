// redis.js
const redis = require("redis");

let redisClient;

(async () => {
  try {
    // ✅ Redis client create
    redisClient = redis.createClient({
      socket: {
        host: "127.0.0.1", // Redis server address
        port: 6379         // Redis default port
      }
    });

    // ✅ Connect to Redis
    redisClient.on("connect", () => {
      console.log("✅ Redis Connected");
    });

    redisClient.on("error", (err) => {
      console.error("❌ Redis Error:", err);
    });

    await redisClient.connect();
  } catch (err) {
    console.error("Redis connection failed:", err);
  }
})();

module.exports = redisClient;
