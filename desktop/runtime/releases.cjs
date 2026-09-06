'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { home, mkdir, protect, readJson, fingerprint, writeJson } = require('./files.cjs');
const { jsonRequest, download, allowedUrl } = require('./network.cjs');
const { extractZip } = require('./archive.cjs');
const current = require('../release-config.json');
function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !/^\d+\.\d+\.\d+$/.test(manifest.nodeVersion) || !/^[a-f0-9]{64}$/.test(manifest.source?.sha256)) throw new Error('This release manifest is not supported.');
  const url = allowedUrl(manifest.source.url);
  if (url.origin !== new URL(current.baseUrl).origin || !url.pathname.startsWith('/desktop/releases/')) throw new Error('The release source is not hosted by Penelopa.');
  return manifest;
}
function inventory(directory) {
  const entries = {};
  function visit(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) visit(file);
      else entries[path.relative(directory, file)] = fingerprint(fs.readFileSync(file));
    }
  }
  visit(directory); return entries;
}
function sourceIntact(directory, manifest) {
  try {
    const marker = readJson(path.join(directory, '.verified.json'), null);
    return marker?.sha256 === manifest.source.sha256 && marker.files && Object.keys(marker.files).length > 0 &&
      Object.entries(marker.files).every(([name, hash]) => {
        const file = path.resolve(directory, name);
        return file.startsWith(directory + path.sep) && fingerprint(fs.readFileSync(file)) === hash;
      });
  } catch { return false; }
}
async function getManifest(version = null) { return validateManifest(await jsonRequest(`${current.baseUrl}/${version ? `releases/${version}/` : ''}manifest.json`)); }
async function prepareSource(manifest, root = home()) {
  validateManifest(manifest); protect(root);
  const destination = path.join(root, 'releases', `${manifest.version}-${manifest.source.sha256.slice(0, 16)}`);
  if (sourceIntact(destination, manifest)) return destination;
  const stage = `${destination}.staging-${process.pid}`;
  const archive = path.join(root, 'cache', `source-${manifest.source.sha256}.zip`);
  await download(manifest.source.url, archive, manifest.source.sha256, 32 * 1024 * 1024);
  fs.rmSync(stage, { recursive: true, force: true }); mkdir(stage);
  try {
    extractZip(fs.readFileSync(archive), stage);
    if (readJson(path.join(stage, 'package.json')).version !== manifest.version) throw new Error('Source and manifest versions do not match.');
    writeJson(path.join(stage, '.verified.json'), { sha256: manifest.source.sha256, files: inventory(stage) });
    const previous = `${destination}.incomplete-${process.pid}`;
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    try { fs.renameSync(stage, destination); }
    catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, destination); throw error; }
    fs.rmSync(previous, { recursive: true, force: true }); return destination;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
async function ensureRuntime(manifest, root = home()) {
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const key = `${platform}-${process.arch}`;
  const digest = manifest.node?.[key];
  if (!/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('No verified Node runtime is available for this platform.');
  const folder = `node-v${manifest.nodeVersion}-${key}`;
  const destination = path.join(root, 'runtime', folder);
  const node = path.join(destination, process.platform === 'win32' ? 'node.exe' : 'bin/node');
  try { if (fs.existsSync(node) && execFileSync(node, ['--version'], { encoding: 'utf8', windowsHide: true }).trim() === `v${manifest.nodeVersion}`) return node; } catch {}
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const archive = path.join(root, 'cache', `${folder}.${extension}`);
  await download(`https://nodejs.org/dist/v${manifest.nodeVersion}/${folder}.${extension}`, archive, digest);
  const stage = path.join(root, 'runtime', `.staging-${process.pid}`); mkdir(stage);
  try {
    if (process.platform === 'win32') {
      const quote = value => `'${value.replace(/'/g, "''")}'`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(stage)} -Force`], { windowsHide: true });
    } else execFileSync('tar', ['-xzf', archive, '-C', stage]);
    const stagedNode = path.join(stage, folder, process.platform === 'win32' ? 'node.exe' : 'bin/node');
    if (execFileSync(stagedNode, ['--version'], { encoding: 'utf8', windowsHide: true }).trim() !== `v${manifest.nodeVersion}`) throw new Error('The downloaded runtime cannot run on this operating system.');
    const previous = `${destination}.incomplete-${process.pid}`;
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    try { fs.renameSync(path.join(stage, folder), destination); }
    catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, destination); throw error; }
    fs.rmSync(previous, { recursive: true, force: true });
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  return node;
}
module.exports = { validateManifest, getManifest, prepareSource, ensureRuntime, sourceIntact, inventory };
