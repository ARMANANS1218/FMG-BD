const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const OrgEmailConfig = require('../models/OrgEmailConfig');

async function buildTransportForOrg(organization) {
  console.log(`[BUILD_TRANSPORT] Building transport for organization: ${organization}`);
  
  // Try per-org config first
  let cfg = null;
  if (organization) {
    cfg = await OrgEmailConfig.findOne({ organization, isEnabled: true }).lean();
    console.log(`[BUILD_TRANSPORT] Found config:`, {
      found: !!cfg,
      organization: cfg?.organization,
      emailAddress: cfg?.emailAddress,
      smtpHost: cfg?.smtp?.host,
      smtpPort: cfg?.smtp?.port,
      smtpUsername: cfg?.smtp?.username || cfg?.imap?.username,
      hasSmtpPassword: !!(cfg?.smtp?.password || cfg?.imap?.password),
      isEnabled: cfg?.isEnabled
    });
  }

  // Decide credentials
  if(!cfg){
    throw new Error(`No OrgEmailConfig found for organization: ${organization}`);
  }
  if(!cfg.smtp?.host || !cfg.smtp?.port){
    throw new Error('SMTP host/port missing in OrgEmailConfig');
  }
  const host = cfg.smtp.host;
  const port = Number(cfg.smtp.port);
  const user = cfg.smtp.username || cfg.imap?.username;
  const pass = cfg.smtp.password || cfg.imap?.password;
  if(!user || !pass){
    throw new Error('SMTP credentials missing (username/password).');
  }
  const fromAddress = cfg.smtp?.fromName ? `${cfg.smtp.fromName} <${cfg.emailAddress}>` : cfg.emailAddress;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465 || cfg?.smtp?.secure === true,
    auth: { user, pass },
    tls: { 
      rejectUnauthorized: false 
    },
    connectionTimeout: 30000, // 30 seconds
    greetingTimeout: 10000, // 10 seconds
    socketTimeout: 60000, // 60 seconds
  });

  return { transporter, fromAddress };
}

/**
 * Send an email reply for a ticket (per-organization if available).
 * headers: { inReplyTo, references }
 * attachments: array of attachment objects with url/path
 */
async function sendEmailReply({ organization, to, subject, html, text, headers = {}, attachments = [] }) {
  const { transporter, fromAddress } = await buildTransportForOrg(organization);
  
  console.log(`[SEND EMAIL] From: ${fromAddress}, To: ${to}, Subject: ${subject}`);
  console.log(`[SEND EMAIL] Headers:`, headers);
  console.log(`[SEND EMAIL] Attachments:`, attachments?.length || 0);
  
  try {
    // Process attachments if any
    const emailAttachments = [];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.url) {
          emailAttachments.push({
            filename: att.filename || 'attachment',
            path: att.url,
            contentType: att.contentType || 'application/octet-stream'
          });
        }
      }
    }

    // Ensure proper email threading headers
    const emailHeaders = { ...headers };
    if (headers['In-Reply-To']) {
      emailHeaders['In-Reply-To'] = headers['In-Reply-To'];
    }
    if (headers['References']) {
      emailHeaders['References'] = headers['References'];
    }

    const mailOptions = {
      from: fromAddress,
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, ''),
      headers: emailHeaders,
    };

    if (emailAttachments.length > 0) {
      mailOptions.attachments = emailAttachments;
    }

    console.log(`[SEND EMAIL] Final mail options:`, {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      hasHtml: !!mailOptions.html,
      hasText: !!mailOptions.text,
      attachmentCount: emailAttachments.length,
      headers: emailHeaders
    });

    const info = await transporter.sendMail(mailOptions);
    console.log(`[SEND EMAIL] Success: ${info.messageId} to ${to}`);
    logger.info('SMTP sent:', info.messageId);
    return info;
  } catch (e) {
    console.error(`[SEND EMAIL] Failed to send to ${to}:`, e.message);
    logger.error('SMTP error:', e.message);
    throw e;
  }
}

module.exports = { sendEmailReply };
