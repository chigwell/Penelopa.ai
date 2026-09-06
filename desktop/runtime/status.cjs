'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { home, readJson, settings, installState } = require('./files.cjs');
function list(directory) { try { return fs.readdirSync(directory); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
function status(root = home()) {
  const install = installState(root);
  const prefs = settings(root);
  const eventDir = path.join(root, 'events');
  const errors = list(eventDir).filter(name => name.endsWith('.error')).map(name => readJson(path.join(eventDir, name), null)).filter(Boolean);
  const agents = (install?.agents || []).map(agent => {
    let configured = false;
    let error = null;
    try {
      const config = readJson(agent.configPath, {});
      configured = ['Stop', 'SessionEnd'].every(event => config.hooks?.[event]?.some(entry => entry.hooks?.some(hook => hook.command === agent.command)));
    } catch { error = 'Agent configuration is not valid JSON.'; }
    const health = readJson(path.join(root, 'health', `${agent.source}.json`), {});
    return { name: agent.name, configured, detected: agent.detectedAtInstall, lastEventAt: health.lastEventAt || null,
      state: !configured ? 'needs-repair' : health.lastEventAt ? 'connected' : 'awaiting-event', error };
  });
  const dataDir = install?.dataDir || root;
  const pending = list(path.join(dataDir, 'outbox')).filter(name => name.startsWith('pending-'));
  let queuedBytes = 0;
  for (const name of pending) { try { queuedBytes += fs.statSync(path.join(dataDir, 'outbox', name, 'segment.jsonl')).size; } catch {} }
  const upload = readJson(path.join(root, 'health', 'upload.json'), {});
  for (const name of ['capture-error.json', 'worker-error.json', 'delivery-error.json']) {
    const error = readJson(path.join(root, 'health', name), null);
    if (error) errors.push(error);
  }
  return { installed: !!install, version: install?.version || null, desktop: install?.desktop ? { version: install.desktop.version, signed: install.desktop.signed, error: install.desktop.error } : null,
    paused: prefs.paused, agents, pendingEvents: list(eventDir).filter(name => name.endsWith('.json')).length,
    queuedSegments: pending.length, queuedBytes, quarantinedSegments: list(path.join(dataDir, 'outbox', 'quarantine')).length,
    lastUploadAt: upload.lastUploadAt ? new Date(Number(upload.lastUploadAt) * 1000).toISOString() : null,
    selfTest: install?.selfTest || null, errors: errors.map(item => ({ at: item.at, error: item.error })).slice(-20) };
}
// This intentionally excludes credentials, paths, transcript contents and API responses.
function diagnostics(root = home()) { return { generatedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.versions.node, ...status(root) }; }
module.exports = { status, diagnostics };
