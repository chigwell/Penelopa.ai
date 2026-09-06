'use strict';
const path = require('node:path');
const { generateDesktopAssets } = require('./desktop-assets.cjs');
const root = path.resolve(__dirname, '..');
const manifest = generateDesktopAssets(root, path.join(root, 'public'));
console.log(`Desktop ${manifest.version}: verified source archive, manifest and bootstrap installers generated.`);
