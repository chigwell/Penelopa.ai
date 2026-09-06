'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateDesktopAssets, verifyDesktopAssets } = require('../../scripts/desktop-assets.cjs');
const { extractZip } = require('../runtime/archive.cjs');
const sourceRoot = path.resolve(__dirname, '../..');

const { temporary } = require('./fixtures.cjs');

function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const name = path.join(prefix, item.name);
    return item.isDirectory() ? files(path.join(directory, item.name), name) : [name];
  }).sort();
}
function snapshot(directory) {
  return files(directory).map(name => [name, fs.readFileSync(path.join(directory, name))]);
}

test('desktop generation is deterministic, includes current maintained source and leaves published files unchanged', t => {
  const directory = temporary(t, 'penelopa-artifacts-'), first = path.join(directory, 'first'), second = path.join(directory, 'second');
  const published = snapshot(path.join(sourceRoot, 'public/desktop'));
  const installers = ['script', 'script.ps1'].map(name => fs.readFileSync(path.join(sourceRoot, 'public', name)));
  const manifest = generateDesktopAssets(sourceRoot, first);
  generateDesktopAssets(sourceRoot, second);
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.deepEqual(verifyDesktopAssets(first), manifest);
  const release = path.join(directory, 'release');
  extractZip(fs.readFileSync(path.join(first, 'desktop/releases', manifest.version, 'source.zip')), release);
  const maintained = files(path.join(sourceRoot, 'desktop')).filter(name =>
    !name.split(path.sep).some(part => part.startsWith('.') || ['node_modules', 'test'].includes(part)));
  for (const name of maintained) assert.deepEqual(fs.readFileSync(path.join(release, name)), fs.readFileSync(path.join(sourceRoot, 'desktop', name)), name);
  for (const name of ['auto-improve-upload.sh', 'auto-improve-upload.ps1']) {
    assert.deepEqual(fs.readFileSync(path.join(release, 'hooks', name)), fs.readFileSync(path.join(sourceRoot, 'public', name)));
  }
  assert.equal(fs.existsSync(path.join(release, 'test')), false);
  assert.equal(fs.existsSync(path.join(release, 'node_modules')), false);
  assert.deepEqual(snapshot(path.join(sourceRoot, 'public/desktop')), published);
  assert.deepEqual(['script', 'script.ps1'].map(name => fs.readFileSync(path.join(sourceRoot, 'public', name))), installers);
});

test('release generation permits identical bytes and refuses changed version content before writing entrypoints', t => {
  const directory = temporary(t, 'penelopa-artifacts-'), output = path.join(directory, 'assets');
  const manifest = generateDesktopAssets(sourceRoot, output);
  assert.doesNotThrow(() => generateDesktopAssets(sourceRoot, output));
  for (const name of ['source.zip', 'manifest.json']) {
    const file = path.join(output, 'desktop/releases', manifest.version, name);
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, 'previously published bytes');
    const before = snapshot(output);
    assert.throws(() => generateDesktopAssets(sourceRoot, output), /already exists with different content/);
    assert.deepEqual(snapshot(output), before);
    fs.writeFileSync(file, original);
  }
});

test('published integrity verification is read-only and detects corrupted assets', t => {
  const directory = temporary(t, 'penelopa-artifacts-');
  const manifest = generateDesktopAssets(sourceRoot, directory);
  const before = snapshot(directory);
  verifyDesktopAssets(directory);
  assert.deepEqual(snapshot(directory), before);
  const archive = path.join(directory, 'desktop/releases', manifest.version, 'source.zip');
  fs.appendFileSync(archive, 'corruption');
  assert.throws(() => verifyDesktopAssets(directory), /source checksum mismatch/);
});
