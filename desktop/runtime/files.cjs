'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function home() { return path.resolve(process.env.AUTO_IMPROVE_HOME || path.join(os.homedir(), '.auto-improve')); }
function mkdir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function syncDir(dir) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomicWrite(file, value, mode = 0o600) {
  mkdir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', mode);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); syncDir(path.dirname(file)); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  if (process.platform !== 'win32') fs.chmodSync(file, mode);
}
function writeJson(file, value) { atomicWrite(file, JSON.stringify(value, null, 2) + '\n'); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Cannot read valid JSON: ${path.basename(file)}`); }
}
function currentWindowsSid() {
  const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-5-[0-9-]+/);
  if (!sid) throw new Error('Cannot determine the current Windows user.');
  return sid[0];
}
function protect(dir) {
  mkdir(dir);
  if (process.platform === 'win32') {
    const sid = currentWindowsSid();
    execFileSync('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'ignore', windowsHide: true });
  } else fs.chmodSync(dir, 0o700);
}
function protectFile(file) {
  if (process.platform !== 'win32') return fs.chmodSync(file, 0o600);
  const sid = currentWindowsSid();
  execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F'], { stdio: 'ignore', windowsHide: true });
}
function lock(file) {
  mkdir(path.dirname(file));
  try { fs.mkdirSync(file, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = readJson(path.join(file, 'owner.json'), null);
    if (owner) { try { process.kill(owner.pid, 0); return null; } catch (e) { if (e.code !== 'ESRCH') return null; } }
    else if (Date.now() - fs.statSync(file).mtimeMs < 30_000) return null;
    fs.rmSync(file, { recursive: true, force: true });
    return lock(file);
  }
  writeJson(path.join(file, 'owner.json'), { pid: process.pid });
  return () => fs.rmSync(file, { recursive: true, force: true });
}
function settings(root = home()) {
  const prefs = { paused: false, notifications: false, autostart: false, ...readJson(path.join(root, 'preferences.json'), {}) };
  if (fs.existsSync(path.join(root, 'collection-disabled'))) prefs.paused = true;
  return prefs;
}
function installState(root = home()) { return readJson(path.join(root, 'install.json'), null); }
function credential(state) {
  if (!state) return '';
  if (state.platform === 'win32') return readJson(state.configFile, {}).token || '';
  const values = envFile(state.configFile);
  return values.AUTO_IMPROVE_TOKEN || '';
}
function envFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
    if (!match) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}
function fingerprint(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
module.exports = { home, mkdir, atomicWrite, writeJson, readJson, protect, protectFile, syncDir, lock, settings, installState, credential, envFile, fingerprint };
