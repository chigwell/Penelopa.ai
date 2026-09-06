'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { atomicWrite, writeJson, readJson } = require('../runtime/files.cjs');
const { capture } = require('../runtime/hook.cjs');
const { executeUploader } = require('../runtime/worker.cjs');
const powershell = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
const available = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { timeout: 15_000, windowsHide: true }).status === 0;
// Simulate the Windows PowerShell host's cached, non-UTF-8 Console.In reader.
// Changing Console.InputEncoding does not replace an explicitly supplied reader.
const invocation = `[Console]::SetIn([IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::ASCII)); & $env:PENELOPA_SCRIPT_UNDER_TEST codex-openai`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penelopa PS ' ü 日本語-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const transcript = path.join(root, 'session ü 日本語.jsonl');
  atomicWrite(transcript, '{"message":"synthetic Unicode fixture"}\n');
  const payload = { hook_event_name: 'SessionEnd', transcript_path: transcript, session_id: 'fixture', cwd: root };
  const env = { ...process.env, AUTO_IMPROVE_HOME: root, AUTO_IMPROVE_NODE: process.execPath, AUTO_IMPROVE_DATA_DIR: root, AUTO_IMPROVE_TOKEN: '', AUTO_IMPROVE_URL: '', AUTO_IMPROVE_HOOK_CONFIG: path.join(root, 'credential.json'), AUTO_IMPROVE_SPOOL_ONLY: '1', AUTO_IMPROVE_RECEIPT_FILE: path.join(root, 'receipt.json') };
  writeJson(env.AUTO_IMPROVE_HOOK_CONFIG, { token: '', dataDir: root, uploadMode: 'segments' });
  return { root, transcript, payload, env, run: script => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', invocation], { env: { ...env, PENELOPA_SCRIPT_UNDER_TEST: script }, input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 30_000 }) };
}
test('PowerShell uploader spools Unicode paths independently of the host stdin encoding', { skip: !available && 'PowerShell is not installed', timeout: 40_000 }, t => {
  const f = fixture(t);
  const result = f.run(path.resolve(__dirname, '../../public/auto-improve-upload.ps1'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(f.env.AUTO_IMPROVE_RECEIPT_FILE, null)?.spooled, true, result.stderr);
  const pending = fs.readdirSync(path.join(f.root, 'outbox')).find(name => name.startsWith('pending-'));
  assert.equal(fs.readFileSync(path.join(f.root, 'outbox', pending, 'segment.jsonl'), 'utf8'), fs.readFileSync(f.transcript, 'utf8'));
});
test('PowerShell capture forwards Unicode JSON bytes to Node without a console code-page round trip', { skip: !available && 'PowerShell is not installed', timeout: 40_000 }, t => {
  const f = fixture(t), script = path.join(f.root, 'bin/capture.ps1'), output = path.join(f.root, 'captured.json');
  atomicWrite(script, '\uFEFF' + fs.readFileSync(path.resolve(__dirname, '../runtime/capture.ps1'), 'utf8'));
  atomicWrite(path.join(f.root, 'node-path'), process.execPath + '\n');
  atomicWrite(path.join(f.root, 'bin/hook.cjs'), `require('node:fs').writeFileSync(process.env.PENELOPA_CAPTURE_OUTPUT, require('node:fs').readFileSync(0));`);
  f.env.PENELOPA_CAPTURE_OUTPUT = output;
  const result = f.run(script);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(readJson(output, null), f.payload, result.stderr);
});

function managedFixture(t) {
  const f = fixture(t);
  const previousHome = process.env.AUTO_IMPROVE_HOME;
  process.env.AUTO_IMPROVE_HOME = f.root;
  t.after(() => { if (previousHome === undefined) delete process.env.AUTO_IMPROVE_HOME; else process.env.AUTO_IMPROVE_HOME = previousHome; });
  const state = { platform: 'win32', powershellPath: powershell, nodePath: process.execPath,
    releaseDir: path.resolve(__dirname, '..'), uploaderPath: path.resolve(__dirname, '../../public/auto-improve-upload.ps1'),
    configFile: f.env.AUTO_IMPROVE_HOOK_CONFIG, dataDir: f.root };
  return { ...f, state };
}
test('managed PowerShell delivery preserves captured Unicode paths even when the host has already decoded stdin', { skip: !available && 'PowerShell is not installed', timeout: 40_000 }, async t => {
  const f = managedFixture(t);
  const wrapper = path.join(f.root, 'buffered-host.ps1');
  // Exercise the uploader's pipeline fallback after a host reader has consumed
  // the pipe. Changing InputEncoding inside the uploader cannot undo that read.
  atomicWrite(wrapper, '\uFEFF' + `param([string]$Source)
$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::ASCII)
try { $buffered = $reader.ReadToEnd() } finally { $reader.Dispose() }
$buffered | & '${f.state.uploaderPath.replaceAll("'", "''")}' $Source
`);
  const event = capture('codex-openai', { ...f.payload, session_id: 'fixture ü 日本語 🧵' }, f.root, true);
  const receipt = path.join(f.root, 'managed-receipt.json');
  const result = await executeUploader({ ...f.state, uploaderPath: wrapper }, event, receipt);
  assert.equal(result.code, 0, result.errorOutput);
  assert.equal(readJson(receipt, null)?.spooled, true, result.errorOutput);
  const pending = fs.readdirSync(path.join(f.root, 'outbox')).find(name => name.startsWith('pending-'));
  const item = path.join(f.root, 'outbox', pending);
  assert.equal(readJson(path.join(item, 'request.json')).externalSessionId, event.payload.session_id);
  assert.equal(fs.readFileSync(path.join(item, 'segment.jsonl'), 'utf8'), fs.readFileSync(f.transcript, 'utf8'));
});
test('managed PowerShell retries offline and invalid ACKs, atomically commits a valid ACK and does not resend it', { skip: !available && 'PowerShell is not installed', timeout: 60_000 }, async t => {
  const f = managedFixture(t), requests = [];
  let mode = 'offline';
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers['content-type'] } }).formData();
      requests.push({ key: request.headers['idempotency-key'], end: Number(form.get('byte_end')), segment: await form.get('segment').text() });
      response.setHeader('Content-Type', 'application/json');
      if (mode === 'offline') { response.writeHead(503); response.end('{}'); return; }
      response.end(JSON.stringify({ segment_id: 'fixture-segment', accepted_offset: mode === 'invalid' ? -1 : Number(form.get('byte_end')), segment_sha256: form.get('segment_sha256') }));
    } catch (error) { response.writeHead(500); response.end('{}'); t.diagnostic(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  writeJson(f.state.configFile, { token: 'synthetic-test-token', dataDir: f.root, uploadMode: 'segments', timeoutSeconds: 3, drainMaxSeconds: 3,
    url: `http://127.0.0.1:${server.address().port}/v2/transcript-segments` });
  const event = capture('codex-openai', { ...f.payload, hook_event_name: 'Stop' }, f.root, true);
  fs.appendFileSync(f.transcript, '{"message":"outside captured boundary"}\n');
  const receipt = path.join(f.root, 'managed-receipt.json');
  const spooled = await executeUploader(f.state, event, receipt);
  assert.equal(readJson(receipt, null)?.spooled, true, spooled.errorOutput);
  const outbox = path.join(f.root, 'outbox');
  const pending = () => fs.readdirSync(outbox).filter(name => name.startsWith('pending-'));
  assert.equal(pending().length, 1);
  const requestFile = path.join(outbox, pending()[0], 'request.json');
  const queued = readJson(requestFile), stateFile = path.join(f.root, 'state', `${queued.stateKey}.json`);
  const retry = async () => {
    const item = readJson(requestFile); item.nextAttemptEpoch = 0; writeJson(requestFile, item);
    return executeUploader(f.state, { source: 'codex-openai', payload: { hook_event_name: 'Drain' } });
  };
  const offline = await retry();
  assert.equal(requests.length, 1, offline.errorOutput); assert.equal(pending().length, 1, offline.errorOutput);
  assert.ok(readJson(requestFile).nextAttemptEpoch > 0, offline.errorOutput);
  assert.equal(readJson(stateFile).ackOffset, 0);
  mode = 'invalid'; const invalid = await retry();
  assert.equal(requests.length, 2, invalid.errorOutput); assert.equal(pending().length, 1, invalid.errorOutput);
  assert.equal(readJson(stateFile).ackOffset, 0);
  assert.match(readJson(path.join(f.root, 'health/delivery-error.json')).error, /invalid acknowledgement/);
  mode = 'valid'; const valid = await retry();
  assert.equal(requests.length, 3, valid.errorOutput); assert.equal(pending().length, 0, valid.errorOutput);
  assert.equal(readJson(stateFile).ackOffset, event.size);
  assert.ok(readJson(path.join(f.root, 'health/upload.json')).lastUploadAt > 0);
  assert.equal(fs.existsSync(path.join(f.root, 'health/delivery-error.json')), false);
  assert.equal(new Set(requests.map(request => request.key)).size, 1);
  for (const request of requests) { assert.equal(request.end, event.size); assert.equal(request.segment, '{"message":"synthetic Unicode fixture"}\n'); }
  await executeUploader(f.state, { source: 'codex-openai', payload: { hook_event_name: 'Drain' } });
  assert.equal(requests.length, 3);
});
