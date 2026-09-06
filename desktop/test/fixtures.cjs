'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractZip } = require('../runtime/archive.cjs');
const { sourceArchive } = require('./assets.cjs');

function temporary(t, prefix = "penelopa spaces ' ü-", beforeRemove) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    if (beforeRemove) await beforeRemove(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return root;
}

function installation(root, token = 'fixture-private-token', extraEnv = {}) {
  const source = path.join(root, 'release');
  extractZip(sourceArchive(), source);
  const configFile = path.join(root, process.platform === 'win32' ? 'credential.json' : 'credential.env');
  const env = {
    ...process.env, ...extraEnv, AUTO_IMPROVE_HOME: root,
    CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    AUTO_IMPROVE_HOOK_CONFIG: configFile, AUTO_IMPROVE_TOKEN: token, AUTO_IMPROVE_DATA_DIR: root,
  };
  return {
    root, source, env, configFile,
    run: (...args) => spawnSync(process.execPath, [path.join(source, 'runtime/install.cjs'), ...args], { env, encoding: 'utf8', timeout: 60_000 }),
  };
}

function powershellPath() {
  if (process.platform === 'win32') {
    const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    return fs.existsSync(executable) ? executable : null;
  }
  // Discover the executable without interpreting a slow startup as absence.
  return spawnSync('which', ['pwsh'], { encoding: 'utf8' }).stdout?.trim() || null;
}

module.exports = { temporary, installation, powershellPath };
