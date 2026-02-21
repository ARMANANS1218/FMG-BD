const asyncHandler = require('express-async-handler');
const OrgEmailConfig = require('./models/OrgEmailConfig');
const { listStatuses } = require('./imap/status');
const { reloadAll, startOneById, stopOneById } = require('./imap/multiTenant');
const Imap = require('imap');
const nodemailer = require('nodemailer');
const { encrypt, decrypt } = require('./utils/crypto');

function toResponse(c, statusMap){
  const key = String(c._id);
  const s = statusMap?.byKey?.[key] || statusMap?.list?.find(x => x.organization === String(c.organization) && x.email === (c.imap?.username || c.emailAddress));
  return {
    _id: c._id,
    organization: c.organization,
    emailAddress: c.emailAddress,
    imap: { host: c.imap.host, port: c.imap.port, username: c.imap.username },
    smtp: { host: c.smtp.host, port: c.smtp.port, fromName: c.smtp.fromName },
    isEnabled: c.isEnabled,
    status: s?.status || 'unknown',
    updatedAt: s?.updatedAt || c.updatedAt,
  };
}

// List org email configs along with runtime IMAP statuses and env config
exports.listOrgEmailConfigs = asyncHandler(async (req, res) => {
  const isSuper = (req.user?.role === 'SuperAdmin');
  const orgId = req.user?.organizationId;

  if (!isSuper && !orgId) {
    return res.status(400).json({ success: false, message: 'Your account is not linked to an organization' });
  }

  const query = isSuper ? {} : { organization: orgId };
  const configs = await OrgEmailConfig.find(query).lean();
  const statuses = listStatuses();

  // Attach status by key or matching email + org
  const byKey = Object.fromEntries(statuses.map(s => [s.key, s]));

  const data = configs.map((c)=> toResponse(c, { byKey, list: statuses }));

  // Include ENV single-tenant status preview
  const envEnabled = String(process.env.EMAIL_TICKETING_ENABLED || 'false') === 'true';
  const env = envEnabled ? {
    organization: process.env.EMAIL_TICKET_ORG_ID || null,
    emailAddress: process.env.EMAIL_TICKET_USER,
    imap: { host: process.env.EMAIL_TICKET_IMAP_HOST, port: Number(process.env.EMAIL_TICKET_IMAP_PORT), username: process.env.EMAIL_TICKET_USER },
    smtp: { host: process.env.EMAIL_TICKET_SMTP_HOST, port: Number(process.env.EMAIL_TICKET_SMTP_PORT), fromName: process.env.EMAIL_TICKET_FROM },
    isEnabled: true,
    status: (statuses.find(s => s.key === 'env')?.status) || 'connecting',
  } : null;

  res.json({ success: true, configs: data, env });
});

// Create a new OrgEmailConfig
exports.createOrgEmailConfig = asyncHandler(async (req, res) => {
  const isSuper = (req.user?.role === 'SuperAdmin');
  const orgId = req.user?.organizationId;
  const body = req.body || {};

  if (!isSuper) {
    if (!orgId) return res.status(400).json({ success: false, message: 'Your account is not linked to an organization' });
    body.organization = orgId; // enforce org scoping for Admins
  } else {
    // SuperAdmin must specify organization, else fallback to their org if present
    body.organization = body.organization || orgId;
  }

  // Encrypt secrets if provided
  if (body?.imap?.password) body.imap.password = encrypt(body.imap.password);
  if (body?.smtp?.password) body.smtp.password = encrypt(body.smtp.password);

  const doc = await OrgEmailConfig.create(body);
  // attempt to start its listener immediately if enabled
  try { await startOneById(doc._id); } catch {}
  // Mirror list response shape; do not leak passwords
  const statuses = listStatuses();
  const resp = toResponse(doc.toObject ? doc.toObject() : doc, { list: statuses, byKey: Object.fromEntries(statuses.map(s => [s.key, s])) });
  res.status(201).json({ success: true, config: resp });
});

// Update an existing OrgEmailConfig
exports.updateOrgEmailConfig = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const isSuper = (req.user?.role === 'SuperAdmin');
  const orgId = req.user?.organizationId;

  let doc;
  if (isSuper) {
    // Encrypt incoming secrets on update if present
    if (body?.imap?.password) body.imap.password = encrypt(body.imap.password);
    if (body?.smtp?.password) body.smtp.password = encrypt(body.smtp.password);
    doc = await OrgEmailConfig.findByIdAndUpdate(id, body, { new: true });
  } else {
    if (!orgId) return res.status(400).json({ success: false, message: 'Your account is not linked to an organization' });
    if (body?.imap?.password) body.imap.password = encrypt(body.imap.password);
    if (body?.smtp?.password) body.smtp.password = encrypt(body.smtp.password);
    doc = await OrgEmailConfig.findOneAndUpdate({ _id: id, organization: orgId }, body, { new: true });
  }
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
  // For simplicity, reload all to ensure creds are refreshed
  try { await reloadAll(); } catch {}
  const statuses = listStatuses();
  const resp = toResponse(doc.toObject ? doc.toObject() : doc, { list: statuses, byKey: Object.fromEntries(statuses.map(s => [s.key, s])) });
  res.json({ success: true, config: resp });
});

// Reload all IMAP listeners
exports.reloadImapListeners = asyncHandler(async (_req, res) => {
  await reloadAll();
  res.json({ success: true, message: 'Reload triggered' });
});

// Delete config & stop listener
exports.deleteOrgEmailConfig = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const isSuper = (req.user?.role === 'SuperAdmin');
  const orgId = req.user?.organizationId;

  let doc;
  if (isSuper) {
    doc = await OrgEmailConfig.findByIdAndDelete(id);
  } else {
    if (!orgId) return res.status(400).json({ success: false, message: 'Your account is not linked to an organization' });
    doc = await OrgEmailConfig.findOneAndDelete({ _id: id, organization: orgId });
  }
  if(!doc) return res.status(404).json({ success:false, message:'Not found' });
  try { await stopOneById(id); } catch {}
  res.json({ success:true, deleted:id });
});

// Test connection for an existing OrgEmailConfig
exports.testOrgEmailConfig = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const isSuper = (req.user?.role === 'SuperAdmin');
  const orgId = req.user?.organizationId;

  let cfgDoc;
  if (isSuper) cfgDoc = await OrgEmailConfig.findById(id);
  else cfgDoc = await OrgEmailConfig.findOne({ _id: id, organization: orgId });
  if (!cfgDoc) return res.status(404).json({ success: false, message: 'Config not found' });

  const imapUser = cfgDoc.imap?.username || cfgDoc.emailAddress;
  const imapPass = decrypt(cfgDoc.imap?.password);
  const imapHost = cfgDoc.imap?.host;
  const imapPort = cfgDoc.imap?.port || 993;

  const smtpUser = cfgDoc.smtp?.username || cfgDoc.emailAddress;
  const smtpPass = decrypt(cfgDoc.smtp?.password);
  const smtpHost = cfgDoc.smtp?.host;
  const smtpPort = cfgDoc.smtp?.port || 465;

  const result = { imap: { ok: false }, smtp: { ok: false } };

  // IMAP test
  if (!imapPass) {
    result.imap = { ok: false, error: 'No IMAP password stored' };
  } else {
    result.imap = await new Promise((resolve) => {
      let settled = false;
      const imap = new Imap({
        user: imapUser,
        password: imapPass,
        host: imapHost,
        port: imapPort,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        autotls: 'always',
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { imap.end(); } catch {}
        resolve({ ok: false, error: 'IMAP test timed out' });
      }, 12000);
      imap.once('ready', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { imap.end(); } catch {}
        resolve({ ok: true });
      });
      imap.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, error: err?.message || 'IMAP error' });
      });
      try { imap.connect(); } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ ok: false, error: e.message });
        }
      }
    });
  }

  // SMTP test (only if creds provided)
  if (!smtpUser || !smtpPass || !smtpHost) {
    result.smtp = { ok: false, skipped: true, error: 'SMTP creds not set' };
  } else {
    const secure = Number(smtpPort) === 465;
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await new Promise((resolve, reject) => {
        transporter.verify((err, success) => {
          if (err) return reject(err);
          resolve(success);
        });
      });
      result.smtp = { ok: true };
    } catch (e) {
      result.smtp = { ok: false, error: e?.message || 'SMTP error' };
    }
  }

  const ok = result.imap.ok && (result.smtp.ok || result.smtp.skipped);
  res.json({ success: ok, result });
});
