'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createZip, extractZip } = require('../runtime/archive.cjs');
const { editHooks } = require('../runtime/hooks-config.cjs');
const { validateRequest, externalUrl } = require('../runtime/api.cjs');
const { advance } = require('../runtime/notifications.cjs');
const { AuthSession } = require('../runtime/auth.cjs');
const { writeJson, readJson, atomicWrite, fingerprint } = require('../runtime/files.cjs');
const { capture } = require('../runtime/hook.cjs');
const { newer } = require('../runtime/update.cjs');

function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "penelopa spaces ' ü-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function fixture(t) {
  const root = temporary(t), source = path.join(root, 'release');
  const archive = fs.readFileSync(path.join(__dirname, '../../public/desktop/releases/1.0.0/source.zip'));
  extractZip(archive, source);
  const configFile = path.join(root, process.platform === 'win32' ? 'credential.json' : 'credential.env');
  const env = { ...process.env, AUTO_IMPROVE_HOME: root, CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), AUTO_IMPROVE_HOOK_CONFIG: configFile, AUTO_IMPROVE_TOKEN: 'fixture-private-token', AUTO_IMPROVE_DATA_DIR: root };
  return { root, source, env, configFile, run: (...args) => spawnSync(process.execPath, [path.join(source, 'runtime/install.cjs'), ...args], { env, encoding: 'utf8', timeout: 60_000 }) };
}
test('archive round-trip is deterministic and rejects path traversal and corruption', t => {
  const root = temporary(t);
  const entries = [['package.json', '{}'], ['nested/hello ü.txt', 'hello']];
  const zip = createZip(entries); assert.deepEqual(zip, createZip(entries)); extractZip(zip, root);
  assert.equal(fs.readFileSync(path.join(root, 'nested/hello ü.txt'), 'utf8'), 'hello');
  assert.throws(() => extractZip(createZip([['package.json', '{}'], ['../escape', 'bad']]), path.join(root, 'unsafe')), /Unsafe/);
  const broken = Buffer.from(zip); broken[30 + Buffer.byteLength('nested/hello ü.txt')] ^= 1;
  assert.throws(() => extractZip(broken, path.join(root, 'broken')), /Corrupt/);
});
test('hook changes preserve unrelated settings and are idempotent', () => {
  const original = { permissions: { mode: 'ask' }, hooks: { Stop: [{ matcher: 'custom', hooks: [{ type: 'command', command: 'unrelated' }, { type: 'command', command: 'old-penelopa' }] }], PreToolUse: [{ hooks: [] }] } };
  const first = editHooks(structuredClone(original), 'new-penelopa', ['old-penelopa', 'new-penelopa'], false);
  const second = editHooks(structuredClone(first), 'new-penelopa', ['old-penelopa', 'new-penelopa'], false);
  assert.deepEqual(first, second); assert.deepEqual(first.permissions, original.permissions);
  assert.equal(first.hooks.Stop[0].hooks[0].command, 'unrelated'); assert.equal(first.hooks.SessionEnd[0].hooks[0].timeout, 3);
  const removed = editHooks(structuredClone(first), '', ['new-penelopa'], false, true);
  assert.equal(removed.hooks.Stop.length, 1); assert.equal(removed.hooks.SessionEnd, undefined); assert.deepEqual(removed.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.throws(() => editHooks({ hooks: [] }, 'test', [], false), /JSON object/);
});
test('API bridge only permits current dashboard operations', () => {
  assert.equal(validateRequest({ path: '/v1/admin/stats/summary' }).method, 'GET');
  assert.equal(validateRequest({ path: '/v1/user/telegram-notifications/connection', method: 'DELETE' }).method, 'DELETE');
  assert.doesNotThrow(() => validateRequest({ path: '/v1/user/telegram-notifications', method: 'PATCH', body: { enabled: true, language: 'en', notification_types: ['recommendation_created'] } }));
  for (const request of [
    { path: 'https://evil.example/v1/admin/stats/summary' }, { path: '//evil.example/v1/admin/stats/summary' },
    { path: '/v1/admin/stats/summary', method: 'POST' }, { path: '/v1/auth/bootstrap-token', method: 'POST' },
    { path: '/v1/hermes/recommendations/../admin' }, { path: '/v1/hermes/recommendations?redirect=https://evil.example' },
    { path: '/v1/user/telegram-notifications', method: 'PATCH', body: { command: 'execute' } },
  ]) assert.throws(() => validateRequest(request));
  assert.equal(externalUrl('file:///etc/passwd'), false); assert.equal(externalUrl('javascript:alert(1)'), false); assert.equal(externalUrl('https://t.me/penelopa'), true);
});
test('notification baseline, deduplication, account changes and version comparison', () => {
  const old = { id: 'old', title: 'Old', created_at: '2026-09-01T00:00:00Z' };
  const fresh = { id: 'new', title: 'New', created_at: '2026-09-02T00:00:00Z' };
  const baseline = advance(null, [old], 'a'); assert.equal(baseline.fresh.length, 0);
  const next = advance(baseline.state, [fresh, old], 'a'); assert.deepEqual(next.fresh, [fresh]);
  assert.equal(advance(next.state, [fresh, old], 'a').fresh.length, 0);
  assert.equal(advance(next.state, [fresh, old], 'b').fresh.length, 0);
  assert.equal(newer('1.1.0', '1.0.9'), true); assert.equal(newer('1.0.1', '1.1.0'), false);
});
test('desktop imports credentials without exposing them and persists sign-out', async t => {
  const root = temporary(t), configFile = path.join(root, 'credential.env');
  atomicWrite(configFile, 'AUTO_IMPROVE_TOKEN=private-token\n'); writeJson(path.join(root, 'install.json'), { platform: 'darwin', configFile });
  const storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: value => value.toString().split('').reverse().join('') };
  const auth = new AuthSession(storage, root); await auth.initialise(); assert.equal(auth.state().authenticated, true);
  assert.equal(JSON.stringify(auth.state()).includes('private-token'), false); assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8').includes('private-token'), false);
  auth.signOut(); const restarted = new AuthSession(storage, root); await restarted.initialise(); assert.equal(restarted.token, null);
  await restarted.connect(); assert.equal(restarted.token, 'private-token');
});
test('capture is durable, bounded by a snapshot and does not report synthetic activity', t => {
  const root = temporary(t), transcript = path.join(root, 'session.jsonl'); atomicWrite(transcript, '{"message":"original"}\n');
  const start = performance.now(); const event = capture('codex-openai', { hook_event_name: 'SessionEnd', transcript_path: transcript }, root);
  assert.ok(performance.now() - start < 2500); fs.appendFileSync(transcript, '{"message":"later"}\n');
  assert.ok(event.size < fs.statSync(transcript).size); assert.equal(fs.readdirSync(path.join(root, 'events')).length, 1);
  writeJson(path.join(root, 'preferences.json'), { paused: true }); assert.equal(capture('codex-openai', { hook_event_name: 'Stop', transcript_path: transcript }, root), null);
  const other = path.join(root, 'synthetic'); capture('claude-anthropic', { hook_event_name: 'Stop', transcript_path: transcript }, other, true);
  assert.equal(fs.existsSync(path.join(other, 'health')), false);
});
test('fresh installation, repair and uninstall preserve account and unrelated hooks', { timeout: 120_000 }, t => {
  const f = fixture(t); const codex = path.join(f.env.CODEX_HOME, 'hooks.json');
  writeJson(codex, { other: 'preserve-me', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }] } });
  let result = f.run('--no-desktop'); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes('fixture-private-token'), false);
  const before = fs.readFileSync(f.configFile, 'utf8');
  assert.equal(readJson(path.join(f.root, 'install.json')).selfTest.passed, true);
  result = f.run('--no-desktop'); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(f.configFile, 'utf8'), before); assert.equal(readJson(codex).hooks.Stop.length, 2);
  result = f.run('--repair'); assert.equal(result.status, 0, result.stderr);
  result = f.run('--diagnose'); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.includes('fixture-private-token'), false);
  result = f.run('--uninstall'); assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(codex).hooks.Stop.length, 1); assert.equal(readJson(codex).other, 'preserve-me'); assert.equal(fs.existsSync(f.configFile), true);
});
test('malformed agent JSON aborts before credentials or other agent files change', t => {
  const f = fixture(t); const codex = path.join(f.env.CODEX_HOME, 'hooks.json'); const claude = path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json');
  writeJson(codex, { preserved: true }); atomicWrite(claude, '{ broken');
  const result = f.run('--no-desktop'); assert.equal(result.status, 1); assert.deepEqual(readJson(codex), { preserved: true });
  assert.equal(fs.existsSync(f.configFile), false); assert.equal(fs.readFileSync(claude, 'utf8'), '{ broken');
});
test('published artifacts match their pinned manifest', () => {
  const base = path.join(__dirname, '../../public/desktop'); const manifest = readJson(path.join(base, 'manifest.json'));
  assert.equal(fingerprint(fs.readFileSync(path.join(base, `releases/${manifest.version}/source.zip`))), manifest.source.sha256);
  assert.equal(fingerprint(fs.readFileSync(path.join(base, 'bootstrap.cjs'))), manifest.bootstrap.sha256);
  assert.ok(fs.readFileSync(path.join(__dirname, '../../public/script'), 'utf8').includes(manifest.bootstrap.sha256));
});
