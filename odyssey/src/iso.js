// Reads a PS2 disc image (ISO 9660) and pulls out what Odyssey needs to show it in the library:
// the game serial from SYSTEM.CNF (e.g. SLES-51156), the video mode and the volume label.
'use strict';

const fs = require('fs');

const SECTOR = 2048;

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  return buf.subarray(0, n);
}

// Walks one directory record list and returns { name -> { lba, size, isDir } }.
function readDirectory(fd, lba, size) {
  const data = readAt(fd, lba * SECTOR, size);
  const entries = {};
  let i = 0;
  while (i < data.length) {
    const len = data[i];
    if (len === 0) {
      // Records never cross sector boundaries; skip the padding to the next sector.
      i = (Math.floor(i / SECTOR) + 1) * SECTOR;
      continue;
    }
    const nameLen = data[i + 32];
    const rawName = data.subarray(i + 33, i + 33 + nameLen).toString('latin1');
    const flags = data[i + 25];
    const name = rawName.replace(/;\d+$/, '').toUpperCase();
    if (nameLen > 1 || (rawName !== '\u0000' && rawName !== '\u0001')) {
      entries[name] = {
        lba: data.readUInt32LE(i + 2),
        size: data.readUInt32LE(i + 10),
        isDir: (flags & 2) !== 0,
      };
    }
    i += len;
  }
  return entries;
}

function parseSystemCnf(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1].toUpperCase()] = m[2];
  }
  return out;
}

// "cdrom0:\SLES_511.56;1" -> "SLES-51156"
function serialFromBoot(boot) {
  if (!boot) return null;
  const file = boot.split(/[\\/:]/).pop().replace(/;\d+$/, '');
  const m = file.toUpperCase().match(/^([A-Z]{4})[_-](\d{3})\.?(\d{2})$/);
  return m ? `${m[1]}-${m[2]}${m[3]}` : null;
}

function regionFromSerial(serial) {
  if (!serial) return null;
  const p = serial.slice(0, 4);
  if (/^(SLES|SCES|SLED|SCED)$/.test(p)) return 'Europa';
  if (/^(SLUS|SCUS|SLUD)$/.test(p)) return 'América do Norte';
  if (/^(SLPS|SLPM|SCPS|SCAJ|SLAJ|SLKA|SCKA|PAPX|PCPX)$/.test(p)) return p === 'SLKA' || p === 'SCKA' ? 'Coreia' : 'Japão';
  return null;
}

function inspectIso(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const pvd = readAt(fd, 16 * SECTOR, SECTOR);
    if (pvd.length < 190 || pvd.toString('latin1', 1, 6) !== 'CD001') {
      return { ok: false, reason: 'Não é uma imagem ISO 9660 válida.' };
    }
    const system = pvd.toString('latin1', 8, 40).trim();
    const volume = pvd.toString('latin1', 40, 72).trim();
    const rootLba = pvd.readUInt32LE(156 + 2);
    const rootSize = pvd.readUInt32LE(156 + 10);
    const root = readDirectory(fd, rootLba, rootSize);

    const cnfEntry = root['SYSTEM.CNF'];
    if (!cnfEntry) {
      return { ok: true, platform: 'unknown', system, volume, serial: null, reason: 'Sem SYSTEM.CNF: não parece um disco de PlayStation.' };
    }
    const cnf = parseSystemCnf(readAt(fd, cnfEntry.lba * SECTOR, Math.min(cnfEntry.size, 4096)).toString('latin1'));
    const isPs2 = Boolean(cnf.BOOT2);
    const serial = serialFromBoot(cnf.BOOT2 || cnf.BOOT);
    return {
      ok: true,
      platform: isPs2 ? 'ps2' : 'ps1',
      system,
      volume,
      serial,
      region: regionFromSerial(serial),
      videoMode: cnf.VMODE || null,
      version: cnf.VER || null,
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { inspectIso, serialFromBoot, parseSystemCnf, regionFromSerial };
