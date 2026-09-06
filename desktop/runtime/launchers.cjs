'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { shellQuote } = require('./hooks-config.cjs');

function hookCommand(root, source, platform = process.platform, nodePath = process.execPath) {
  if (platform === 'win32') {
    // Capture reads UTF-8 stdin directly in Node. A PowerShell native pipeline
    // can pass extra inheritable pipe handles on to the detached worker,
    // keeping the agent's stdout/stderr open after the hook has already exited.
    return `"${nodePath}" "${path.join(root, 'bin', 'hook.cjs')}" ${source}`;
  }
  return `${shellQuote('/bin/sh')} ${shellQuote(path.join(root, 'bin', 'capture.sh'))} ${source}`;
}
function refreshAgents(root, state) {
  return state.agents.map(agent => {
    const command = hookCommand(root, agent.source, state.platform, state.nodePath);
    return { ...agent, command, ownedCommands: [...new Set([command, agent.command, ...(agent.ownedCommands || [])])] };
  });
}
function launcherChanges(root, nodePath = process.execPath) {
  const changes = [];
  const atomicWrite = (file, bytes, mode) => changes.push({ file, bytes, mode });
  const loader = target => `'use strict';\nconst fs=require('node:fs'),path=require('node:path');\nconst root=path.dirname(__dirname);process.env.AUTO_IMPROVE_HOME=root;\nconst state=JSON.parse(fs.readFileSync(path.join(root,'install.json'),'utf8'));\nrequire(path.join(state.releaseDir,'runtime','${target}')).main?.();\n`;
  atomicWrite(path.join(root, 'bin', 'penelopa.cjs'), loader('install.cjs'));
  atomicWrite(path.join(root, 'bin', 'hook.cjs'), `'use strict';\nconst fs=require('node:fs'),path=require('node:path');\nconst root=path.dirname(__dirname);process.env.AUTO_IMPROVE_HOME=root;\ntry { const state=JSON.parse(fs.readFileSync(path.join(root,'install.json'),'utf8')); const hook=require(path.join(state.releaseDir,'runtime','hook.cjs')); const input=fs.readFileSync(0,'utf8'); if(Buffer.byteLength(input)>1048576)throw Error('Input too large'); const event=hook.capture(process.argv[2],JSON.parse(input),root,process.env.PENELOPA_SELF_TEST==='1'); if(event&&process.env.PENELOPA_SELF_TEST!=='1')hook.wake(root); } catch { try {fs.mkdirSync(path.join(root,'health'),{recursive:true,mode:448});fs.writeFileSync(path.join(root,'health','capture-error.json'),JSON.stringify({at:new Date().toISOString(),error:'An event could not be saved. Check transcript access and disk space.'}),{mode:384});}catch{} process.stderr.write('Penelopa: open Connection to check event capture.\\n'); } finally { if(process.argv[2]==='codex-openai')process.stdout.write('{}\\n'); }\n`);
  atomicWrite(path.join(root, 'bin', 'capture.sh'), `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd) || exit 0
node_path=$(cat "$root/node-path") || exit 0
exec "$node_path" "$root/bin/hook.cjs" "$1"
`, 0o700);
  atomicWrite(path.join(root, 'bin', 'capture.ps1'), '\uFEFF' + fs.readFileSync(path.join(__dirname, 'capture.ps1'), 'utf8'));
  atomicWrite(path.join(root, 'node-path'), nodePath + '\n');
  return changes;
}
module.exports = { hookCommand, refreshAgents, launcherChanges };
