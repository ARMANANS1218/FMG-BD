const statuses = new Map();

function keyOf(cfg){
  return cfg && (cfg.key || `${cfg.organization || 'env'}:${cfg.user || cfg.email || cfg.imap?.username || 'unknown'}`);
}

function setStatus(cfg, status, meta){
  const key = keyOf(cfg);
  const data = {
    key,
    organization: cfg.organization || null,
    email: cfg.user || cfg.email || cfg.imap?.username,
    status,
    meta: meta || {},
    updatedAt: new Date(),
  };
  statuses.set(key, data);
  return data;
}

function listStatuses(){
  return Array.from(statuses.values()).sort((a,b)=>a.email?.localeCompare(b.email||'')||0);
}

module.exports = { setStatus, listStatuses, keyOf };
