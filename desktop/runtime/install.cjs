'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { home, mkdir, readJson, writeJson, atomicWrite, protect, protectFile, credential, envFile, installState, lock } = require('./files.cjs');
const { prepare, transaction, shellQuote } = require('./hooks-config.cjs');
const { jsonRequest, allowedUrl, download } = require('./network.cjs');
const release = require('../release-config.json');
const pkg = require('../package.json');
const log = message => process.stderr.write(`Penelopa: ${message}\n`);
const valueOptions = {
  agent: ['AUTO_IMPROVE_AGENT', 'both'], url: ['AUTO_IMPROVE_URL', 'https://api.penelopa.ai/v2/transcript-segments'],
  token: ['AUTO_IMPROVE_TOKEN', ''], 'token-url': ['AUTO_IMPROVE_TOKEN_URL', 'https://api.penelopa.ai/v1/auth/bootstrap-token'],
  'dashboard-url': ['AUTO_IMPROVE_DASHBOARD_URL', 'https://penelopa.ai/dashboard'],
  'telegram-settings-url': ['AUTO_IMPROVE_TELEGRAM_SETTINGS_URL', 'https://api.penelopa.ai/v1/user/telegram-notifications'],
  'telegram-link-url': ['AUTO_IMPROVE_TELEGRAM_LINK_URL', 'https://api.penelopa.ai/v1/user/telegram-notifications/link'],
  'env-file': ['AUTO_IMPROVE_ENV_FILE', path.join(process.cwd(), '.env')], 'hook-url': ['AUTO_IMPROVE_HOOK_DOWNLOAD_URL', ''],
  'project-id': ['AUTO_IMPROVE_PROJECT_ID', ''], 'upload-mode': ['AUTO_IMPROVE_UPLOAD_MODE', 'segments'],
  'data-dir': ['AUTO_IMPROVE_DATA_DIR', ''], 'source-schema-version': ['AUTO_IMPROVE_SOURCE_SCHEMA_VERSION', ''],
  'segment-max-bytes': ['AUTO_IMPROVE_SEGMENT_MAX_BYTES', '8388608'], 'drain-max-attempts': ['AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS', '16'],
  'drain-max-seconds': ['AUTO_IMPROVE_DRAIN_MAX_SECONDS', '40'], desktop: ['AUTO_IMPROVE_DESKTOP', 'auto'],
};
function parseArgs(args) {
  const options = Object.fromEntries(Object.entries(valueOptions).map(([key, [env, fallback]]) => [key, process.env[env] || fallback]));
  for (let i = 0; i < args.length; i++) {
    let key = args[i].replace(/^--/, '');
    if (args[i] === '-h') key = 'help';
    if (['help', 'force-new-token', 'install-deps', 'no-desktop', 'diagnose', 'repair', 'uninstall', 'purge-data', 'no-launch', 'print-access-link'].includes(key)) options[key] = true;
    else if (key in valueOptions && args[i + 1] !== undefined) options[key] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (options['no-desktop']) options.desktop = 'off';
  if (!['auto', 'off', 'required'].includes(options.desktop)) throw new Error('--desktop must be auto, off, or required.');
  if (!['codex', 'claude', 'both'].includes(options.agent)) throw new Error('--agent must be codex, claude, or both.');
  if (options['upload-mode'] === 'delta') options['upload-mode'] = 'segments';
  if (options['upload-mode'] !== 'segments') throw new Error('Only durable segment uploads are supported.');
  for (const key of ['segment-max-bytes', 'drain-max-attempts', 'drain-max-seconds']) if (!/^\d+$/.test(options[key]) || !Number.isSafeInteger(Number(options[key])) || Number(options[key]) < 1) throw new Error(`--${key} must be a positive integer.`);
  for (const [key, value] of Object.entries(options)) if (typeof value === 'string' && /[\r\n\0]/.test(value)) throw new Error(`--${key} contains an invalid control character.`);
  if (options['purge-data'] && !options.uninstall) throw new Error('--purge-data requires --uninstall.');
  return options;
}
function help() {
  return `Penelopa.ai installer\n\nUsage: installer [options]\n\n${Object.keys(valueOptions).map(key => `  --${key} VALUE`).join('\n')}\n  --no-desktop             Install hooks only\n  --diagnose               Print a redacted connection report\n  --repair                 Restore Penelopa hooks with the existing token\n  --uninstall              Remove Penelopa hooks and application\n  --purge-data             Also remove Penelopa credentials and queued data\n  --force-new-token        Explicitly create a new account token\n  --no-launch              Build without opening the desktop client\n  --print-access-link      Explicitly print a private browser sign-in link\n  --install-deps           Compatibility flag; private runtime is automatic\n  --help\n`;
}
function preflight(root, desktop) {
  protect(root);
  const probe = path.join(root, `.write-test-${process.pid}`);
  atomicWrite(probe, 'ok'); fs.unlinkSync(probe);
  const disk = fs.statfsSync(root);
  const required = release.minimumFreeBytes[desktop ? 'desktop' : 'hooks'];
  if (Number(disk.bavail) * Number(disk.bsize) < required) throw new Error(`At least ${desktop ? '3 GB' : '300 MB'} of free disk space is required.`);
}
function agentsFor(root, options, previous) {
  const windows = process.platform === 'win32';
  const oldDir = process.env.AUTO_IMPROVE_INSTALL_DIR || path.join(os.homedir(), '.auto-improve', 'hooks');
  const agents = [];
  for (const [id, name, source, configPath] of [
    ['codex', 'Codex', 'codex-openai', path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json')],
    ['claude', 'Claude Code', 'claude-anthropic', path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')],
  ]) {
    if (options.agent !== 'both' && options.agent !== id) continue;
    const command = windows ? `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(root, 'bin', 'capture.ps1')}" ${source}` : `${shellQuote("/bin/sh")} ${shellQuote(path.join(root, 'bin', 'capture.sh'))} ${source}`;
    const legacy = windows ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${path.join(oldDir, 'auto-improve-upload.ps1')}" ${source}` : `${shellQuote(path.join(oldDir, 'auto-improve-upload.sh'))} ${source}`;
    const saved = previous?.agents?.find(agent => agent.source === source);
    agents.push({ id, name, source, configPath, command, detectedAtInstall: fs.existsSync(path.dirname(configPath)), ownedCommands: [...new Set([command, legacy, ...(saved?.ownedCommands || [])])] });
  }
  return agents;
}
function launcherChanges(root) {
  const changes = [];
  const atomicWrite = (file, bytes, mode) => changes.push({ file, bytes, mode });
  const loader = target => `'use strict';\nconst fs=require('node:fs'),path=require('node:path');\nconst root=path.dirname(__dirname);process.env.AUTO_IMPROVE_HOME=root;\nconst state=JSON.parse(fs.readFileSync(path.join(root,'install.json'),'utf8'));\nrequire(path.join(state.releaseDir,'runtime','${target}')).main?.();\n`;
  atomicWrite(path.join(root, 'bin', 'penelopa.cjs'), loader('install.cjs'));
  atomicWrite(path.join(root, 'bin', 'hook.cjs'), `'use strict';\nconst fs=require('node:fs'),path=require('node:path');\nconst root=path.dirname(__dirname);process.env.AUTO_IMPROVE_HOME=root;\ntry { const state=JSON.parse(fs.readFileSync(path.join(root,'install.json'),'utf8')); const hook=require(path.join(state.releaseDir,'runtime','hook.cjs')); const input=fs.readFileSync(0,'utf8'); if(Buffer.byteLength(input)>1048576)throw Error('Input too large'); const event=hook.capture(process.argv[2],JSON.parse(input),root,process.env.PENELOPA_SELF_TEST==='1'); if(event&&process.env.PENELOPA_SELF_TEST!=='1')hook.wake(root); } catch { try {fs.mkdirSync(path.join(root,'health'),{recursive:true,mode:448});fs.writeFileSync(path.join(root,'health','capture-error.json'),JSON.stringify({at:new Date().toISOString(),error:'An event could not be saved. Check transcript access and disk space.'}),{mode:384});}catch{} process.stderr.write('Penelopa: open Connection to check event capture.\\n'); } finally { if(process.argv[2]==='codex-openai')process.stdout.write('{}\\n'); }\n`);
  atomicWrite(path.join(root, 'bin', 'capture.sh'), `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd) || exit 0
node_path=$(cat "$root/node-path") || exit 0
exec "$node_path" "$root/bin/hook.cjs" "$1"
`, 0o700);
  atomicWrite(path.join(root, 'bin', 'capture.ps1'), '\uFEFF' + fs.readFileSync(path.join(__dirname, 'capture.ps1'), 'utf8'));
  atomicWrite(path.join(root, 'node-path'), process.execPath + '\n');
  return changes;
}
async function selfTest(root, state) {
  const { capture } = require('./hook.cjs');
  const { executeUploader } = require('./worker.cjs');
  const directory = fs.mkdtempSync(path.join(root, 'self-test-'));
  const file = path.join(directory, 'transcript.jsonl');
  atomicWrite(file, '{"type":"penelopa_installation_self_test"}\n');
  try {
    const event = capture('codex-openai', { hook_event_name: 'SessionEnd', transcript_path: file, session_id: 'installation-self-test' }, root, true);
    const receipt = path.join(directory, 'receipt.json');
    const configFile = path.join(directory, state.platform === 'win32' ? 'credential.json' : 'credential.env');
    if (state.platform === 'win32') writeJson(configFile, { uploadMode: 'segments', token: '', dataDir: directory });
    else atomicWrite(configFile, 'AUTO_IMPROVE_UPLOAD_MODE=segments\nAUTO_IMPROVE_TOKEN=\n');
    const result = await executeUploader({ ...state, configFile, dataDir: directory }, event, receipt);
    // This invocation contains only synthetic input and a blank credential.
    if (!readJson(receipt, null)?.spooled) throw new Error(`The local hook self-test failed. ${result.errorOutput.trim() || `Uploader exit: ${result.code}.`} Use --diagnose for connection status.`);
    return { passed: true, at: new Date().toISOString() };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(path.join(root, 'self-test-events'), { recursive: true, force: true });
  }
}
async function repair(root = home()) {
  const state = installState(root);
  if (!state || !credential(state)) throw new Error('No installed account was found. Run the installer again.');
  const changes = prepare(state.agents);
  state.selfTest = await selfTest(root, state);
  transaction([...launcherChanges(root), ...changes, { file: path.join(root, 'install.json'), data: state }]);
  return state.selfTest;
}
async function uninstall(root, purge = false) {
  const state = installState(root);
  if (!state) { log('Penelopa is not installed.'); return; }
  // Stop new capture and allow in-flight writes to finish before removing files.
  atomicWrite(path.join(root, 'collection-disabled'), 'uninstall\n');
  await require('./lifecycle.cjs').requestDesktopExit(root);
  await require('./lifecycle.cjs').waitForMarker(path.join(root, 'locks', 'worker.lock', 'owner.json'));
  transaction(prepare(state.agents, true));
  if (state.desktop?.path) await require('./startup.cjs').setAutostart(false, state);
  if (state.desktop?.path) fs.rmSync(state.desktop.path, { recursive: true, force: true });
  if (state.desktop?.previousPath) fs.rmSync(state.desktop.previousPath, { recursive: true, force: true });
  if (process.platform === 'win32' && state.desktop?.path) fs.rmSync(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Penelopa.ai.lnk'), { force: true });
  if (purge) {
    fs.rmSync(state.configFile, { force: true });
    const prefix = `${path.basename(state.configFile)}.bak.`;
    for (const name of fs.readdirSync(path.dirname(state.configFile))) if (name.startsWith(prefix) && /^\d+-\d+$/.test(name.slice(prefix.length))) fs.rmSync(path.join(path.dirname(state.configFile), name), { force: true });
    // Only the known Penelopa spool subdirectories are removed, never an arbitrary data-dir root.
    for (const name of ['state', 'outbox', 'work', 'locks']) fs.rmSync(path.join(state.dataDir, name), { recursive: true, force: true });
    for (const name of ['events', 'auth.json', 'notification-state.json', 'preferences.json', 'health', 'logs']) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  for (const name of ['bin', 'releases']) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'install.json'), { force: true });
  fs.rmSync(path.join(root, 'node-path'), { force: true });
  const removable = ['runtime', 'cache', 'build', 'custom-hooks', 'browser-profile', 'launch-check-profile'];
  if (process.platform === 'win32') {
    const cleanup = path.join(os.tmpdir(), `penelopa-cleanup-${process.pid}.ps1`);
    const quoted = removable.map(name => `'${path.join(root, name).replace(/'/g, "''")}'`).join(',');
    atomicWrite(cleanup, `\uFEFFWait-Process -Id ${process.pid} -ErrorAction SilentlyContinue\nRemove-Item -LiteralPath @(${quoted}) -Recurse -Force -ErrorAction SilentlyContinue\nRemove-Item -LiteralPath $PSCommandPath -Force\n`);
    const child = spawn(state.powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', cleanup], { detached: true, stdio: 'ignore', windowsHide: true }); child.on('error', () => {}); child.unref();
  } else for (const name of removable) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  log(purge ? 'Penelopa removed, including its credentials and queued data.' : 'Penelopa removed. Credentials and queued data were retained.');
}
async function install(options, root = home()) {
  const previous = installState(root);
  const official = options.url === 'https://api.penelopa.ai/v2/transcript-segments' && options['dashboard-url'] === 'https://penelopa.ai/dashboard' && options['token-url'] === 'https://api.penelopa.ai/v1/auth/bootstrap-token';
  const desktop = options.desktop !== 'off' && ['darwin', 'win32'].includes(process.platform) && official;
  if (options.desktop === 'required' && !desktop) throw new Error('Desktop requires macOS or Windows x64 and the production Penelopa endpoints.');
  preflight(root, false);
  const agents = agentsFor(root, options, previous);
  const changes = prepare(agents); // Validate all existing configurations before any token request or write.
  const configFile = process.env.AUTO_IMPROVE_HOOK_CONFIG || previous?.configFile || path.join(os.homedir(), process.platform === 'win32' ? '.auto-improve-hook.json' : '.auto-improve-hook.env');
  const oldCredential = credential({ platform: process.platform, configFile });
  let token = options.token || (!options['force-new-token'] ? oldCredential || envFile(options['env-file']).API_ACCESS_TOKEN : '');
  if (!token) {
    log('Connecting your account');
    const response = await jsonRequest(options['token-url'], { method: 'POST', headers: { Accept: 'application/json' } });
    token = response?.api_token;
    if (typeof token !== 'string' || !token.trim() || /[\r\n\0]/.test(token)) throw new Error('The token endpoint did not return a valid api_token.');
  }
  const dataDir = path.resolve(options['data-dir'] || previous?.dataDir || root);
  protect(dataDir);
  const config = { url: options.url, token, projectId: options['project-id'], uploadMode: 'segments', dataDir,
    sourceSchemaVersion: options['source-schema-version'], segmentMaxBytes: Number(options['segment-max-bytes']),
    drainMaxAttempts: Number(options['drain-max-attempts']), drainMaxSeconds: Number(options['drain-max-seconds']), timeoutSeconds: 15 };
  allowedUrl(config.url);
  let uploaderPath = previous?.uploaderPath || null;
  if (options['hook-url']) {
    allowedUrl(options['hook-url']);
    const response = await fetch(options['hook-url'], { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Custom hook download returned HTTP ${response.status}.`);
    const script = await response.text();
    if (Buffer.byteLength(script) > 2_097_152) throw new Error('Custom hook is too large.');
    uploaderPath = path.join(root, 'custom-hooks', process.platform === 'win32' ? 'upload.ps1' : 'upload.sh');
    atomicWrite(uploaderPath, script, 0o700);
  }
  const state = { schemaVersion: 1, version: pkg.version, platform: process.platform, arch: process.arch, installedAt: new Date().toISOString(),
    releaseDir: path.resolve(__dirname, '..'), nodePath: process.execPath, configFile, dataDir,
    agents: [...(previous?.agents || []).filter(old => !agents.some(agent => agent.configPath === old.configPath)), ...agents], desktopAllowed: official,
    powershellPath: process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null,
    desktop: previous?.desktop || null, releaseBaseUrl: release.baseUrl, uploaderPath };
  state.selfTest = await selfTest(root, state);
  log('Installing hooks');
  const credentialChange = process.platform === 'win32' ? { file: configFile, data: config } : { file: configFile, bytes: Object.entries({ AUTO_IMPROVE_URL: config.url, AUTO_IMPROVE_TOKEN: token, AUTO_IMPROVE_PROJECT_ID: config.projectId,
      AUTO_IMPROVE_UPLOAD_MODE: 'segments', AUTO_IMPROVE_DATA_DIR: dataDir, AUTO_IMPROVE_SOURCE_SCHEMA_VERSION: config.sourceSchemaVersion,
      AUTO_IMPROVE_SEGMENT_MAX_BYTES: config.segmentMaxBytes, AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS: config.drainMaxAttempts, AUTO_IMPROVE_DRAIN_MAX_SECONDS: config.drainMaxSeconds }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n' };
  credentialChange.sensitive = true;
  transaction([credentialChange, ...launcherChanges(root), ...changes, { file: path.join(root, 'install.json'), data: state }], () => protectFile(configFile));
  fs.rmSync(path.join(root, 'collection-disabled'), { force: true });
  if (desktop) {
    try {
      preflight(root, true); log('Building app');
      state.desktop = await require('./package.cjs').buildAndInstall(state);
      writeJson(path.join(root, 'install.json'), state);
      if (!options['no-launch']) { log('Opening Penelopa.ai'); require('./package.cjs').launch(state); }
    } catch (error) {
      state.desktop = { ...state.desktop, error: 'Desktop setup did not finish. Retry the installer; your hooks and account are preserved.' };
      writeJson(path.join(root, 'install.json'), state);
      log(`${state.desktop.error} ${error.message}`); process.exitCode = 2;
    }
  }
  log('Hooks installed and local delivery checked. In Codex, review Stop and SessionEnd in Settings → Hooks (CLI: /hooks).');
  if (!desktop) log('Open https://penelopa.ai/dashboard. Use --print-access-link only when you want to reveal a private browser sign-in link.');
  if (options['print-access-link']) log(`Private dashboard: ${options['dashboard-url']}#token=${encodeURIComponent(token)}`);
  return state;
}
async function main(args = process.argv.slice(2)) {
  let unlock;
  try {
    const options = parseArgs(args); const root = home();
    if (options.help) return process.stdout.write(help());
    if (options.diagnose) return process.stdout.write(JSON.stringify(require('./status.cjs').diagnostics(root), null, 2) + '\n');
    mkdir(root); unlock = lock(path.join(root, 'locks', 'install.lock'));
    if (!unlock) throw new Error('Another Penelopa installation is already running.');
    if (options.uninstall) await uninstall(root, options['purge-data']);
    else if (options.repair) { await repair(root); log('Hooks repaired. Review changed hooks in your coding agent.'); }
    else await install(options, root);
  } catch (error) { log(error.message); process.exitCode = 1; }
  finally { if (unlock) unlock(); }
}
if (require.main === module) main();
module.exports = { main, install, repair, uninstall, selfTest, parseArgs, agentsFor, preflight };
