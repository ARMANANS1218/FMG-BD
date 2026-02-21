// utils/ipLocation.js
const geoip = require("geoip-lite");

// Client IP nikalna
function getClientIp(req) {
  // Priority 1: Client-provided public IP (from req.body for login requests)
  if (req.body?.clientPublicIp) {
    return req.body.clientPublicIp.trim();
  }

  // Priority 2: Standard proxy headers
  let ip =
    req.headers["cf-connecting-ip"] || // Cloudflare
    req.headers["x-real-ip"] || // Nginx proxy
    req.headers["x-forwarded-for"]?.split(",")[0] || // Proxy chain
    req.headers["x-client-ip"] || // Apache proxy
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip;

  // "::ffff:" cleanup
  ip = ip?.replace("::ffff:", "").trim();

  return ip;
}

// Location fetch karna
function getLocation(ip) {
  try {
    const data = geoip.lookup(ip);

    const result = {
      ip,
      latitude: data?.ll?.[0] || null,
      longitude: data?.ll?.[1] || null,
    };

    // Only add country, region, city if they have actual values
    if (data?.country) {
      result.country = data.country;
    }
    
    if (data?.region) {
      result.region = data.region;
    }
    
    if (data?.city) {
      result.city = data.city;
    }

    return result;
  } catch (err) {
    return {
      ip,
      latitude: null,
      longitude: null,
    };
  }
}

module.exports = { getClientIp, getLocation };
