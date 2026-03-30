/**
 * Convert raw_user.txt (TSV) to MongoDB Extended JSON for Atlas "Add Data" import.
 *
 * Usage:  node scripts/convertRawUserToJson.js
 * Output: customers_import.json  (project root)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ─── Configuration ───────────────────────────────────────────────
const ORG_ID = '690afe4c071944b493b73862';
const CREATED_BY = '6950d638b05c56b98693e22e';
const SALT_ROUNDS = 10;

// ─── Helpers ─────────────────────────────────────────────────────

/** Generate a fresh 24-char hex ObjectId */
function newOid() {
  return crypto.randomBytes(12).toString('hex');
}

/** Wrap a value as MongoDB Extended JSON ObjectId */
function oid(hex) {
  return { $oid: hex };
}

/** Parse a date string and wrap as Extended JSON $date, or return null */
function toDate(str) {
  if (!str || !str.trim()) return null;
  const d = new Date(str.trim());
  if (isNaN(d.getTime())) return null;
  return { $date: d.toISOString() };
}

/** Current timestamp as Extended JSON $date */
function nowDate() {
  return { $date: new Date().toISOString() };
}

// ─── Enum mappers ────────────────────────────────────────────────

function mapKycType(raw) {
  if (!raw) return null;
  const m = {
    passport: 'Passport',
    ssn: 'Other',
    'driver license': 'Driving License',
    'state id': 'Other',
  };
  return m[raw.toLowerCase()] || 'Other';
}

function mapServiceStatus(raw) {
  if (!raw) return null;
  const m = {
    active: 'Active',
    inactive: 'Inactive',
    blacklisted: 'Suspended',
    'under verification': 'Pending',
  };
  return m[raw.toLowerCase()] || null;
}

function mapSimType(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'physical') return 'Physical';
  if (lower === 'esim') return 'eSIM';
  return null;
}

function mapBillingType(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'prepaid') return 'Prepaid';
  if (lower === 'postpaid') return 'Postpaid';
  return null;
}

function mapBillingCycle(raw) {
  if (!raw) return null;
  const m = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    'half-yearly': 'Half-Yearly',
    yearly: 'Yearly',
  };
  return m[raw.toLowerCase()] || null;
}

function validityFromCycle(raw) {
  if (!raw) return '30';
  const m = {
    monthly: '30',
    quarterly: '90',
    'half-yearly': '180',
    yearly: '365',
  };
  return m[raw.toLowerCase()] || '30';
}

function mapGender(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (['male', 'female', 'other'].includes(lower)) {
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return null;
}

/** Extract just the street portion from full address */
function extractStreet(full, city) {
  if (!full) return null;
  if (city) {
    const idx = full.indexOf(`, ${city}`);
    if (idx !== -1) return full.substring(0, idx).trim();
  }
  // fallback: everything before last comma pair
  return full.trim();
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const rawPath = path.join(__dirname, '..', '..', 'raw_user.txt');
  const outPath = path.join(__dirname, '..', '..', 'customers_import.json');

  console.log('Reading raw_user.txt …');
  const content = fs.readFileSync(rawPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  const headers = lines[0].split('\t').map((h) => h.trim());
  console.log(`Columns : ${headers.length}`);
  console.log(`Data rows: ${lines.length - 1}`);

  const customers = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').trim();
    });

    // ── Required fields ──
    const name = row['Name'];
    const email = row['Email'];
    if (!name || !email) {
      skipped++;
      continue;
    }

    // ── Extract raw columns ──
    const customerId = row['Customer ID'];
    const mobile = row['Primary Number'];
    const altPhone = row['Alternate Number'];
    const fullAddress = row['Full Address'];
    const city = row['City'];
    const state = row['State'];
    const zip = row['Zip Code'];
    const gender = row['Gender'];
    const dob = row['DOB'];
    const plan = row['Plan'];
    const planType = row['Plan Type'];       // Prepaid / Postpaid
    const deviceModel = row['Device Model'];
    const activationDate = row['Activation Date'];
    const billingCycle = row['Billing Cycle'];
    const simType = row['SIM Type'];
    const simNumber = row['SIM Number'];
    const imei = row['IMEI'];
    const kycType = row['KYC Type'];
    const idNumber = row['ID Proof Number'];
    const accountStatus = row['Account Status'];

    // ── Derived values ──
    const last4 = mobile
      ? mobile.replace(/\D/g, '').slice(-4)
      : (customerId || '0000').slice(-4);
    const visiblePwd = `Cust${last4}`;
    const hashedPwd = bcrypt.hashSync(visiblePwd, SALT_ROUNDS);

    const mBillingType = mapBillingType(planType);
    const mBillingCycle = mapBillingCycle(billingCycle);
    const mValidity = validityFromCycle(billingCycle);
    const mStatus = mapServiceStatus(accountStatus);

    // ── Plan history entry ──
    const planHistoryEntry = {
      _id: oid(newOid()),
      planType: plan || 'Basic',
      billingType: mBillingType || 'Prepaid',
      billingCycle: mBillingCycle || 'Monthly',
      validityPeriod: mValidity,
      activationDate: toDate(activationDate) || nowDate(),
      deactivationDate: null,
      serviceStatus: mStatus || 'Active',
      addedAt: nowDate(),
      addedBy: oid(CREATED_BY),
      notes: 'Imported from raw_user.txt',
    };

    // ── Build document ──
    const doc = {
      _id: oid(newOid()),
      organizationId: oid(ORG_ID),
      customerId: customerId || null,
      user_name: email.split('@')[0],
      name,
      email: email.toLowerCase(),
      mobile: mobile || null,
      alternatePhone: altPhone || null,
      password: hashedPwd,
      visiblePassword: visiblePwd,
      encryptedPassword: null,
      customerType: 'registered',

      governmentId: {
        type: mapKycType(kycType),
        number: idNumber || null,
        issuedDate: null,
        expiryDate: null,
      },

      address: {
        street: extractStreet(fullAddress, city),
        locality: null,
        city: city || null,
        state: state || null,
        country: 'United States',
        postalCode: zip || null,
        landmark: null,
      },

      planType: plan || null,
      billingType: mBillingType,
      billingCycle: mBillingCycle,
      validityPeriod: mValidity,
      activationDate: toDate(activationDate),
      deactivationDate: null,
      serviceStatus: mStatus,

      planHistory: [planHistoryEntry],
      queryHistory: [],

      deviceInfo: {
        model: deviceModel || null,
        imei: imei || null,
      },

      simNumber: simNumber || null,
      simType: mapSimType(simType),

      dateOfBirth: toDate(dob),
      gender: mapGender(gender),

      profileImage: null,
      cloudinaryPublicId: null,

      is_active: false,
      workStatus: 'offline',
      is_typing: false,

      login_time: nowDate(),
      logout_time: nowDate(),

      notes: null,

      createdBy: oid(CREATED_BY),

      ip: null,
      locationName: null,
      location: {
        country: null,
        region: null,
        city: null,
        isp: null,
        timezone: null,
        latitude: null,
        longitude: null,
      },

      createdAt: nowDate(),
      updatedAt: nowDate(),
      __v: 0,
    };

    customers.push(doc);

    if (i % 200 === 0) {
      console.log(`  ${i} / ${lines.length - 1} …`);
    }
  }

  console.log(`\nProcessed : ${customers.length} customers`);
  if (skipped) console.log(`Skipped   : ${skipped} (missing name or email)`);

  fs.writeFileSync(outPath, JSON.stringify(customers, null, 2), 'utf-8');
  console.log(`\nOutput → ${outPath}`);
  console.log('\nImport options:');
  console.log('  1. MongoDB Atlas → Database → Collection → Add Data → Import JSON');
  console.log(
    '  2. mongoimport --db bitmax-chat-crm --collection customers --file customers_import.json --jsonArray'
  );
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
