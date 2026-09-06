'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { atomicWrite } = require('./files.cjs');
const LABEL = 'ai.penelopa.desktop';
const xml = value => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
function setAutostart(enabled, state) {
  if (process.platform === 'darwin') {
    const file = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    if (!enabled) { fs.rmSync(file, { force: true }); return { enabled: false }; }
    if (!state.desktop?.executable) throw new Error('Install the desktop application first.');
    atomicWrite(file, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>${xml(state.desktop.executable)}</string><string>--background</string></array><key>EnvironmentVariables</key><dict><key>AUTO_IMPROVE_HOME</key><string>${xml(path.dirname(state.configMarker || path.join(require('./files.cjs').home(), 'install.json')))}</string></dict><key>RunAtLoad</key><true/></dict></plist>`, 0o600);
    execFileSync('/usr/bin/plutil', ['-lint', file], { stdio: 'ignore' });
    return { enabled: fs.existsSync(file) };
  }
  if (process.platform === 'win32') {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    if (!enabled) {
      try { execFileSync('reg.exe', ['delete', key, '/v', LABEL, '/f'], { stdio: 'ignore', windowsHide: true }); } catch {}
      return { enabled: false };
    }
    if (!state.desktop?.executable) throw new Error('Install the desktop application first.');
    execFileSync('reg.exe', ['add', key, '/v', LABEL, '/t', 'REG_SZ', '/d', `"${state.desktop.executable}" --background`, '/f'], { stdio: 'ignore', windowsHide: true });
    const output = execFileSync('reg.exe', ['query', key, '/v', LABEL], { encoding: 'utf8', windowsHide: true });
    if (!output.includes(state.desktop.executable)) throw new Error('Windows did not register the startup item.');
    return { enabled: true };
  }
  return { enabled: false };
}
module.exports = { setAutostart, LABEL };
