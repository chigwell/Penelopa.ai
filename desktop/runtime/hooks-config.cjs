'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson, atomicWrite, protectFile } = require('./files.cjs');

function object(value, label) { if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} must be a JSON object. The original file was not changed.`); }
function owned(command, commands) { return typeof command === 'string' && commands.includes(command); }
function editHooks(config, command, knownCommands, claude, remove = false) {
  object(config, 'Agent settings');
  if (config.hooks === undefined) { if (remove) return config; config.hooks = {}; }
  object(config.hooks, 'hooks');
  for (const event of ['Stop', 'SessionEnd']) {
    const entries = config.hooks[event] || [];
    if (!Array.isArray(entries)) throw new Error(`hooks.${event} must be an array. The original file was not changed.`);
    const next = [];
    for (const entry of entries) {
      object(entry, `hooks.${event} entry`);
      if (!Array.isArray(entry.hooks)) throw new Error(`hooks.${event} entry must contain hooks.`);
      const keep = entry.hooks.filter(hook => !owned(hook?.command, knownCommands));
      if (keep.length || entry.hooks.length === 0) next.push({ ...entry, hooks: keep });
    }
    if (!remove) {
      const entry = { hooks: [{ type: 'command', command, timeout: !claude && event === 'SessionEnd' ? 3 : 60 }] };
      if (claude) entry.matcher = '';
      next.push(entry);
    }
    if (next.length) config.hooks[event] = next;
    else delete config.hooks[event];
  }
  return config;
}
function transaction(changes, verify = () => {}) {
  const originals = changes.map(({ file, sensitive }) => ({ file, sensitive, bytes: fs.existsSync(file) ? fs.readFileSync(file) : null }));
  const stamp = `${Date.now()}-${process.pid}`;
  try {
    for (const { file, bytes, sensitive } of originals) if (bytes !== null) {
      atomicWrite(`${file}.bak.${stamp}`, bytes);
      if (sensitive) protectFile(`${file}.bak.${stamp}`);
    }
    for (const { file, data, bytes, mode, sensitive } of changes) {
      if (bytes !== undefined) atomicWrite(file, bytes, mode);
      else writeJson(file, data);
      if (sensitive) protectFile(file);
    }
    verify();
  } catch (error) {
    for (const { file, bytes, sensitive } of originals) {
      if (bytes === null) fs.rmSync(file, { force: true }); else atomicWrite(file, bytes);
      if (bytes !== null && sensitive) protectFile(file);
    }
    throw error;
  }
}
function prepare(agents, remove = false) {
  return agents.filter(agent => !remove || fs.existsSync(agent.configPath)).map(agent => ({ file: agent.configPath, data: editHooks(readJson(agent.configPath, {}), agent.command, agent.ownedCommands, agent.name === 'Claude Code', remove) }));
}
function shellQuote(value) { return `'${value.replace(/'/g, "'\\''")}'`; }
module.exports = { editHooks, transaction, prepare, shellQuote };
