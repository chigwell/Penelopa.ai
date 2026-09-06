'use strict';
const path = require('node:path');
const { verifyDesktopAssets } = require('./desktop-assets.cjs');
const manifest = verifyDesktopAssets(path.join(__dirname, '../public'));
console.log(`Desktop ${manifest.version}: published manifests, archives and installer hashes verified without regeneration.`);
