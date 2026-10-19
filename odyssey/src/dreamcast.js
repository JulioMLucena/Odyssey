// Identifies Dreamcast discs (.gdi, .cdi, .chd) and reads their IP.BIN header: product number,
// title and region letters. IP.BIN starts with "SEGA SEGAKATANA" at the start of the game's data track.
'use strict';

const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('SEGA SEGAKATANA', 'latin1');

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  return buf.subarray(0, n);
}

// IP.BIN layout: 0x30 area symbols (J/U/E), 0x40 product number, 0x4A version, 0x80 software name.
function parseIpBin(buf, at) {
  const field = (o, n) => buf.toString('latin1', at + o, at + o + n).replace(/\0/g, ' ').trim();
  const area = field(0x30, 8);
  const regions = [];
  if (area.includes('J')) regions.push('Japão');
  if (area.includes('U')) regions.push('América do Norte');
  if (area.includes('E')) regions.push('Europa');
  const product = field(0x40, 10).replace(/\s+/g, ' ');
  const title = field(0x80, 128).replace(/\s{2,}/g, ' ');
  return {
    ok: true,
    platform: 'dreamcast',
    serial: product || null,
    version: field(0x4a, 6).replace(/^V/i, '') || null,
    internalTitle: title || null,
    region: regions.join(' · ') || null,
  };
}

// Looks for the IP.BIN magic inside [start, start+length) of a file, reading in chunks.
function scanFor(fd, start, length) {
  const CHUNK = 4 * 1024 * 1024;
  for (let pos = Math.max(0, start); pos < start + length; pos += CHUNK - 512) {
    const buf = readAt(fd, pos, CHUNK);
    if (!buf.length) break;
    const i = buf.indexOf(MAGIC);
    if (i >= 0) {
      const full = readAt(fd, pos + i, 0x100);
      if (full.length >= 0x100) return parseIpBin(full, 0);
    }
    if (buf.length < CHUNK) break;
  }
  return null;
}

// .gdi is a text index: "<track> <lba> <type> <sector size> <file> <offset>". The game's IP.BIN is at
// the start of the first data track in the high-density area (LBA 45000, usually track 3).
function inspectGdi(file) {
  const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/).slice(1);
  const tracks = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+("[^"]+"|\S+)\s+(-?\d+)/);
    if (m) tracks.push({ no: +m[1], lba: +m[2], type: +m[3], sector: +m[4], file: m[5].replace(/"/g, '') });
  }
  const data = tracks.find((t) => t.lba >= 45000 && t.type === 4) || tracks.find((t) => t.type === 4);
  if (!data) return { ok: false, platform: 'unknown', reason: 'GDI sem trilha de dados.' };
  const trackPath = path.join(path.dirname(file), data.file);
  const fd = fs.openSync(trackPath, 'r');
  try {
    return scanFor(fd, 0, 64 * 1024) || { ok: false, platform: 'unknown', reason: 'Não achei o cabeçalho do Dreamcast nessa trilha.' };
  } finally {
    fs.closeSync(fd);
  }
}

// .cdi (DiscJuggler) has no simple index for us, so search the start and the end of the file,
// where the data session normally lives.
function inspectCdi(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const hit = scanFor(fd, 0, 16 * 1024 * 1024) || scanFor(fd, Math.max(0, size - 160 * 1024 * 1024), 160 * 1024 * 1024);
    return hit || { ok: true, platform: 'dreamcast', serial: null, reason: null };
  } finally {
    fs.closeSync(fd);
  }
}

// .chd: read the metadata chain from the v5 header. GD-ROM images carry "CHGD" metadata,
// DVD images (PS2) carry "DVD ", and CD images carry "CHT2"/"CHTR".
function chdKind(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, 0, 124);
    if (head.toString('latin1', 0, 8) !== 'MComprHD') return null;
    const version = head.readUInt32BE(12);
    let meta = version >= 5 ? Number(head.readBigUInt64BE(48)) : Number(head.readBigUInt64BE(36));
    const tags = new Set();
    for (let i = 0; meta && i < 64; i++) {
      const m = readAt(fd, meta, 16);
      if (m.length < 16) break;
      tags.add(m.toString('latin1', 0, 4));
      meta = Number(m.readBigUInt64BE(8));
    }
    if (tags.has('CHGD')) return 'dreamcast';
    if (tags.has('DVD ')) return 'ps2';
    if (tags.has('CHT2') || tags.has('CHTR') || tags.has('CHCD')) return 'cd';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function inspectDreamcast(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.gdi') return inspectGdi(file);
  if (ext === '.cdi') return inspectCdi(file);
  return null;
}

module.exports = { inspectDreamcast, inspectGdi, inspectCdi, chdKind, parseIpBin, MAGIC };
