// Recognises dumped PS4 games: a folder (usually CUSAxxxxx) with eboot.bin and sce_sys/param.sfo.
// param.sfo holds the title, the title ID and the version; sce_sys/icon0.png is the game's own icon.
'use strict';

const fs = require('fs');
const path = require('path');

// PSF layout: "\0PSF", version, key table offset, data table offset, entry count, then 16-byte entries:
// key offset (u16), format (u16: 0x0204 utf-8, 0x0404 int32), length, max length, data offset.
function parseSfo(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== '\0PSF') return null;
  const keyTable = buf.readUInt32LE(8);
  const dataTable = buf.readUInt32LE(12);
  const count = buf.readUInt32LE(16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16;
    if (e + 16 > buf.length) break;
    const keyOff = buf.readUInt16LE(e);
    const fmt = buf.readUInt16LE(e + 2);
    const len = buf.readUInt32LE(e + 4);
    const dataOff = buf.readUInt32LE(e + 12);
    const kStart = keyTable + keyOff;
    const kEnd = buf.indexOf(0, kStart);
    const key = buf.toString('latin1', kStart, kEnd);
    const d = dataTable + dataOff;
    if (fmt === 0x0404) out[key] = buf.readUInt32LE(d);
    else out[key] = buf.toString('utf8', d, d + len).replace(/\0+$/, '');
  }
  return out;
}

function isPs4GameDir(dir) {
  return fs.existsSync(path.join(dir, 'eboot.bin')) && fs.existsSync(path.join(dir, 'sce_sys', 'param.sfo'));
}

// Update and DLC folders also contain eboot.bin; they are not separate games.
function isAddonDir(dir) {
  return /[-_ ](patch|update|upd|dlc)$/i.test(path.basename(dir));
}

function inspectPs4Dir(dir) {
  const sfo = parseSfo(fs.readFileSync(path.join(dir, 'sce_sys', 'param.sfo')));
  if (!sfo) return { ok: false, platform: 'ps4', reason: 'O param.sfo desse jogo está corrompido.' };
  const icon = path.join(dir, 'sce_sys', 'icon0.png');
  return {
    ok: true,
    platform: 'ps4',
    serial: sfo.TITLE_ID || path.basename(dir),
    internalTitle: (sfo.TITLE || '').trim() || null,
    version: sfo.APP_VER || sfo.VERSION || null,
    icon: fs.existsSync(icon) ? icon : null,
    region: regionFromContentId(sfo.CONTENT_ID),
  };
}

// CONTENT_ID starts with a region letter: UP (America), EP (Europe), JP (Japan), HP (Asia).
function regionFromContentId(id) {
  const p = (id || '').slice(0, 2);
  return { UP: 'América do Norte', EP: 'Europa', JP: 'Japão', HP: 'Ásia' }[p] || null;
}

module.exports = { parseSfo, isPs4GameDir, isAddonDir, inspectPs4Dir };
