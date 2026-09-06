'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson, home } = require('./files.cjs');
function alive(pid) { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
async function waitForMarker(file, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const owner = readJson(file, null);
    if (!owner || !alive(owner.pid)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Penelopa is still closing. Wait for background work to stop, then retry.');
}
async function requestDesktopExit(root = home()) {
  const marker = path.join(root, 'desktop-running.json');
  const pid = readJson(marker, null)?.pid;
  if (!alive(pid)) return;
  writeJson(path.join(root, 'quit-request.json'), { requestedAt: new Date().toISOString() });
  // before-quit removes the marker before Windows releases executable handles.
  // Wait for the process itself; do not replace its files during that interval.
  await waitForExit(pid);
}
async function waitForExit(pid, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (alive(pid)) {
    if (Date.now() >= deadline) throw new Error('Penelopa is still closing. Wait for it to exit, then retry.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
module.exports = { requestDesktopExit, waitForMarker, waitForExit, alive };
