'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { home, writeJson, readJson, settings, mkdir } = require('./files.cjs');

function identity(stat) { return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`; }
function capture(source, payload, root = home(), synthetic = false) {
  if (!['codex-openai', 'claude-anthropic'].includes(source)) throw new Error('Unknown agent.');
  if (settings(root).paused && !synthetic) return null;
  if (!payload || !['Stop', 'SessionEnd'].includes(payload.hook_event_name)) return null;
  if (typeof payload.transcript_path !== 'string' || !path.isAbsolute(payload.transcript_path)) throw new Error('The transcript path is missing.');
  const transcript = fs.realpathSync(payload.transcript_path);
  const stat = fs.statSync(transcript);
  if (!stat.isFile()) throw new Error('The transcript is not a file.');
  const event = {
    schemaVersion: 1, id: crypto.randomUUID(), receivedAt: new Date().toISOString(), source, synthetic,
    identity: identity(stat), size: stat.size,
    payload: { hook_event_name: payload.hook_event_name, transcript_path: transcript,
      session_id: typeof payload.session_id === 'string' ? payload.session_id : '',
      cwd: typeof payload.cwd === 'string' ? payload.cwd : path.dirname(transcript) },
  };
  const directory = path.join(root, synthetic ? 'self-test-events' : 'events');
  writeJson(path.join(directory, `${Date.now()}-${event.id}.json`), event);
  if (!synthetic) writeJson(path.join(root, 'health', `${source}.json`), { lastEventAt: event.receivedAt });
  if (!synthetic) fs.rmSync(path.join(root, 'health', 'capture-error.json'), { force: true });
  return event;
}
function wake(root = home()) {
  const install = readJson(path.join(root, 'install.json'), null);
  if (!install || settings(root).paused) return;
  mkdir(path.join(root, 'logs'));
  const log = path.join(root, 'logs', 'worker.log');
  if (fs.existsSync(log) && fs.statSync(log).size > 1_048_576) fs.renameSync(log, `${log}.previous`);
  const fd = fs.openSync(log, 'a', 0o600);
  try {
    const child = spawn(install.nodePath, [path.join(install.releaseDir, 'runtime', 'worker.cjs')], {
      detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, AUTO_IMPROVE_HOME: root },
    });
    child.on('error', () => {}); child.unref();
  } finally { fs.closeSync(fd); }
}
if (require.main === module) {
  const source = process.argv[2] || 'codex-openai';
  try {
    const input = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(input) > 1_048_576) throw new Error('Hook input exceeds 1 MiB.');
    const event = capture(source, JSON.parse(input));
    if (event) wake();
  } catch {
    try { writeJson(path.join(home(), 'health', 'capture-error.json'), { at: new Date().toISOString(), error: 'A hook event could not be saved. Check transcript access and available disk space.' }); } catch {}
    process.stderr.write('Penelopa: event capture needs attention. Open Connection in Penelopa.ai.\n');
  } finally { if (source === 'codex-openai') process.stdout.write('{}\n'); }
}
module.exports = { capture, wake, identity };
