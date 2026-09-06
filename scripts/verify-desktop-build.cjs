'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureRuntime } = require('../desktop/runtime/releases.cjs');
const { extractZip } = require('../desktop/runtime/archive.cjs');
const { generateDesktopAssets } = require('./desktop-assets.cjs');
const { writeJson, readJson, fingerprint } = require('../desktop/runtime/files.cjs');
async function main() {
  if (process.argv[2] === '--child') {
    const root = process.argv[3]; process.env.AUTO_IMPROVE_HOME = root;
    const source = path.join(root, 'release');
    const env = { ...process.env, AUTO_IMPROVE_HOME: root, AUTO_IMPROVE_TOKEN: 'synthetic-build-check-token',
      CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), AUTO_IMPROVE_DATA_DIR: path.join(root, 'queue'),
      AUTO_IMPROVE_HOOK_CONFIG: path.join(root, process.platform === 'win32' ? 'credential.json' : 'credential.env'),
      PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0` : '/usr/bin:/bin:/usr/sbin:/sbin',
    };
    const result = spawnSync(process.execPath, [path.join(source, 'runtime', 'install.cjs'), '--no-desktop'], { env, stdio: 'inherit', timeout: 60_000 });
    if (result.status !== 0) throw new Error('Installation with a minimal PATH failed.');
    const state = readJson(path.join(root, 'install.json'));
    const pack = require(path.join(source, 'runtime', 'package.cjs'));
    const bundle = await pack.build(state); await pack.smoke(bundle, root);
    writeJson(path.join(root, 'verification.json'), { platform: process.platform, arch: process.arch, node: process.version, version: state.version, packaged: true, launchVerified: true, bundle });
    console.log(`Verified desktop package: ${bundle}`); console.log(`Report and screenshot: ${root}`); return;
  }
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Native desktop verification runs on macOS or Windows. Use test:desktop for Linux hooks.');
  const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'penelopa-build-'));
  process.env.AUTO_IMPROVE_HOME = root;
  const assets = path.join(root, 'assets');
  const manifest = generateDesktopAssets(path.resolve(__dirname, '..'), assets);
  const archive = fs.readFileSync(path.join(assets, 'desktop/releases', manifest.version, 'source.zip'));
  if (fingerprint(archive) !== manifest.source.sha256) throw new Error('Local source checksum mismatch.');
  extractZip(archive, path.join(root, 'release'));
  const node = await ensureRuntime(manifest, root);
  const result = spawnSync(node, [__filename, '--child', root], { env: { ...process.env, AUTO_IMPROVE_HOME: root }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
