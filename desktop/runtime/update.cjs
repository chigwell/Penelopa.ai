'use strict';
const path = require('node:path');
const { home, writeJson, atomicWrite, installState, lock } = require('./files.cjs');
const { getManifest, prepareSource, ensureRuntime } = require('./releases.cjs');
const { spawn } = require('node:child_process');
const { alive, waitForExit } = require('./lifecycle.cjs');
const { refreshAgents, launcherChanges } = require('./launchers.cjs');
const { prepare: prepareHooks, transaction } = require('./hooks-config.cjs');
function newer(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x.some((n, i) => n > y[i] && x.slice(0, i).every((m, j) => m === y[j])); }
async function check(root = home()) {
  const state = installState(root); const manifest = await getManifest();
  const result = { checkedAt: new Date().toISOString(), available: newer(manifest.version, state.version), version: manifest.version, phase: 'idle' };
  writeJson(path.join(root, 'update.json'), result); return result;
}
async function prepare(parentPid, root = home()) {
  const state = installState(root); const manifest = await getManifest();
  if (!newer(manifest.version, state.version)) { writeJson(path.join(root, 'update.json'), { phase: 'idle', available: false, checkedAt: new Date().toISOString() }); return; }
  writeJson(path.join(root, 'update.json'), { phase: 'downloading', version: manifest.version, pid: process.pid });
  const source = await prepareSource(manifest, root); const node = await ensureRuntime(manifest, root);
  const child = spawn(node, [path.join(source, 'runtime', 'update.cjs'), '--apply', String(parentPid)], { stdio: 'ignore', detached: true, windowsHide: true, env: { ...process.env, AUTO_IMPROVE_HOME: root } });
  writeJson(path.join(root, 'update.json'), { phase: 'downloading', version: manifest.version, pid: child.pid });
  child.on('error', () => writeJson(path.join(root, 'update.json'), { phase: 'error', error: 'The updater could not start. Your current version is preserved.' })); child.unref();
}
async function apply(parentPid, root = home()) {
  const unlock = lock(path.join(root, 'locks', 'install.lock'));
  if (!unlock) throw new Error('Another installation is running.');
  const old = installState(root);
  const state = { ...old, version: require('../package.json').version, releaseDir: path.resolve(__dirname, '..'), nodePath: process.execPath };
  let activated = false;
  try {
    state.agents = refreshAgents(root, state);
    prepareHooks(state.agents); // Validate before spending time on the build.
    writeJson(path.join(root, 'update.json'), { phase: 'building', version: state.version, pid: process.pid });
    const pack = require('./package.cjs'); const bundle = await pack.build(state); await pack.smoke(bundle);
    writeJson(path.join(root, 'update.json'), { phase: 'ready-to-restart', version: state.version, pid: process.pid });
    await waitForExit(parentPid);
    state.desktop = await pack.activate(bundle, state);
    activated = true;
    // Migrate old capture commands together with the runtime pointer. If the
    // activation fails, restore the previous launchers and agent definitions.
    // Read agent settings again after the build so edits made while it was
    // running are preserved in the configuration transaction.
    transaction([...launcherChanges(root, state.nodePath), ...prepareHooks(state.agents), { file: path.join(root, 'install.json'), data: state }], () => {
      writeJson(path.join(root, 'update.json'), { phase: 'complete', version: state.version, checkedAt: new Date().toISOString() });
      pack.launch(state);
    });
  } catch (error) {
    if (activated) require('./replace.cjs').rollback(state.desktop.path, state.desktop.previousPath);
    writeJson(path.join(root, 'install.json'), old);
    atomicWrite(path.join(root, 'node-path'), old.nodePath + '\n');
    writeJson(path.join(root, 'update.json'), { phase: 'error', error: 'Update failed. The previous version and your data have been preserved.' });
    if (!alive(parentPid)) require('./package.cjs').launch(old);
    throw error;
  } finally { unlock(); }
}
async function main() {
  const [mode, pid] = process.argv.slice(2);
  try {
    if (!/^\d+$/.test(pid || '') || Number(pid) < 1) throw new Error('Invalid parent process.');
    if (mode === '--prepare') await prepare(Number(pid));
    else if (mode === '--apply') await apply(Number(pid));
    else if (mode === '--uninstall') { await waitForExit(Number(pid)); await require('./install.cjs').uninstall(home(), process.argv.includes('--purge-data')); }
    else throw new Error('Invalid update operation.');
  } catch { writeJson(path.join(home(), 'update.json'), { phase: 'error', error: 'The operation did not complete. The existing version and queued data are preserved; retry from App settings.' }); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { check, prepare, apply, newer };
