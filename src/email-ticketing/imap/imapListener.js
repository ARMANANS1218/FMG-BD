const Imap = require('imap');
const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');
const { createTicketFromEmail } = require('../ticket.service');
const { setStatus } = require('./status');

// In-memory guard to avoid double-processing the same UID in rapid bursts
const processedUIDs = new Set();

function getOrgConfigFromEnv() {
  const enabled = String(process.env.EMAIL_TICKETING_ENABLED || 'true') === 'true';
  if (!enabled) return null;
  const orgId = process.env.EMAIL_TICKET_ORG_ID || null; // optional
  const user = process.env.IMAP_USERNAME || process.env.EMAIL_TICKET_USER || 'support@bitmaxtest.com';
  const pass = process.env.IMAP_PASSWORD || process.env.EMAIL_TICKET_PASS || process.env.EMAIL_TICKET_PASSWORD || '';
  const imapHost = process.env.IMAP_HOST || process.env.EMAIL_TICKET_IMAP_HOST || 'mail.bitmaxtest.com';
  const imapPort = Number(process.env.IMAP_PORT || process.env.EMAIL_TICKET_IMAP_PORT || 993);
  return { organization: orgId, user, pass, imapHost, imapPort };
}

/**
 * Create and start a single IMAP listener for an organization.
 */
function startImapListener({ organization, user, pass, imapHost, imapPort, key, onStatus }) {
  logger.info('🔧 Starting IMAP listener', { user, imapHost, imapPort, org: organization, hasPass: !!pass });
  
  if (!pass) {
    logger.error('❌ IMAP password missing!', { user, organization });
    setStatus({ organization, user, key }, 'error', { error: 'Password missing' });
    return;
  }

  const imap = new Imap({
    user,
    password: pass,
    host: imapHost,
    port: imapPort,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    autotls: 'always',
  });

  function openInbox(cb) {
    imap.openBox('INBOX', false, cb);
  }

  imap.once('ready', () => {
    logger.info('IMAP connected for', user);
    setStatus({ organization, user, key }, 'connected', { host: imapHost, port: imapPort });
    onStatus && onStatus('connected');
    openInbox((err, box) => {
      if (err) {
        logger.error('IMAP openInbox error', err.message);
        setStatus({ organization, user, key }, 'error', { error: err.message });
        onStatus && onStatus('error');
        return;
      }
      logger.info('IMAP watching mailbox. Unseen:', box.messages.total);

      // Initial fetch of unseen emails
      imap.search(['UNSEEN'], (err, results) => {
        if (err) return logger.error('IMAP search error', err.message);
        if (!results || !results.length) return;
        fetchAndProcess(results);
      });

      // Listen for new mail
      imap.on('mail', () => {
        imap.search(['UNSEEN'], (err, results) => {
          if (err) return logger.error('IMAP search error', err.message);
          if (!results || !results.length) return;
          fetchAndProcess(results);
        });
      });
    });
  });

  imap.on('error', (err) => {
    logger.error('IMAP error', err.message);
    setStatus({ organization, user, key }, 'error', { error: err.message });
    onStatus && onStatus('error');
  });

  imap.on('end', () => {
    logger.warn('IMAP connection ended. Will reconnect in 15s');
    setStatus({ organization, user, key }, 'ended');
    onStatus && onStatus('ended');
    setTimeout(() => startImapListener({ organization, user, pass, imapHost, imapPort }), 15000);
  });

  imap.connect();
  return imap;

  function fetchAndProcess(uids) {
    // Filter out any UIDs we already processed in a tight window
    const toFetch = uids.filter((u) => {
      const key = `${user}:${u}`;
      if (processedUIDs.has(key)) return false;
      processedUIDs.add(key);
      setTimeout(() => processedUIDs.delete(key), 5 * 60 * 1000); // 5 minutes
      return true;
    });
    if (!toFetch.length) return;

    const f = imap.fetch(toFetch, { bodies: '', markSeen: true });
    f.on('message', (msg) => {
      let buffer = '';
      msg.on('body', (stream) => {
        stream.on('data', (chunk) => (buffer += chunk.toString('utf8')));
      });
      msg.once('end', async () => {
        try {
          const parsed = await simpleParser(buffer);
          await createTicketFromEmail(parsed, organization);
        } catch (e) {
          logger.error('Parser/process error', e.message);
          setStatus({ organization, user, key }, 'error', { error: e.message });
        }
      });
    });
    f.once('error', (err) => logger.error('Fetch error', err.message));
  }
}

function startEmailTicketing() {
  const single = getOrgConfigFromEnv();
  if (!single) {
    logger.warn('Email ticketing disabled via env');
    return;
  }
  setStatus({ organization: single.organization, user: single.user }, 'connecting', { host: single.imapHost, port: single.imapPort });
  startImapListener({ ...single, key: 'env' });
}

module.exports = { startEmailTicketing, startImapListener };
