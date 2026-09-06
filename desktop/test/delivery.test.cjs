'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { extractZip } = require('../runtime/archive.cjs');
const { capture } = require('../runtime/hook.cjs');
const { readJson, writeJson, atomicWrite } = require('../runtime/files.cjs');
const { download } = require('../runtime/network.cjs');
const { alive, waitForExit } = require('../runtime/lifecycle.cjs');
const { hookCommand } = require('../runtime/launchers.cjs');
async function stopWorker(root) {
  const owner = readJson(path.join(root, 'locks', 'worker.lock', 'owner.json'), null);
  if (!owner || !alive(owner.pid)) return;
  // hook.wake starts a detached worker. Stop its uploader as well, including on
  // assertion failure, before deleting the fixture's credentials and queue.
  if (process.platform === 'win32') {
    spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(owner.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
  } else {
    try { process.kill(-owner.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await waitForExit(owner.pid, 5);
}
function child(file, env) {
  return new Promise((resolve, reject) => {
    const process_ = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    process_.stdout.on('data', chunk => { output += chunk; }); process_.stderr.on('data', chunk => { output += chunk; });
    process_.on('error', reject); process_.on('close', code => resolve({ code, output }));
  });
}
async function setup(t, prefix = 'penelopa-delivery-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    atomicWrite(path.join(root, 'collection-disabled'), 'fixture cleanup\n');
    await stopWorker(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const source = path.join(root, 'release'); extractZip(fs.readFileSync(path.join(__dirname, `../../public/desktop/releases/${require("../package.json").version}/source.zip`)), source);
  const env = { ...process.env, PENELOPA_TESTING: '1', AUTO_IMPROVE_HOME: root, CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), AUTO_IMPROVE_HOOK_CONFIG: path.join(root, process.platform === 'win32' ? 'credential.json' : 'credential.env'), AUTO_IMPROVE_TOKEN: 'test-only-token', AUTO_IMPROVE_DATA_DIR: root };
  const result = spawnSync(process.execPath, [path.join(source, 'runtime/install.cjs'), '--no-desktop', '--drain-max-seconds', '2'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr); return { root, source, env };
}
function deliveryStatus(root) {
  const health = Object.fromEntries(['capture-error', 'worker-error', 'delivery-error', 'upload'].map(name => [name, readJson(path.join(root, 'health', `${name}.json`), null)]));
  const events = fs.existsSync(path.join(root, 'events')) ? fs.readdirSync(path.join(root, 'events')) : [];
  return JSON.stringify({ health, queuedEvents: events.filter(name => name.endsWith('.json')).length,
    processingErrors: events.filter(name => name.endsWith('.error')).map(name => readJson(path.join(root, 'events', name))) });
}
test('offline delivery retains segments, honors the captured byte boundary, validates ACKs and retries idempotently', { timeout: 120_000 }, async t => {
  const f = await setup(t); const requests = []; let mode = 'offline';
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), body = bytes.toString();
    // .NET legitimately uses unquoted disposition names and extra part headers.
    const form = await new Response(bytes, { headers: { 'content-type': request.headers['content-type'] } }).formData();
    const field = name => form.get(name);
    requests.push({ key: request.headers['idempotency-key'], body });
    if (mode === 'offline') { response.writeHead(503); response.end('{}'); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ segment_id: 'fixture-segment', accepted_offset: mode === 'invalid' ? -1 : Number(field('byte_end')), segment_sha256: field('segment_sha256') }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/v2/transcript-segments`;
  if (process.platform === 'win32') { const config = readJson(f.env.AUTO_IMPROVE_HOOK_CONFIG); config.url = endpoint; writeJson(f.env.AUTO_IMPROVE_HOOK_CONFIG, config); }
  else { const config = fs.readFileSync(f.env.AUTO_IMPROVE_HOOK_CONFIG, 'utf8'); atomicWrite(f.env.AUTO_IMPROVE_HOOK_CONFIG, config.replace(/^AUTO_IMPROVE_URL=.*$/m, `AUTO_IMPROVE_URL=${endpoint}`)); }
  const transcript = path.join(f.root, 'session.jsonl'); atomicWrite(transcript, '{"message":"captured"}\n');
  capture('codex-openai', { hook_event_name: 'Stop', transcript_path: transcript, session_id: 'fixture' }, f.root);
  fs.appendFileSync(transcript, '{"message":"later"}\n');
  const worker = () => child(path.join(f.source, 'runtime/worker.cjs'), f.env);
  const pending = () => fs.readdirSync(path.join(f.root, 'outbox')).filter(name => name.startsWith('pending-'));
  const clearBackoff = () => { for (const item of pending()) {
    const folder = path.join(f.root, 'outbox', item);
    if (process.platform === 'win32') { const request = readJson(path.join(folder, 'request.json')); request.nextAttemptEpoch = 0; writeJson(path.join(folder, 'request.json'), request); }
    else atomicWrite(path.join(folder, 'next_attempt_at'), '0\n');
  } };
  assert.equal((await worker()).code, 0); assert.equal(pending().length, 1);
  const segment = fs.readFileSync(path.join(f.root, 'outbox', pending()[0], 'segment.jsonl'), 'utf8');
  assert.equal(segment, '{"message":"captured"}\n'); assert.equal(fs.readdirSync(path.join(f.root, 'events')).filter(name => name.endsWith('.json')).length, 0);
  mode = 'invalid'; clearBackoff(); await worker(); assert.equal(pending().length, 1);
  mode = 'valid'; clearBackoff(); await worker(); assert.equal(pending().length, 0, `Requests: ${requests.length}; ${deliveryStatus(f.root)}`);
  assert.ok(readJson(path.join(f.root, 'health/upload.json')).lastUploadAt > 0);
  assert.equal(new Set(requests.map(request => request.key)).size, 1); assert.ok(requests.length >= 3);
  const count = requests.length; await worker(); assert.equal(requests.length, count);
});
test('missing transcript remains an actionable event instead of becoming a successful upload', { timeout: 60_000 }, async t => {
  const f = await setup(t); const file = path.join(f.root, 'disappearing.jsonl'); atomicWrite(file, '{"type":"event"}\n');
  capture('codex-openai', { hook_event_name: 'SessionEnd', transcript_path: file }, f.root); fs.unlinkSync(file);
  await child(path.join(f.source, 'runtime/worker.cjs'), f.env);
  const files = fs.readdirSync(path.join(f.root, 'events')); assert.equal(files.filter(name => name.endsWith('.json')).length, 1);
  const failure = readJson(path.join(f.root, 'events', files.find(name => name.endsWith('.error')))); assert.match(failure.error, /no longer available/);
});
test('checksum failures never publish a downloaded file', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'penelopa-download-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = process.env.PENELOPA_TESTING; process.env.PENELOPA_TESTING = '1'; t.after(() => { if (old === undefined) delete process.env.PENELOPA_TESTING; else process.env.PENELOPA_TESTING = old; });
  const server = http.createServer((_req, res) => res.end('tampered'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const destination = path.join(root, 'download');
  await assert.rejects(download(`http://127.0.0.1:${server.address().port}/file`, destination, '0'.repeat(64)), /checksum mismatch/);
  assert.equal(fs.existsSync(destination), false); assert.deepEqual(fs.readdirSync(root), []);
});
test('installed SessionEnd returns within three seconds while delivery is stalled and concurrent events stay durable', { timeout: 90_000 }, async t => {
  const f = await setup(t);
  let received;
  const receiving = new Promise(resolve => { received = resolve; });
  const server = http.createServer((_request, response) => { received(); setTimeout(() => { response.writeHead(503); response.end('{}'); }, 4000).unref(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}/v2/transcript-segments`;
  if (process.platform === 'win32') { const config = readJson(f.env.AUTO_IMPROVE_HOOK_CONFIG); config.url = endpoint; writeJson(f.env.AUTO_IMPROVE_HOOK_CONFIG, config); }
  else atomicWrite(f.env.AUTO_IMPROVE_HOOK_CONFIG, fs.readFileSync(f.env.AUTO_IMPROVE_HOOK_CONFIG, 'utf8').replace(/^AUTO_IMPROVE_URL=.*$/m, `AUTO_IMPROVE_URL=${endpoint}`));
  const transcript = path.join(f.root, 'session ü.jsonl'); atomicWrite(transcript, '{"message":"test event"}\n');
  const state = readJson(path.join(f.root, 'install.json'));
  const hook = state.agents.find(agent => agent.source === 'codex-openai');
  const start = performance.now();
  const result = spawnSync(hook.command, { shell: true, env: { ...f.env, PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0` : '/usr/bin:/bin' }, input: JSON.stringify({ hook_event_name: 'SessionEnd', transcript_path: transcript }), encoding: 'utf8', timeout: 3000 });
  const elapsed = performance.now() - start;
  const launchStatus = JSON.stringify({ elapsedMs: Math.round(elapsed), status: result.status, signal: result.signal, error: result.error?.code, stderr: result.stderr });
  t.diagnostic(`SessionEnd launch: ${launchStatus}`);
  assert.equal(result.error, undefined, launchStatus); assert.equal(result.status, 0, launchStatus); assert.equal(result.stdout.trim(), '{}', launchStatus); assert.ok(elapsed < 3000, launchStatus);
  assert.ok(readJson(path.join(f.root, 'health/codex-openai.json'), null)?.lastEventAt, `SessionEnd did not capture the event: ${deliveryStatus(f.root)}`);
  let timer;
  try {
    await Promise.race([receiving, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Worker did not reach the fixture server: ${deliveryStatus(f.root)}`)), 20_000); timer.unref(); })]);
  } finally { clearTimeout(timer); }
  // A worker may be killed after publishing its local segment and before ACK.
  await stopWorker(f.root);
  for (let i = 0; i < 12; i++) capture('codex-openai', { hook_event_name: 'Stop', transcript_path: transcript, session_id: `parallel-${i}` }, f.root);
  assert.equal(fs.readdirSync(path.join(f.root, 'events')).filter(name => name.endsWith('.json')).length, 12);
  assert.ok(fs.readdirSync(path.join(f.root, 'outbox')).some(name => name.startsWith('pending-')));
});
test('direct Node capture closes its pipes while a detached worker stays alive and writes to its own log', { timeout: 60_000 }, async t => {
  const f = await setup(t, "penelopa capture ' ü 日本語 &-"), state = readJson(path.join(f.root, 'install.json'));
  // No HTTP is involved: keep a real detached Node worker alive well past the
  // hook deadline. Any inherited capture pipe will make spawnSync time out,
  // even if the launcher itself has already returned status 0 and printed {}.
  atomicWrite(path.join(f.source, 'runtime/worker.cjs'), `const path = require('node:path');
const { home, lock } = require('./files.cjs');
const release = lock(path.join(home(), 'locks', 'worker.lock'));
if (release) {
  process.stdout.write('fixture worker stdout\\n');
  process.stderr.write('fixture worker stderr\\n');
  setTimeout(release, 30000);
}
`);
  const transcript = path.join(f.root, 'session ü 日本語.jsonl'); atomicWrite(transcript, '{"message":"synthetic fixture"}\n');
  for (const agent of state.agents) {
    // Exercise the Windows command on every OS; on Windows also verify that
    // this is exactly the command registered by the installer.
    const command = hookCommand(f.root, agent.source, 'win32', state.nodePath);
    if (process.platform === 'win32') assert.equal(agent.command, command);
    const start = performance.now();
    const result = spawnSync(command, { shell: true, env: { ...f.env, PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin' },
      input: JSON.stringify({ hook_event_name: 'SessionEnd', transcript_path: transcript }), encoding: 'utf8', timeout: 3000 });
    const elapsed = performance.now() - start;
    const detail = JSON.stringify({ source: agent.source, elapsedMs: Math.round(elapsed), error: result.error?.code, status: result.status, stderr: result.stderr });
    t.diagnostic(detail);
    assert.equal(result.error, undefined, detail); assert.equal(result.status, 0, detail); assert.ok(elapsed < 3000, detail);
    assert.equal(result.stdout.trim(), agent.source === 'codex-openai' ? '{}' : '', detail); assert.equal(result.stderr, '', detail);
  }
  const marker = path.join(f.root, 'locks/worker.lock/owner.json'), log = path.join(f.root, 'logs/worker.log');
  const deadline = Date.now() + 5000;
  while ((!readJson(marker, null) || !fs.readFileSync(log, 'utf8').includes('fixture worker stderr')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(alive(readJson(marker, null)?.pid), 'The detached worker must still be running after both capture pipes close.');
  assert.match(fs.readFileSync(log, 'utf8'), /fixture worker stdout/); assert.match(fs.readFileSync(log, 'utf8'), /fixture worker stderr/);
  assert.equal(fs.readdirSync(path.join(f.root, 'events')).filter(name => name.endsWith('.json')).length, 2);
});
