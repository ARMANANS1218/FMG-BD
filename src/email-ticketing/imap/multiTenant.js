const OrgEmailConfig = require('../models/OrgEmailConfig');
const { startImapListener } = require('./imapListener');
const { setStatus } = require('./status');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/crypto');

// Keep a registry of running listeners by config _id
const running = new Map(); // key -> { cfg, imap }

function buildCfgFromDoc(doc){
  return {
    key: String(doc._id),
    organization: String(doc.organization),
    user: doc.imap?.username || doc.emailAddress,
    pass: decrypt(doc.imap?.password),
    imapHost: doc.imap?.host,
    imapPort: doc.imap?.port,
  };
}

async function startAllFromDB(){
  const docs = await OrgEmailConfig.find({ isEnabled: true });
  for(const doc of docs){
    const key = String(doc._id);
    if(running.has(key)) continue;
    const cfg = buildCfgFromDoc(doc);
    setStatus({ ...cfg }, 'connecting', { host: cfg.imapHost, port: cfg.imapPort });
    try{
      const imap = startImapListener({ ...cfg, onStatus: (st)=>setStatus(cfg, st) });
      running.set(key, { cfg, imap });
      logger.info('Started IMAP for org', cfg.organization, cfg.user);
    }catch(e){
      setStatus(cfg, 'error', { error: e.message });
      logger.error('Failed to start IMAP for', cfg.user, e.message);
    }
  }
}

async function stopAll(){
  for (const [key, entry] of running.entries()) {
    try {
      entry.imap?.end?.();
    } catch (e) {
      logger.error('Error ending imap', key, e.message);
    }
  }
  running.clear();
}

async function reloadAll(){
  await stopAll();
  await startAllFromDB();
}

async function startOneById(id){
  const doc = await OrgEmailConfig.findById(id);
  if(!doc || !doc.isEnabled) return false;
  const key = String(doc._id);
  if(running.has(key)) return true;
  const cfg = buildCfgFromDoc(doc);
  const imap = startImapListener({ ...cfg, onStatus: (st)=>setStatus(cfg, st) });
  running.set(key, { cfg, imap });
  return true;
}

async function stopOneById(id){
  const key = String(id);
  const entry = running.get(key);
  if(!entry) return false;
  try { entry.imap?.end?.(); } catch(e){ logger.error('Stop one error', key, e.message); }
  running.delete(key);
  setStatus({ organization: entry.cfg.organization, user: entry.cfg.user, key }, 'stopped');
  return true;
}

module.exports = { startAllFromDB, stopAll, reloadAll, startOneById, stopOneById };
