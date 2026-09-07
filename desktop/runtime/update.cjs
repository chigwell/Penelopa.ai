'use strict';
const path = require('node:path');
const { home, writeJson, atomicWrite, installState, lock } = require('./files.cjs');
const releases = require('./releases.cjs');
const { spawn } = require('node:child_process');
const { alive, waitForExit } = require('./lifecycle.cjs');
const { refreshAgents, launcherChanges } = require('./launchers.cjs');
const { prepare: prepareHooks, transaction } = require('./hooks-config.cjs');
function newer(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x.some((n, i) => n > y[i] && x.slice(0, i).every((m, j) => m === y[j])); }
const UPDATE_FILE = root => path.join(root, 'update.json');
const errorMessages = {
  'manifest-unavailable': 'Could not check for updates. Check your connection and retry.',
  'source-download': 'The update download could not be verified. Retry the update.',
  'runtime-download': 'The update runtime could not be prepared. Retry the update.',
  build: 'The update could not be built on this computer. Your current version is preserved.',
  smoke: 'The updated app did not pass its launch check. Your current version is preserved.',
  shutdown: 'Penelopa did not close in time to install the update. Close it and retry.',
  activation: 'The updated app could not be activated. Your current version is preserved.',
  'updater-start': 'The updater could not start. Retry the update.',
  'updater-stopped': 'The updater stopped before finishing. Your current version is preserved. Retry the update.',
};
function readState(root) {
  try { return require('./files.cjs').readJson(UPDATE_FILE(root), {}); } catch { return {}; }
}
function writeState(root, next) {
  const previous = readState(root);
  const state = { ...previous, ...next };
  if (state.error === null) delete state.error;
  if (state.errorCode === null) delete state.errorCode;
  writeJson(UPDATE_FILE(root), state);
  return state;
}
function fail(root, errorCode) {
  const previous = readState(root);
  return writeState(root, {
    phase: 'error',
    operation: errorCode,
    errorCode,
    error: errorMessages[errorCode] || errorMessages.activation,
    available: previous.available,
  });
}
function asUpdateError(errorCode, cause) {
  const error = cause instanceof Error ? cause : new Error(errorMessages[errorCode]);
  error.updateCode = errorCode;
  return error;
}
async function check(root = home()) {
  const state = installState(root);
  writeState(root, { phase: 'checking', operation: 'check', error: null, errorCode: null });
  try {
    const manifest = await releases.getManifest();
    return writeState(root, {
      checkedAt: new Date().toISOString(), available: newer(manifest.version, state.version), version: manifest.version,
      phase: 'idle', operation: 'check', error: null, errorCode: null,
    });
  } catch (error) {
    fail(root, 'manifest-unavailable');
    throw asUpdateError('manifest-unavailable', error);
  }
}
async function prepare(parentPid, root = home()) {
  const state = installState(root);
  let manifest;
  try { manifest = await releases.getManifest(); }
  catch (error) { fail(root, 'manifest-unavailable'); throw asUpdateError('manifest-unavailable', error); }
  if (!newer(manifest.version, state.version)) {
    writeState(root, { phase: 'idle', operation: 'check', available: false, version: manifest.version, checkedAt: new Date().toISOString(), error: null, errorCode: null });
    return;
  }
  writeState(root, { phase: 'downloading', operation: 'source-download', available: true, version: manifest.version, pid: process.pid, error: null, errorCode: null });
  let source;
  try { source = await releases.prepareSource(manifest, root); }
  catch (error) { fail(root, 'source-download'); throw asUpdateError('source-download', error); }
  let node;
  try {
    writeState(root, { phase: 'downloading', operation: 'runtime-download', available: true, version: manifest.version, pid: process.pid });
    node = await releases.ensureRuntime(manifest, root);
  } catch (error) { fail(root, 'runtime-download'); throw asUpdateError('runtime-download', error); }
  let child;
  try {
    child = spawn(node, [path.join(source, 'runtime', 'update.cjs'), '--apply', String(parentPid)], { stdio: 'ignore', detached: true, windowsHide: true, env: { ...process.env, AUTO_IMPROVE_HOME: root } });
  } catch (error) { fail(root, 'updater-start'); throw asUpdateError('updater-start', error); }
  writeState(root, { phase: 'downloading', operation: 'build', available: true, version: manifest.version, pid: child.pid });
  child.on('error', () => fail(root, 'updater-start'));
  child.unref();
}
async function apply(parentPid, root = home()) {
  const unlock = lock(path.join(root, 'locks', 'install.lock'));
  if (!unlock) throw new Error('Another installation is running.');
  const old = installState(root);
  const state = { ...old, version: require('../package.json').version, releaseDir: path.resolve(__dirname, '..'), nodePath: process.execPath };
  let activated = false, operation = 'build';
  try {
    state.agents = refreshAgents(root, state);
    prepareHooks(state.agents); // Validate before spending time on the build.
    writeState(root, { phase: 'building', operation, available: true, version: state.version, pid: process.pid, error: null, errorCode: null });
    const pack = require('./package.cjs');
    const bundle = await pack.build(state);
    operation = 'smoke'; await pack.smoke(bundle);
    operation = 'shutdown'; writeState(root, { phase: 'ready-to-restart', operation, available: true, version: state.version, pid: process.pid });
    await waitForExit(parentPid);
    operation = 'activation';
    state.desktop = await pack.activate(bundle, state);
    activated = true;
    // Migrate old capture commands together with the runtime pointer. If the
    // activation fails, restore the previous launchers and agent definitions.
    // Read agent settings again after the build so edits made while it was
    // running are preserved in the configuration transaction.
    transaction([...launcherChanges(root, state.nodePath), ...prepareHooks(state.agents), { file: path.join(root, 'install.json'), data: state }], () => {
      writeState(root, { phase: 'complete', operation: 'activation', available: false, version: state.version, checkedAt: new Date().toISOString(), error: null, errorCode: null });
      pack.launch(state);
    });
  } catch (error) {
    if (activated) require('./replace.cjs').rollback(state.desktop.path, state.desktop.previousPath);
    writeJson(path.join(root, 'install.json'), old);
    atomicWrite(path.join(root, 'node-path'), old.nodePath + '\n');
    fail(root, error.updateCode || operation);
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
  } catch (error) {
    const current = readState(home());
    if (current.phase !== 'error') fail(home(), error.updateCode || (mode === '--prepare' ? 'updater-start' : 'activation'));
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { check, prepare, apply, newer, fail, writeState };
