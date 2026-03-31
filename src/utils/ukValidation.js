const UK_PHONE_REGEX = /^\+44\d{9,10}$/;
// Covers standard UK postcode formats (case-insensitive)
const UK_POSTCODE_REGEX = /^([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;

function normalizeUkPhone(value) {
  if (!value) return null;
  const trimmed = String(value).trim();

  // Convert local 0xxxxxxxxxx to +44xxxxxxxxxx
  if (trimmed.startsWith('0')) {
    return `+44${trimmed.slice(1).replace(/\D/g, '')}`;
  }

  if (trimmed.startsWith('+44')) {
    return `+44${trimmed.slice(3).replace(/\D/g, '')}`;
  }

  return trimmed.replace(/\s+/g, '');
}

function isValidUkPhone(value) {
  if (!value) return false;
  return UK_PHONE_REGEX.test(normalizeUkPhone(value));
}

function normalizeUkPostcode(value) {
  if (!value) return null;
  const clean = String(value).trim().toUpperCase().replace(/\s+/g, '');
  if (clean.length < 5) return clean;
  return `${clean.slice(0, -3)} ${clean.slice(-3)}`;
}

function isValidUkPostcode(value) {
  if (!value) return false;
  return UK_POSTCODE_REGEX.test(normalizeUkPostcode(value));
}

module.exports = {
  normalizeUkPhone,
  isValidUkPhone,
  normalizeUkPostcode,
  isValidUkPostcode,
};
