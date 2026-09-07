'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createZip, extractZip } = require('../runtime/archive.cjs');
const { editHooks } = require('../runtime/hooks-config.cjs');
const { validateRequest, externalUrl } = require('../runtime/api.cjs');
const { advance, RecommendationPoller } = require('../runtime/notifications.cjs');
const { AuthSession } = require('../runtime/auth.cjs');
const { writeJson, readJson, atomicWrite } = require('../runtime/files.cjs');
const { capture } = require('../runtime/hook.cjs');
const { newer, check, prepare } = require('../runtime/update.cjs');
const releases = require('../runtime/releases.cjs');
const startup = require('../runtime/startup.cjs');
const { enableFreshInstallAutostart } = require('../runtime/install.cjs');
const { temporary, installation } = require('./fixtures.cjs');

function fixture(t) { return installation(temporary(t)); }
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
test('recommendation polling reports safe health without turning API failures into notifications', async t => {
  const root = temporary(t), reports = [], notifications = [];
  const item = { id: 'rec-1', title: 'Private recommendation title', created_at: '2026-09-02T00:00:00Z' };
  const poller = new RecommendationPoller(async () => ({ status: 200, data: { items: [item], total: 1 } }), () => 'private-token', items => notifications.push(items), root, event => reports.push(event));
  await poller.poll();
  assert.deepEqual(reports.map(event => event.status), ['checking', 'healthy']);
  assert.equal(notifications.length, 0, 'the initial poll establishes a baseline');
  assert.equal(fs.readFileSync(path.join(root, 'notification-state.json'), 'utf8').includes('private-token'), false);

  const failures = [], failed = new RecommendationPoller(async () => ({ status: 503, data: {} }), () => 'private-token', () => assert.fail('a failed poll must not notify'), temporary(t), event => failures.push(event));
  await failed.poll();
  assert.deepEqual(failures.map(event => event.status), ['checking', 'retrying']);
  assert.equal(failures.at(-1).failures, 1);

  const signedOut = [];
  await new RecommendationPoller(async () => assert.fail('signed-out polling must not call the API'), () => null, () => {}, temporary(t), event => signedOut.push(event)).poll();
  assert.deepEqual(signedOut, [{ type: 'poll', status: 'signed-out' }]);
});
test('update checks expose availability and safe failure stages', async t => {
  const root = temporary(t);
  writeJson(path.join(root, 'install.json'), { version: '1.0.5' });
  t.mock.method(releases, 'getManifest', async () => ({ version: '1.0.6' }));
  const result = await check(root);
  assert.deepEqual({ phase: result.phase, operation: result.operation, available: result.available, version: result.version }, { phase: 'idle', operation: 'check', available: true, version: '1.0.6' });
  assert.ok(result.checkedAt);
});
test('update manifest and source failures retain a safe retry state', async t => {
  const root = temporary(t);
  writeJson(path.join(root, 'install.json'), { version: '1.0.5' });
  t.mock.method(releases, 'getManifest', async () => { throw Error('private network detail'); });
  await assert.rejects(check(root), /private network detail/);
  let state = readJson(path.join(root, 'update.json'));
  assert.deepEqual({ phase: state.phase, errorCode: state.errorCode, error: state.error }, {
    phase: 'error', errorCode: 'manifest-unavailable', error: 'Could not check for updates. Check your connection and retry.',
  });
  assert.equal(JSON.stringify(state).includes('private network detail'), false);

  t.mock.restoreAll();
  t.mock.method(releases, 'getManifest', async () => ({ version: '1.0.6' }));
  t.mock.method(releases, 'prepareSource', async () => { throw Error('download private path'); });
  await assert.rejects(prepare(1, root), /download private path/);
  state = readJson(path.join(root, 'update.json'));
  assert.equal(state.phase, 'error'); assert.equal(state.errorCode, 'source-download'); assert.equal(state.available, true);
  assert.equal(JSON.stringify(state).includes('download private path'), false);
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
test('fresh desktop installs enable autostart by default and persist the preference', t => {
  const root = temporary(t), state = { desktop: { executable: '/Applications/Penelopa.ai.app/Contents/MacOS/Penelopa' } };
  const calls = [];
  t.mock.method(startup, 'setAutostart', (enabled, install) => { calls.push([enabled, install]); return { enabled: true }; });
  const result = enableFreshInstallAutostart(root, state, null, () => {});
  assert.equal(result.attempted, true); assert.equal(result.enabled, true);
  assert.deepEqual(calls, [[true, state]]);
  assert.deepEqual(readJson(path.join(root, 'preferences.json')), { autostart: true });
});
test('default autostart skips existing installs, explicit preferences and hooks-only state', t => {
  const state = { desktop: { executable: '/Applications/Penelopa.ai.app/Contents/MacOS/Penelopa' } };
  let calls = 0;
  t.mock.method(startup, 'setAutostart', () => { calls++; throw new Error('should not be called'); });
  assert.equal(enableFreshInstallAutostart(temporary(t), state, { desktop: { path: '/old/Penelopa.ai.app' } }, () => {}).attempted, false);
  const explicit = temporary(t); writeJson(path.join(explicit, 'preferences.json'), { autostart: false });
  assert.equal(enableFreshInstallAutostart(explicit, state, null, () => {}).attempted, false);
  assert.equal(enableFreshInstallAutostart(temporary(t), {}, null, () => {}).attempted, false);
  assert.equal(calls, 0);
});
test('default autostart failure does not fail installation state changes', t => {
  const root = temporary(t), state = { desktop: { executable: '/Applications/Penelopa.ai.app/Contents/MacOS/Penelopa' } };
  const logs = [];
  t.mock.method(startup, 'setAutostart', () => { throw new Error('permission denied'); });
  const result = enableFreshInstallAutostart(root, state, null, message => logs.push(message));
  assert.equal(result.attempted, true); assert.equal(result.enabled, false);
  assert.match(logs.join('\n'), /Warning: launch at login could not be enabled automatically. permission denied/);
  assert.equal(readJson(path.join(root, 'preferences.json'), null), null);
});
test('fresh installation, repair and uninstall preserve account and unrelated hooks', { timeout: 120_000 }, t => {
  const f = fixture(t); const codex = path.join(f.env.CODEX_HOME, 'hooks.json');
  writeJson(codex, { other: 'preserve-me', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }] } });
  let result = f.run('--no-desktop'); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim().split(/\r?\n/).at(-1), 'Penelopa: Private dashboard: https://penelopa.ai/dashboard#token=fixture-private-token');
  const before = fs.readFileSync(f.configFile, 'utf8');
  assert.equal(readJson(path.join(f.root, 'install.json')).selfTest.passed, true);
  const restoreLegacyCommands = () => {
    const state = readJson(path.join(f.root, 'install.json'));
    for (const agent of state.agents) {
      const legacy = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(f.root, 'bin/capture.ps1')}" ${agent.source}`;
      writeJson(agent.configPath, editHooks(readJson(agent.configPath), legacy, agent.ownedCommands, agent.name === 'Claude Code'));
      agent.command = legacy; agent.ownedCommands = [legacy];
    }
    writeJson(path.join(f.root, 'install.json'), state);
  };
  const verifyMigration = () => {
    const state = readJson(path.join(f.root, 'install.json'));
    for (const agent of state.agents) {
      assert.equal(agent.command.includes('capture.ps1'), false);
      if (process.platform === 'win32') assert.ok(agent.command.startsWith(`"${state.nodePath}" `), agent.command);
      const hooks = readJson(agent.configPath).hooks;
      for (const event of ['Stop', 'SessionEnd']) {
        const commands = hooks[event].flatMap(entry => entry.hooks.map(hook => hook.command));
        assert.equal(commands.filter(command => command === agent.command).length, 1);
        assert.equal(commands.some(command => command.includes('capture.ps1')), false);
      }
    }
    assert.equal(fs.readFileSync(f.configFile, 'utf8'), before);
  };
  restoreLegacyCommands();
  result = f.run('--no-desktop'); assert.equal(result.status, 0, result.stderr);
  verifyMigration();
  assert.equal(fs.readFileSync(f.configFile, 'utf8'), before); assert.equal(readJson(codex).hooks.Stop.length, 2);
  restoreLegacyCommands();
  result = f.run('--repair'); assert.equal(result.status, 0, result.stderr);
  verifyMigration();
  result = f.run('--diagnose'); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.includes('fixture-private-token'), false);
  result = f.run('--uninstall'); assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(codex).hooks.Stop.length, 1); assert.equal(readJson(codex).other, 'preserve-me'); assert.equal(fs.existsSync(f.configFile), true);
});
test('access link is printed by default, suppressible and no longer enabled by the old flag', t => {
  let f = fixture(t);
  let result = f.run('--no-desktop');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim().split(/\r?\n/).at(-1), 'Penelopa: Private dashboard: https://penelopa.ai/dashboard#token=fixture-private-token');
  assert.equal(result.stderr.includes('fixture-private-token'), true);

  f = fixture(t);
  result = f.run('--no-desktop', '--no-access-link');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes('Private dashboard:'), false);
  assert.equal(result.stderr.includes('fixture-private-token'), false);

  f = fixture(t);
  result = f.run('--print-access-link');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown or incomplete option: --print-access-link/);
  assert.equal(result.stderr.includes('fixture-private-token'), false);
});
test('malformed agent JSON aborts before credentials or other agent files change', t => {
  const f = fixture(t); const codex = path.join(f.env.CODEX_HOME, 'hooks.json'); const claude = path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json');
  writeJson(codex, { preserved: true }); atomicWrite(claude, '{ broken');
  const result = f.run('--no-desktop'); assert.equal(result.status, 1); assert.deepEqual(readJson(codex), { preserved: true });
  assert.equal(fs.existsSync(f.configFile), false); assert.equal(fs.readFileSync(claude, 'utf8'), '{ broken');
});
