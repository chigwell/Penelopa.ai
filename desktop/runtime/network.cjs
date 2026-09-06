'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { mkdir } = require('./files.cjs');

function allowedUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.PENELOPA_TESTING === '1' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('A secure HTTPS URL is required.');
  return url;
}
async function download(url, destination, expectedHash, maxBytes = 512 * 1024 * 1024) {
  allowedUrl(url);
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('The release is missing a SHA-256 checksum.');
  mkdir(path.dirname(destination));
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = `${destination}.${process.pid}.download`;
    try {
      let target = url;
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await fetch(allowedUrl(target), { signal: AbortSignal.timeout(300_000), redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 5) throw new Error('Too many download redirects.');
        target = allowedUrl(new URL(location, target).href).href;
      }
      if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}.`);
      const hash = crypto.createHash('sha256');
      const fd = fs.openSync(temporary, 'w', 0o600);
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > maxBytes) throw new Error('Download exceeds the allowed size.');
          hash.update(chunk); fs.writeSync(fd, chunk);
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      if (hash.digest('hex') !== expectedHash) throw new Error('Download checksum mismatch.');
      fs.renameSync(temporary, destination);
      return destination;
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      if (/checksum|size/.test(error.message) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
async function jsonRequest(url, init = {}) {
  allowedUrl(url);
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const error = new Error(response.status === 429 ? `Rate limit reached. Try again after ${response.headers.get('retry-after') || 'a few'} seconds.` : `Request returned HTTP ${response.status}.`);
    error.status = response.status; throw error;
  }
  return response.status === 204 ? null : response.json();
}
module.exports = { allowedUrl, download, jsonRequest };
