'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSync } = require('esbuild');
const { createZip } = require('../desktop/runtime/archive.cjs');
const root = path.resolve(__dirname, '..'); const config = require('../desktop/release-config.json');
if (require('../desktop/package.json').version !== config.version || require('../desktop/package-lock.json').version !== config.version) throw new Error('Desktop package, lockfile and release versions must match.');
const output = path.join(root, 'public', 'desktop'); fs.mkdirSync(output, { recursive: true });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
buildSync({ entryPoints: [path.join(root, 'desktop', 'runtime', 'bootstrap.cjs')], outfile: path.join(output, 'bootstrap.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
const bootstrapSha = digest(fs.readFileSync(path.join(output, 'bootstrap.cjs')));
const entries = [];
function walk(directory, prefix = '') {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'test', '.DS_Store'].includes(item.name) || item.name.startsWith('.')) continue;
    const name = `${prefix}${item.name}`;
    if (item.isDirectory()) walk(path.join(directory, item.name), `${name}/`);
    else if (item.isFile()) entries.push([name, fs.readFileSync(path.join(directory, item.name))]);
  }
}
walk(path.join(root, 'desktop'));
for (const name of ['auto-improve-upload.sh', 'auto-improve-upload.ps1']) entries.push([`hooks/${name}`, fs.readFileSync(path.join(root, 'public', name))]);
entries.push(['LICENSE', fs.readFileSync(path.join(root, 'LICENSE'))]);
const archive = createZip(entries);
const versioned = path.join(output, 'releases', config.version); fs.mkdirSync(versioned, { recursive: true });
fs.writeFileSync(path.join(versioned, 'source.zip'), archive);
const manifest = { ...config, source: { url: `${config.baseUrl}/releases/${config.version}/source.zip`, sha256: digest(archive) }, bootstrap: { url: `${config.baseUrl}/bootstrap.cjs`, sha256: bootstrapSha } };
const json = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(path.join(versioned, 'manifest.json'), json); fs.writeFileSync(path.join(output, 'manifest.json'), json);
for (const [template, destination] of [['bootstrap.sh', 'script'], ['bootstrap.ps1', 'script.ps1']]) {
  const source = fs.readFileSync(path.join(__dirname, template), 'utf8')
    .replaceAll('@@NODE_VERSION@@', config.nodeVersion).replaceAll('@@BOOTSTRAP_SHA@@', bootstrapSha)
    .replaceAll('@@WIN_NODE_SHA@@', config.node['win-x64'])
    .replaceAll('@@NODE_HASH_CASES@@', Object.entries(config.node).filter(([key]) => !key.startsWith('win')).map(([key, hash]) => `  ${key}) node_sha='${hash}' ;;`).join('\n'));
  fs.writeFileSync(path.join(root, 'public', destination), source);
}
console.log(`Desktop ${config.version}: verified source archive, manifest and bootstrap installers generated.`);
