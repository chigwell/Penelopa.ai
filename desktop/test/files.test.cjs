'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function windowsFiles(identity) {
  const commands = [], directories = [];
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../runtime/files.cjs');
  const requireSource = createRequire(filename);
  const requireMock = name => {
    if (name === 'node:fs') return { mkdirSync: (...args) => directories.push(args) };
    if (name === 'node:child_process') return { execFileSync: (...args) => { commands.push(args); return identity; } };
    return requireSource(name);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: requireMock, process: { platform: 'win32' }, module });
  return { ...module.exports, commands, directories };
}

test('Windows directory and credential ACLs resolve the current SID and retain their distinct inheritance grants', () => {
  const files = windowsFiles('"machine\\user","S-1-5-21-123-456-789-1001"\r\n');
  files.protect('C:\\fixture directory');
  files.protectFile('C:\\fixture directory\\credential.json');
  assert.equal(files.commands.length, 4);
  for (const index of [0, 2]) {
    assert.equal(files.commands[index][0], 'whoami.exe');
    assert.deepEqual(Array.from(files.commands[index][1]), ['/user', '/fo', 'csv', '/nh']);
    assert.equal(files.commands[index][2].windowsHide, true);
  }
  assert.deepEqual(Array.from(files.commands[1][1]), ['C:\\fixture directory', '/inheritance:r', '/grant:r', '*S-1-5-21-123-456-789-1001:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F']);
  assert.deepEqual(Array.from(files.commands[3][1]), ['C:\\fixture directory\\credential.json', '/inheritance:r', '/grant:r', '*S-1-5-21-123-456-789-1001:F', '*S-1-5-18:F']);
  assert.equal(files.directories.length, 1);
});

test('Windows ACL protection fails before icacls when identity lookup contains no SID', () => {
  for (const operation of ['protect', 'protectFile']) {
    const files = windowsFiles('unrecognized identity');
    assert.throws(() => files[operation]('fixture'), /Cannot determine the current Windows user\./);
    assert.equal(files.commands.length, 1);
  }
});
