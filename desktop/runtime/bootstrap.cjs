'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getManifest, prepareSource } = require('./releases.cjs');
const config = require('../release-config.json');
(async () => {
  const manifest = await getManifest(config.version);
  const source = await prepareSource(manifest);
  const result = spawnSync(process.execPath, [path.join(source, 'runtime', 'install.cjs'), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  process.exitCode = result.status ?? 1;
})().catch(error => { process.stderr.write(`Penelopa: ${error.message}\n`); process.exitCode = 1; });
