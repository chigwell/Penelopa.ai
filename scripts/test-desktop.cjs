'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generateDesktopAssets } = require('./desktop-assets.cjs');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'penelopa-test-assets-'));
try {
  generateDesktopAssets(root, output);
  const files = fs.readdirSync(path.join(root, 'desktop/test')).filter(name => name.endsWith('.test.cjs')).sort()
    .map(name => path.join(root, 'desktop/test', name));
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...process.argv.slice(2), ...files], {
    env: { ...process.env, PENELOPA_TEST_ASSETS: output }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(output, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
