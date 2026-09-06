'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = ['app/lib', 'tests/unit'].flatMap(directory =>
  fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.cjs')).sort()
    .map(name => path.join(root, directory, name)),
);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
