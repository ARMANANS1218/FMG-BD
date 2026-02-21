const crypto = require('crypto');

/**
 * Encryption/Decryption utility for storing retrievable passwords
 * WARNING: This is for admin viewing only. Passwords should primarily be hashed.
 */

// Use environment variable or fallback (in production, MUST use env variable)
const ENCRYPTION_KEY = process.env.PASSWORD_ENCRYPTION_KEY || 'your-32-character-secret-key!!'; // Must be 32 characters
const ALGORITHM = 'aes-256-cbc';

// Ensure key is exactly 32 bytes
const getKey = () => {
  if (ENCRYPTION_KEY.length === 32) {
    return Buffer.from(ENCRYPTION_KEY, 'utf8');
  }
  // Hash the key to get exactly 32 bytes
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
};

/**
 * Encrypt a password for admin viewing
 * @param {string} password - Plain text password
 * @returns {string} - Encrypted password in format: iv:encryptedData
 */
const encryptPassword = (password) => {
  try {
    if (!password) return null;
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return iv and encrypted data separated by colon
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    return null;
  }
};

/**
 * Decrypt a password for admin viewing
 * @param {string} encryptedPassword - Encrypted password in format: iv:encryptedData
 * @returns {string} - Plain text password
 */
const decryptPassword = (encryptedPassword) => {
  try {
    if (!encryptedPassword || !encryptedPassword.includes(':')) {
      return null;
    }
    
    const [ivHex, encryptedData] = encryptedPassword.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
};

module.exports = {
  encryptPassword,
  decryptPassword
};
