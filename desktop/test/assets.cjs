'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateDesktopAssets } = require('../../scripts/desktop-assets.cjs');
let generated;
function sourceArchive() {
  let output = process.env.PENELOPA_TEST_ASSETS;
  if (!output) {
    // Direct node --test invocations also exercise current source.
    if (!generated) {
      generated = fs.mkdtempSync(path.join(os.tmpdir(), 'penelopa-test-assets-'));
      generateDesktopAssets(path.resolve(__dirname, '../..'), generated);
      process.on('exit', () => fs.rmSync(generated, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    }
    output = generated;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'desktop/manifest.json'), 'utf8'));
  return fs.readFileSync(path.join(output, 'desktop/releases', manifest.version, 'source.zip'));
}
module.exports = { sourceArchive };
