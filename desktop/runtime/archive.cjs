'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mkdir, atomicWrite } = require('./files.cjs');
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Deterministic ZIP/STORE archives: no archive utility or npm package is needed
// to extract our small source bundle on a clean machine.
function createZip(entries) {
  const records = []; const central = []; let offset = 0;
  for (const [name, bytes] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const filename = Buffer.from(name); const data = Buffer.from(bytes); const checksum = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    records.push(header, filename, data); central.push(directory, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, directory, end]);
}
function extractZip(buffer, destination) {
  let offset = 0; let total = 0; const seen = new Set();
  mkdir(destination);
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > buffer.length) throw new Error('Truncated source archive.');
    const flags = buffer.readUInt16LE(offset + 6); const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18); const length = buffer.readUInt16LE(offset + 26); const extra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + length + extra; const name = buffer.subarray(offset + 30, offset + 30 + length).toString('utf8');
    if (method !== 0 || flags !== 0x800 || buffer.readUInt32LE(offset + 22) !== size || start + size > buffer.length) throw new Error('Unsupported source archive format.');
    if (!name || name.startsWith('/') || /[\\:\0]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name.toLowerCase())) throw new Error('Unsafe source archive entry.');
    total += size; if (total > 32 * 1024 * 1024 || seen.size > 2000) throw new Error('Source archive exceeds the allowed size.');
    const data = buffer.subarray(start, start + size);
    if (crc32(data) !== buffer.readUInt32LE(offset + 14)) throw new Error('Corrupt source archive.');
    atomicWrite(path.join(destination, ...name.split('/')), data); seen.add(name.toLowerCase()); offset = start + size;
  }
  if (!seen.has('package.json') || offset + 4 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Incomplete source archive.');
}
module.exports = { createZip, extractZip, crc32 };
