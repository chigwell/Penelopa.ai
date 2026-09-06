'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const { home, mkdir, readJson, writeJson, settings } = require('./files.cjs');
const { download } = require('./network.cjs');
const config = require('../release-config.json');

function executable(bundle) { return process.platform === 'darwin' ? path.join(bundle, 'Contents', 'MacOS', 'Penelopa') : path.join(bundle, 'Penelopa.exe'); }
function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'inherit', timeout: 15 * 60_000, ...options });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Build step exited with status ${code}.`)));
  });
}
async function build(state) {
  const root = home(); const source = state.releaseDir;
  if (!['darwin', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch) || (process.platform === 'win32' && process.arch !== 'x64')) throw new Error('This desktop platform is not supported.');
  if (process.platform === 'darwin') {
    const version = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim().split('.').map(Number);
    if (version[0] < 13 || (version[0] === 13 && version[1] < 5)) throw new Error('Desktop requires macOS 13.5 or later.');
  }
  if (process.platform === 'win32' && Number(os.release().split('.')[2]) < 19045) throw new Error('Desktop requires Windows 10 22H2 or Windows 11.');
  const npmCli = process.platform === 'win32' ? path.join(path.dirname(state.nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : path.resolve(path.dirname(state.nodePath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCli)) throw new Error('The private npm runtime is missing. Run the installer again.');
  await run(state.nodePath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(root, 'cache', 'npm')], {
    cwd: source, env: { ...process.env, PATH: `${path.dirname(state.nodePath)}${path.delimiter}${process.env.PATH || ''}` },
  });
  const archiveName = `electron-v${config.electronVersion}-${process.platform}-${process.arch}.zip`;
  const cache = path.join(root, 'cache', 'electron'); mkdir(cache);
  const digest = config.electron?.[`${process.platform}-${process.arch}`];
  const archive = path.join(cache, archiveName);
  const { fingerprint } = require('./files.cjs');
  if (!fs.existsSync(archive) || fingerprint(fs.readFileSync(archive)) !== digest) {
    await download(`https://github.com/electron/electron/releases/download/v${config.electronVersion}/${archiveName}`, archive, digest);
  }
  const { packager } = await import(pathToFileURL(path.join(source, 'node_modules', '@electron', 'packager', 'dist', 'index.js')).href);
  const { sign } = await import(pathToFileURL(path.join(source, 'node_modules', '@electron', 'osx-sign', 'dist', 'index.js')).href);
  const output = path.join(root, 'build', `${state.version}-${Date.now()}`); mkdir(output);
  const binding = path.join(output, 'penelopa-install.json'); writeJson(binding, { root });
  const bundles = await packager({
    dir: source, out: output, name: 'Penelopa.ai', executableName: 'Penelopa', appBundleId: 'ai.penelopa.desktop',
    appVersion: state.version, platform: process.platform, arch: process.arch, electronVersion: config.electronVersion,
    electronZipDir: cache, asar: true, prune: true, overwrite: true, extraResource: [binding],
    icon: path.join(source, 'assets', process.platform === 'darwin' ? 'app.icns' : 'app.ico'),
    ignore: [/^\/node_modules/, /^\/test(?:\/|$)/, /^\/hooks(?:\/|$)/, /^\/package-lock\.json$/, /^\/runtime\/(?:package|install|worker|hook|upload-request)\.cjs$/],
    extendInfo: { LSMinimumSystemVersion: '13.5', NSHighResolutionCapable: true },
  });
  const bundle = process.platform === 'darwin' ? path.join(bundles[0], 'Penelopa.ai.app') : bundles[0];
  if (process.platform === 'darwin') {
    await sign({ app: bundle, identity: '-', identityValidation: false, preAutoEntitlements: false,
      optionsForFile: () => ({ hardenedRuntime: true, timestamp: 'none', entitlements: path.join(source, 'assets', 'entitlements.plist') }) });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  }
  return bundle;
}
async function smoke(bundle, root = home()) {
  const marker = path.join(root, 'build', `launch-check-${Date.now()}.json`);
  const guidance = process.platform === 'darwin' ? 'If macOS displayed a security block, review System Settings → Privacy & Security for this app. Managed security policies may require your administrator.' : 'If Windows displayed a security block, review its publisher and protection message. Managed security policies may require your administrator.';
  await new Promise((resolve, reject) => {
    const child = spawn(executable(bundle), ['--penelopa-smoke-test', marker], { windowsHide: true, stdio: 'ignore', env: { ...process.env, AUTO_IMPROVE_HOME: root } });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Penelopa.ai did not finish its launch check within 20 seconds. ${guidance}`)); }, 20_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); if (code === 0 && readJson(marker, null)?.ready) resolve(); else reject(new Error(`Desktop launch verification failed (${signal || `exit ${code}`}). ${guidance}`)); });
  });
  fs.rmSync(marker, { force: true });
}
async function activate(bundle, state) {
  const target = process.platform === 'darwin' ? path.join(os.homedir(), 'Applications', 'Penelopa.ai.app') : path.join(process.env.LOCALAPPDATA, 'Programs', 'Penelopa.ai');
  const previous = `${target}.previous`;
  const desktop = { path: target, executable: executable(target), previousPath: previous, version: state.version, signed: process.platform === 'darwin' ? 'ad-hoc' : 'unsigned', error: null };
  await require('./replace.cjs').replace(bundle, target, async () => {
    await smoke(target);
    if (process.platform === 'win32') await run(executable(target), ['--penelopa-register-shortcut'], { stdio: 'ignore', timeout: 20_000, env: { ...process.env, AUTO_IMPROVE_HOME: home() } });
    if (settings().autostart) require('./startup.cjs').setAutostart(true, { ...state, desktop });
  }, () => require('./lifecycle.cjs').requestDesktopExit());
  return desktop;
}
async function buildAndInstall(state) { const bundle = await build(state); await smoke(bundle); return activate(bundle, state); }
function launch(state, background = false) {
  if (!state.desktop?.executable) throw new Error('Desktop is not installed.');
  const child = spawn(state.desktop.executable, background ? ['--background'] : [], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, AUTO_IMPROVE_HOME: home() } });
  child.on('error', () => {}); child.unref();
}
if (require.main === module) buildAndInstall(require('./files.cjs').installState()).then(result => console.log(result.path)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build, activate, smoke, buildAndInstall, launch, run };
