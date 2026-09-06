'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { atomicWrite, writeJson, readJson } = require('../runtime/files.cjs');

const powershell = process.platform === 'win32'
  ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  : spawnSync('which', ['pwsh'], { encoding: 'utf8' }).stdout?.trim();
const platforms = [
  { name: 'POSIX', enabled: process.platform !== 'win32', command: '/bin/sh', args: [path.resolve(__dirname, '../../public/auto-improve-upload.sh')] },
  { name: 'PowerShell', enabled: Boolean(powershell), command: powershell, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../../public/auto-improve-upload.ps1')] },
];

function fixture(t, platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penelopa uploader ' ü 日本語-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const transcript = path.join(root, 'session ü.jsonl');
  const configFile = path.join(root, platform.name === 'PowerShell' ? 'credential.json' : 'credential.env');
  if (platform.name === 'PowerShell') writeJson(configFile, { token: '', dataDir: root, uploadMode: 'segments' });
  else atomicWrite(configFile, `AUTO_IMPROVE_TOKEN=\nAUTO_IMPROVE_DATA_DIR=${root}\n`);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AUTO_IMPROVE_'))),
    AUTO_IMPROVE_HOME: root, AUTO_IMPROVE_NODE: process.execPath, AUTO_IMPROVE_DATA_DIR: root,
    AUTO_IMPROVE_HOOK_CONFIG: configFile, AUTO_IMPROVE_SPOOL_ONLY: '1',
    AUTO_IMPROVE_TIMEOUT_SECONDS: '3', AUTO_IMPROVE_DRAIN_MAX_SECONDS: '3',
    AUTO_IMPROVE_RECEIPT_FILE: path.join(root, 'receipt.json'),
  };
  async function run(event = 'Stop', overrides = {}) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(platform.command, [...platform.args, 'codex-openai'], { env: { ...env, ...overrides }, windowsHide: true, timeout: 45_000 });
      let output = '', error = '';
      child.stdout.on('data', bytes => { output += bytes; });
      child.stderr.on('data', bytes => { error += bytes; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, output, error }));
      child.stdin.end(JSON.stringify({ hook_event_name: event, transcript_path: transcript, session_id: 'shared ü session', cwd: root }));
    });
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal(result.output.trim(), '{}', result.error);
    return result;
  }
  function items(subdirectory = 'outbox', prefix = 'pending-') {
    const directory = path.join(root, subdirectory);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(name => name.startsWith(prefix)).map(name => {
      const item = path.join(directory, name);
      const get = field => fs.readFileSync(path.join(item, field), 'utf8').trim();
      const request = platform.name === 'PowerShell' ? readJson(path.join(item, 'request.json')) : {
        epoch: get('epoch'), byteStart: Number(get('byte_start')), byteEnd: Number(get('byte_end')),
        isFinal: get('is_final') === 'true', stateKey: get('state_key'),
      };
      return { item, request, bytes: fs.readFileSync(path.join(item, 'segment.jsonl'), 'utf8') };
    }).sort((a, b) => Number(a.request.epoch) - Number(b.request.epoch) || a.request.byteStart - b.request.byteStart || a.request.byteEnd - b.request.byteEnd);
  }
  return { root, transcript, run, items, platform };
}

for (const platform of platforms) {
  test(`${platform.name} retains partial JSONL, handles EOF finalization, and preserves queued bytes across transcript replacement and truncation`, { skip: !platform.enabled, timeout: 120_000 }, async t => {
    const f = fixture(t, platform), first = '{"message":"first ü"}\n', partial = '{"message":"second';
    atomicWrite(f.transcript, first + partial);
    await f.run();
    assert.deepEqual(f.items().map(item => item.bytes), [first]);
    const originalEpoch = String(f.items()[0].request.epoch);
    fs.appendFileSync(f.transcript, '"}');
    await f.run('SessionEnd');
    assert.deepEqual(f.items().map(item => item.bytes), [first, partial + '"}']);
    assert.equal(f.items().at(-1).request.isFinal, true);
    const spooled = f.items().map(item => item.bytes);
    await f.run('SessionEnd');
    assert.deepEqual(f.items().map(item => item.bytes), spooled, 'Repeated finalization must not duplicate queued data.');
    const replacement = '{"message":"replacement"}\n';
    atomicWrite(f.transcript, replacement);
    await f.run();
    assert.deepEqual(f.items().slice(0, 2).map(item => item.bytes), spooled);
    assert.notEqual(String(f.items().at(-1).request.epoch), originalEpoch);
    assert.equal(f.items().at(-1).bytes, replacement);
    const replacedEpoch = String(f.items().at(-1).request.epoch);
    fs.writeFileSync(f.transcript, '{}\n');
    await f.run();
    assert.notEqual(String(f.items().at(-1).request.epoch), replacedEpoch);
    assert.equal(f.items().at(-1).bytes, '{}\n');
    assert.equal(f.items().length, 4, 'New epochs must retain previously queued bytes.');
  });

  test(`${platform.name} drains captured bytes and quarantines a conclusive rejection without advancing acknowledgement`, { skip: !platform.enabled, timeout: 90_000 }, async t => {
    const f = fixture(t, platform), captured = '{"message":"captured ü"}\n', received = [];
    const server = http.createServer(async (request, response) => {
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers['content-type'] } }).formData();
        received.push({ end: Number(form.get('byte_end')), bytes: await form.get('segment').text() });
        response.writeHead(422, { 'content-type': 'application/json' }); response.end('{"error":"synthetic rejection"}');
      } catch (error) { response.writeHead(500); response.end('{}'); t.diagnostic(error.message); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const endpoint = `http://127.0.0.1:${server.address().port}/v2/transcript-segments`;
    atomicWrite(f.transcript, captured + '{"message":"outside captured boundary"}\n');
    await f.run('Stop', { AUTO_IMPROVE_SNAPSHOT_SIZE: String(Buffer.byteLength(captured)), AUTO_IMPROVE_URL: endpoint });
    assert.deepEqual(f.items().map(item => item.bytes), [captured]);
    const queued = f.items()[0];
    await f.run('Drain', { AUTO_IMPROVE_TOKEN: 'synthetic-contract-token' });
    assert.deepEqual(received, [{ end: Buffer.byteLength(captured), bytes: captured }]);
    assert.equal(f.items().length, 0);
    assert.deepEqual(f.items('outbox/quarantine', 'quarantined-').map(item => item.bytes), [captured]);
    const statePath = path.join(f.root, 'state', queued.request.stateKey + (platform.name === 'PowerShell' ? '.json' : '.state'));
    const state = platform.name === 'PowerShell' ? readJson(statePath) : Object.fromEntries(fs.readFileSync(statePath, 'utf8').trim().split('\n').map(line => line.split('=')));
    assert.equal(Number(state.ackOffset ?? state.ack_offset), 0);
  });
}
