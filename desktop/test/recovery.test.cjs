'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { replace } = require('../runtime/replace.cjs');
const { transaction } = require('../runtime/hooks-config.cjs');
const { AuthSession } = require('../runtime/auth.cjs');
const { RecommendationPoller } = require('../runtime/notifications.cjs');
const { trustedFrame } = require('../runtime/api.cjs');
const { waitForExit } = require('../runtime/lifecycle.cjs');
const { sourceIntact, inventory } = require('../runtime/releases.cjs');
const { atomicWrite, writeJson, readJson } = require('../runtime/files.cjs');
const { apply } = require('../runtime/update.cjs');
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'penelopa-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test('application replacement rolls back failed validation and retains the last working version', async t => {
  const root = temp(t), bundle = path.join(root, 'build'), target = path.join(root, 'installed');
  atomicWrite(path.join(bundle, 'app'), 'new'); atomicWrite(path.join(target, 'app'), 'old');
  await assert.rejects(replace(bundle, target, async () => { throw Error('Launch blocked'); }), /Launch blocked/);
  assert.equal(fs.readFileSync(path.join(target, 'app'), 'utf8'), 'old');
  assert.equal(fs.existsSync(`${target}.staged`), false);
  await replace(bundle, target, async app => assert.equal(fs.readFileSync(path.join(app, 'app'), 'utf8'), 'new'));
  assert.equal(fs.readFileSync(path.join(`${target}.previous`, 'app'), 'utf8'), 'old');
});
test('failed configuration commit restores credentials, hook definitions and runtime pointer together', t => {
  const root = temp(t), hook = path.join(root, 'hooks.json'), pointer = path.join(root, 'node-path'), token = path.join(root, 'credential');
  writeJson(hook, { user: true }); atomicWrite(pointer, '/old/node'); atomicWrite(token, 'old-secret');
  assert.throws(() => transaction([{ file: hook, data: { replaced: true } }, { file: pointer, bytes: '/new/node' }, { file: token, bytes: 'new-secret', sensitive: true }], () => { throw Error('Commit verification failed'); }), /Commit verification/);
  assert.deepEqual(readJson(hook), { user: true }); assert.equal(fs.readFileSync(pointer, 'utf8'), '/old/node'); assert.equal(fs.readFileSync(token, 'utf8'), 'old-secret');
});
test('desktop update migrates Windows capture commands and rolls hooks and launchers back when activation fails', async t => {
  const root = temp(t), configPath = path.join(root, 'codex/hooks.json'), bundle = path.join(root, 'bundle'), target = path.join(root, 'app');
  const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(root, 'bin/capture.ps1')}" codex-openai`;
  const old = { version: '1.0.2', platform: 'win32', nodePath: 'C:\\old runtime\\node.exe', releaseDir: 'old-release', desktop: { path: target },
    agents: [{ name: 'Codex', source: 'codex-openai', configPath, command, ownedCommands: [command] }] };
  const config = { other: 'preserved', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }, { type: 'command', command }] }] } };
  writeJson(path.join(root, 'install.json'), old); writeJson(configPath, config);
  atomicWrite(path.join(root, 'node-path'), old.nodePath + '\n'); atomicWrite(path.join(root, 'bin/hook.cjs'), 'old launcher');
  atomicWrite(path.join(target, 'version'), 'old'); atomicWrite(path.join(bundle, 'version'), 'new');
  const pack = require('../runtime/package.cjs'); let failLaunch = true;
  t.mock.method(pack, 'build', async () => {
    if (!failLaunch) {
      const edited = readJson(configPath); edited.hooks.Stop[0].hooks.push({ type: 'command', command: 'echo added during build' }); writeJson(configPath, edited);
    }
    return bundle;
  });
  t.mock.method(pack, 'smoke', async () => {});
  t.mock.method(pack, 'activate', async () => ({ path: target, previousPath: await replace(bundle, target, async () => {}) }));
  t.mock.method(pack, 'launch', state => { if (state.version !== old.version && failLaunch) throw Error('Synthetic activation failure'); });
  await assert.rejects(apply(0, root), /Synthetic activation failure/);
  assert.deepEqual(readJson(configPath), config); assert.deepEqual(readJson(path.join(root, 'install.json')), old);
  assert.equal(fs.readFileSync(path.join(root, 'node-path'), 'utf8'), old.nodePath + '\n');
  assert.equal(fs.readFileSync(path.join(root, 'bin/hook.cjs'), 'utf8'), 'old launcher');
  assert.equal(fs.readFileSync(path.join(target, 'version'), 'utf8'), 'old');
  failLaunch = false; await apply(0, root);
  const state = readJson(path.join(root, 'install.json')), migrated = readJson(configPath);
  assert.ok(state.agents[0].command.startsWith(`"${process.execPath}" `)); assert.ok(state.agents[0].ownedCommands.includes(command));
  assert.equal(migrated.other, 'preserved');
  assert.deepEqual(migrated.hooks.Stop.flatMap(entry => entry.hooks.map(hook => hook.command)), ['echo unrelated', 'echo added during build', state.agents[0].command]);
  assert.equal(migrated.hooks.SessionEnd[0].hooks[0].command, state.agents[0].command);
  assert.equal(migrated.hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.equal(fs.readFileSync(path.join(root, 'node-path'), 'utf8'), process.execPath + '\n');
  assert.equal(fs.readFileSync(path.join(target, 'version'), 'utf8'), 'new');
});
test('IPC rejects subframes, external origins and destroyed frames', () => {
  const frame = { url: 'https://penelopa.ai/dashboard', isDestroyed: () => false }, contents = { mainFrame: frame };
  assert.equal(trustedFrame(frame, contents), true); assert.equal(trustedFrame({ ...frame }, contents), false);
  frame.url = 'https://penelopa.ai.evil.example/dashboard'; assert.equal(trustedFrame(frame, contents), false);
  frame.url = 'penelopa://app/index.html'; assert.equal(trustedFrame(frame, contents, true), true); assert.equal(trustedFrame(frame, contents), false);
  frame.isDestroyed = () => true; assert.equal(trustedFrame(frame, contents, true), false);
});
test('revoked or unreadable credentials remain in connection recovery across restarts', async t => {
  const root = temp(t), configFile = path.join(root, 'credential.env');
  atomicWrite(configFile, 'AUTO_IMPROVE_TOKEN=existing-account\n'); writeJson(path.join(root, 'install.json'), { platform: 'darwin', configFile });
  const storage = { isEncryptionAvailable: () => true, encryptString: Buffer.from, decryptString: value => value.toString() };
  const first = new AuthSession(storage, root); await first.initialise(); first.signOut('Your installed account needs to be reconnected.');
  const second = new AuthSession(storage, root); await second.initialise(); assert.equal(second.token, null); assert.equal(second.state().signedOut, true);
  atomicWrite(path.join(root, 'auth.json'), '{ broken'); const third = new AuthSession(storage, root); await third.initialise(); assert.equal(third.token, null); assert.match(third.state().error, /could not be read/);
});
test('sign-out during recommendation polling suppresses notifications and preserves deduplication', async t => {
  const root = temp(t); let token = 'account', finish, started;
  const ready = new Promise(resolve => { started = resolve; }); let notifications = 0;
  const poller = new RecommendationPoller(() => { started(); return new Promise(resolve => { finish = resolve; }); }, () => token, () => notifications++, root);
  const polling = poller.poll(); await ready; token = null;
  finish({ status: 200, data: { items: [{ id: 'new', created_at: new Date().toISOString() }], total: 1 } }); await polling;
  assert.equal(notifications, 0); assert.equal(fs.existsSync(path.join(root, 'notification-state.json')), false);
});
test('replacement waits for process exit even after the quit marker is removed', async t => {
  const root = temp(t), marker = path.join(root, 'desktop-running.json');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},400)'], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  writeJson(marker, { pid: child.pid }); fs.unlinkSync(marker);
  const start = performance.now(); await waitForExit(child.pid, 5); assert.ok(performance.now() - start >= 250);
});
test('reinstallation detects missing or damaged source even when its verification marker survives', t => {
  const root = temp(t); atomicWrite(path.join(root, 'runtime', 'hook.cjs'), 'original');
  const manifest = { source: { sha256: 'a'.repeat(64) } };
  writeJson(path.join(root, '.verified.json'), { sha256: manifest.source.sha256, files: inventory(root) });
  assert.equal(sourceIntact(root, manifest), true);
  atomicWrite(path.join(root, 'runtime', 'hook.cjs'), 'damaged'); assert.equal(sourceIntact(root, manifest), false);
  fs.rmSync(path.join(root, 'runtime', 'hook.cjs')); assert.equal(sourceIntact(root, manifest), false);
});
