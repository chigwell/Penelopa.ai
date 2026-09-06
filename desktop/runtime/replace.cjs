'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mkdir } = require('./files.cjs');

function rollback(target, previous) {
  fs.rmSync(target, { recursive: true, force: true });
  if (fs.existsSync(previous)) fs.renameSync(previous, target);
}
async function replace(bundle, target, verify, beforeReplace = async () => {}) {
  mkdir(path.dirname(target));
  const staged = `${target}.staged`, previous = `${target}.previous`;
  fs.rmSync(staged, { recursive: true, force: true });
  try {
    fs.cpSync(bundle, staged, { recursive: true, dereference: false, verbatimSymlinks: true });
    await beforeReplace();
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(target)) fs.renameSync(target, previous);
    try { fs.renameSync(staged, target); await verify(target); }
    catch (error) { rollback(target, previous); throw error; }
    return previous;
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
}
module.exports = { replace, rollback };
