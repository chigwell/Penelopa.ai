'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { atomicWrite, writeJson, readJson } = require('../runtime/files.cjs');
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
