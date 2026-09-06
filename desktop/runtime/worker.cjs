'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { home, readJson, writeJson, lock, settings, mkdir, installState } = require('./files.cjs');
const { identity } = require('./hook.cjs');

function executeUploader(state, event, receipt) {
  return new Promise((resolve, reject) => {
    const windows = state.platform === 'win32';
    const executable = windows ? state.powershellPath : '/bin/sh';
    const script = state.uploaderPath || path.join(state.releaseDir, 'hooks', windows ? 'auto-improve-upload.ps1' : 'auto-improve-upload.sh');
    const args = windows ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, event.source] : [script, event.source];
    const env = { ...process.env, PATH: `${path.dirname(state.nodePath)}${path.delimiter}${process.env.PATH || ''}`,
      AUTO_IMPROVE_HOOK_CONFIG: state.configFile, AUTO_IMPROVE_DATA_DIR: state.dataDir,
      AUTO_IMPROVE_SNAPSHOT_SIZE: event.size === undefined ? '' : String(event.size),
      AUTO_IMPROVE_RECEIPT_FILE: receipt || '', AUTO_IMPROVE_HEALTH_DIR: path.join(home(), 'health'),
      AUTO_IMPROVE_SPOOL_ONLY: event.payload.hook_event_name === 'Drain' ? '' : '1',
      // The managed runtime is used even when GUI apps inherit a minimal PATH.
      AUTO_IMPROVE_NODE: state.nodePath,
      AUTO_IMPROVE_TRANSPORT: path.join(state.releaseDir, 'runtime', 'upload-request.cjs'),
    };
    // Never inherit a different account or endpoint from the desktop launch environment.
    for (const key of ['AUTO_IMPROVE_TOKEN', 'AUTO_IMPROVE_URL', 'AUTO_IMPROVE_UPLOAD_MODE', 'AUTO_IMPROVE_PROJECT_ID']) delete env[key];
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let errorOutput = '';
    child.stderr.on('data', data => { errorOutput = (errorOutput + data.toString()).slice(-2000); });
    child.stdin.on('error', () => {});
    // Windows PowerShell can buffer stdin using the host code page before the
    // script sets UTF-8. JSON escapes survive both that reader and the raw pipe;
    // ConvertFrom-Json restores the original Unicode paths and identifiers.
    const payload = JSON.stringify(event.payload);
    child.stdin.end(windows ? payload.replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`) : payload);
    const timeout = setTimeout(() => child.kill(), 120_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code, errorOutput }); });
  });
}
async function processEvent(state, file) {
  const event = readJson(file, null);
  if (!event || event.synthetic) throw new Error('Invalid queued event.');
  let stat;
  try { stat = fs.statSync(event.payload.transcript_path); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? 'The original transcript is no longer available. The event has not been marked as sent.' : 'The original transcript could not be opened. Check access permissions and retry.'); }
  if (identity(stat) !== event.identity || stat.size < event.size) throw new Error('The source transcript was replaced or truncated before it could be saved.');
  const receipt = `${file}.receipt`;
  fs.rmSync(receipt, { force: true });
  await executeUploader(state, event, receipt);
  if (!readJson(receipt, null)?.spooled) throw new Error('Transcript processing is incomplete. The event is retained for retry.');
  fs.rmSync(file);
  fs.rmSync(receipt, { force: true });
  fs.rmSync(`${file}.error`, { force: true });
}
async function run(root = home()) {
  const state = installState(root);
  if (!state || settings(root).paused) return;
  const release = lock(path.join(root, 'locks', 'worker.lock'));
  if (!release) return;
  const observed = new Set();
  try {
    mkdir(path.join(root, 'events'));
    const files = fs.readdirSync(path.join(root, 'events')).filter(file => file.endsWith('.json')).map(name => ({ name, event: readJson(path.join(root, 'events', name), null) }))
      .sort((a, b) => String(a.event?.receivedAt).localeCompare(String(b.event?.receivedAt)) || (a.event?.size || 0) - (b.event?.size || 0) || (a.event?.payload?.hook_event_name === 'SessionEnd' ? 1 : -1)).map(item => item.name);
    const blocked = new Set();
    for (const name of files) {
      if (settings(root).paused) return;
      observed.add(name);
      const file = path.join(root, 'events', name);
      const event = readJson(file, null);
      const key = `${event?.payload?.transcript_path}|${event?.identity}`;
      if (blocked.has(key)) continue;
      try { await processEvent(state, file); }
      catch (error) {
        blocked.add(key);
        const message = error.code === 'ENOENT' ? 'The original transcript is no longer available. The event has not been marked as sent.' : error.message;
        writeJson(`${file}.error`, { at: new Date().toISOString(), error: message });
      }
    }
    if (!settings(root).paused) await executeUploader(state, { source: 'codex-openai', payload: { hook_event_name: 'Drain' } });
    fs.rmSync(path.join(root, 'health', 'worker-error.json'), { force: true });
  } finally { release(); }
  // Close the wakeup race when an event arrives while this worker is exiting.
  if (fs.readdirSync(path.join(root, 'events')).some(name => name.endsWith('.json') && !observed.has(name))) require('./hook.cjs').wake(root);
}
if (require.main === module) run().catch(() => {
  try { writeJson(path.join(home(), 'health', 'worker-error.json'), { at: new Date().toISOString(), error: 'Background delivery could not run. Use Retry or Repair hooks.' }); } catch {}
  process.exitCode = 1;
});
module.exports = { run, processEvent, executeUploader };
