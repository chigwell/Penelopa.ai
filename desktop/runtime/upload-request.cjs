'use strict';
// curl-compatible result files for the existing POSIX outbox, with credentials
// read in-process rather than exposed as command-line arguments.
const fs = require('node:fs');
const path = require('node:path');
const { envFile, writeJson } = require('./files.cjs');
const { allowedUrl } = require('./network.cjs');
async function main() {
  const [item, responseFile, headerFile, seconds, configFile] = process.argv.slice(2);
  const read = key => fs.readFileSync(path.join(item, key), 'utf8').replace(/\n$/, '');
  const token = envFile(configFile).AUTO_IMPROVE_TOKEN;
  const body = new FormData();
  for (const key of ['source', 'project_id', 'external_session_id', 'epoch', 'segment_seq', 'byte_start', 'byte_end', 'segment_sha256', 'source_schema_version', 'is_final', 'metadata']) body.set(key, read(key));
  body.set('segment', await fs.openAsBlob(path.join(item, 'segment.jsonl'), { type: 'application/x-ndjson' }), 'segment.jsonl');
  const response = await fetch(allowedUrl(read('url')), { method: 'POST', redirect: 'error', body,
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': read('idempotency_key') }, signal: AbortSignal.timeout(Number(seconds) * 1000) });
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); throw new Error('Response too large.'); } chunks.push(Buffer.from(value)); }
  fs.writeFileSync(responseFile, Buffer.concat(chunks), { mode: 0o600 });
  fs.writeFileSync(headerFile, `HTTP/1.1 ${response.status}\r\n` + [...response.headers].map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n', { mode: 0o600 });
  if (!response.ok && process.env.AUTO_IMPROVE_HEALTH_DIR) writeJson(path.join(process.env.AUTO_IMPROVE_HEALTH_DIR, 'delivery-error.json'), { at: new Date().toISOString(), error: [401, 403].includes(response.status) ? 'The server rejected the installed account token. Reconnect or repair your account; queued data is retained.' : `Delivery returned HTTP ${response.status}. Queued data is retained for retry or review.` });
  process.stdout.write(String(response.status));
}
if (require.main === module) main().catch(() => {
  if (process.env.AUTO_IMPROVE_HEALTH_DIR) writeJson(path.join(process.env.AUTO_IMPROVE_HEALTH_DIR, 'delivery-error.json'), { at: new Date().toISOString(), error: 'The upload could not reach the server. Check your connection; queued data is retained.' });
  process.stdout.write('000'); process.exitCode = 1;
});
