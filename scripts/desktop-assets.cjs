'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSync } = require('esbuild');
const { createZip } = require('../desktop/runtime/archive.cjs');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// outputDirectory has public/'s layout; callers choose a temporary validation
// directory or publication preparation. Generation never downloads dependencies.
function generateDesktopAssets(sourceRoot, outputDirectory) {
  sourceRoot = path.resolve(sourceRoot);
  outputDirectory = path.resolve(outputDirectory);
  const config = readJson(path.join(sourceRoot, 'desktop/release-config.json'));
  if (readJson(path.join(sourceRoot, 'desktop/package.json')).version !== config.version ||
      readJson(path.join(sourceRoot, 'desktop/package-lock.json')).version !== config.version) {
    throw new Error('Desktop package, lockfile and release versions must match.');
  }
  const bundle = buildSync({
    absWorkingDir: sourceRoot, entryPoints: ['desktop/runtime/bootstrap.cjs'],
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', write: false,
  }).outputFiles[0].contents;
  const bootstrapSha = digest(bundle);
  const entries = [];
  function walk(directory, prefix = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'test', '.DS_Store'].includes(item.name) || item.name.startsWith('.')) continue;
      const name = `${prefix}${item.name}`;
      if (item.isDirectory()) walk(path.join(directory, item.name), `${name}/`);
      else if (item.isFile()) entries.push([name, fs.readFileSync(path.join(directory, item.name))]);
    }
  }
  walk(path.join(sourceRoot, 'desktop'));
  for (const name of ['auto-improve-upload.sh', 'auto-improve-upload.ps1']) {
    entries.push([`hooks/${name}`, fs.readFileSync(path.join(sourceRoot, 'public', name))]);
  }
  entries.push(['LICENSE', fs.readFileSync(path.join(sourceRoot, 'LICENSE'))]);
  const archive = createZip(entries);
  const manifest = {
    ...config,
    source: { url: `${config.baseUrl}/releases/${config.version}/source.zip`, sha256: digest(archive) },
    bootstrap: { url: `${config.baseUrl}/bootstrap.cjs`, sha256: bootstrapSha },
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  const versioned = `desktop/releases/${config.version}`;
  const assets = new Map([
    ['desktop/bootstrap.cjs', bundle], [`${versioned}/source.zip`, archive],
    [`${versioned}/manifest.json`, json], ['desktop/manifest.json', json],
  ]);
  for (const [template, destination] of [['bootstrap.sh', 'script'], ['bootstrap.ps1', 'script.ps1']]) {
    assets.set(destination, fs.readFileSync(path.join(sourceRoot, 'scripts', template), 'utf8')
      .replaceAll('@@NODE_VERSION@@', config.nodeVersion).replaceAll('@@BOOTSTRAP_SHA@@', bootstrapSha)
      .replaceAll('@@WIN_NODE_SHA@@', config.node['win-x64'])
      .replaceAll('@@NODE_HASH_CASES@@', Object.entries(config.node).filter(([key]) => !key.startsWith('win'))
        .map(([key, hash]) => `  ${key}) node_sha='${hash}' ;;`).join('\n')));
  }
  // Check both immutable files before writing any mutable entrypoint.
  for (const name of [`${versioned}/source.zip`, `${versioned}/manifest.json`]) {
    const destination = path.join(outputDirectory, name);
    if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(Buffer.from(assets.get(name)))) {
      throw new Error(`Desktop ${config.version} already exists with different content. Bump the desktop package, lockfile and release versions before preparing a new release.`);
    }
  }
  for (const [name, bytes] of assets) {
    const destination = path.join(outputDirectory, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  return manifest;
}

function verifyDesktopAssets(publicDirectory) {
  const desktop = path.join(publicDirectory, 'desktop');
  const manifest = readJson(path.join(desktop, 'manifest.json'));
  const currentVersion = readJson(path.join(desktop, 'releases', manifest.version, 'manifest.json'));
  if (JSON.stringify(manifest) !== JSON.stringify(currentVersion)) throw new Error('Current and versioned desktop manifests differ.');
  if (digest(fs.readFileSync(path.join(desktop, 'bootstrap.cjs'))) !== manifest.bootstrap.sha256) throw new Error('Desktop bootstrap checksum mismatch.');
  for (const name of ['script', 'script.ps1']) {
    if (!fs.readFileSync(path.join(publicDirectory, name), 'utf8').includes(manifest.bootstrap.sha256)) throw new Error(`${name} does not pin the current bootstrap.`);
  }
  for (const version of fs.readdirSync(path.join(desktop, 'releases'), { withFileTypes: true }).filter(item => item.isDirectory())) {
    const directory = path.join(desktop, 'releases', version.name);
    const release = readJson(path.join(directory, 'manifest.json'));
    if (release.version !== version.name || digest(fs.readFileSync(path.join(directory, 'source.zip'))) !== release.source.sha256) {
      throw new Error(`Desktop ${version.name} source checksum mismatch.`);
    }
  }
  return manifest;
}

module.exports = { generateDesktopAssets, verifyDesktopAssets };
