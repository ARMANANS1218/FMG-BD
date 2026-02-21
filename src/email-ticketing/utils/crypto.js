const crypto = require('crypto');

// Uses AES-256-GCM. Requires 32-byte secret in env EMAIL_TICKETING_SECRET or EMAIL_CONFIG_SECRET.
const getKey = () => {
  const secret = process.env.EMAIL_TICKETING_SECRET || process.env.EMAIL_CONFIG_SECRET || '';
  if (!secret) return null;
  // Derive 32-byte key from secret using SHA-256
  return crypto.createHash('sha256').update(String(secret)).digest();
};

function encrypt(text) {
  try {
    if (!text) return text;
    // Avoid double-encrypting
    if (typeof text === 'string' && text.startsWith('enc:gcm:')) return text;
    const key = getKey();
    if (!key) return text; // no secret configured; store plaintext to avoid breakage
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:gcm:${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
  } catch (_e) {
    return text; // fail safe: return original
  }
}

function decrypt(maybeEnc) {
  try {
    if (!maybeEnc || typeof maybeEnc !== 'string') return maybeEnc;
    if (!maybeEnc.startsWith('enc:gcm:')) return maybeEnc;
    const key = getKey();
    if (!key) return maybeEnc; // cannot decrypt without key
    const [, , ivB64, dataB64, tagB64] = maybeEnc.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch (_e) {
    return maybeEnc; // if decryption fails, return input to avoid throwing
  }
}

module.exports = { encrypt, decrypt };
