// Reads a PS2 BIOS ROM's ROMVER entry to learn its region, and picks the best BIOS for a game.
'use strict';

const fs = require('fs');
const path = require('path');

const REGION_NAMES = { J: 'Japão', A: 'América do Norte', E: 'Europa', H: 'Ásia', C: 'China', T: 'T10K' };

// ROMDIR entries are 16 bytes: name[10], ext info size (u16), file size (u32).
// Files are laid out back to back in ROM order, each aligned to 16 bytes, starting with RESET at 0.
function readRomver(buf) {
  const start = buf.indexOf(Buffer.from('RESET\0', 'latin1'));
  if (start < 0) return null;
  let offset = 0;
  for (let p = start; p + 16 <= buf.length; p += 16) {
    const name = buf.toString('latin1', p, p + 10).replace(/\0.*$/s, '');
    if (!name) break;
    const size = buf.readUInt32LE(p + 12);
    if (name === 'ROMVER') return buf.toString('latin1', offset, Math.min(buf.length, offset + 16)).replace(/[^\x20-\x7e]/g, '').trim();
    offset += (size + 15) & ~15;
  }
  return null;
}

function biosInfo(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < 4 * 1024 * 1024 || st.size > 8 * 1024 * 1024) return null;
    const buf = fs.readFileSync(file);
    const romver = readRomver(buf);
    // ROMVER looks like "0230EC20040614": version 02.30, region E, console C.
    const region = romver && /^[0-9]{4}[A-Z]/.test(romver) ? romver[4] : null;
    return { name: path.basename(file), size: st.size, romver, region, regionName: REGION_NAMES[region] || null };
  } catch {
    return null;
  }
}

function preferredRegions(serial) {
  const p = (serial || '').slice(0, 4);
  if (/^(SLES|SCES|SLED|SCED)$/.test(p)) return ['E', 'A', 'J'];
  if (/^(SLUS|SCUS|SLUD)$/.test(p)) return ['A', 'E', 'J'];
  if (/^(SLKA|SCKA)$/.test(p)) return ['H', 'J', 'A'];
  if (/^(SLPS|SLPM|SCPS|SCAJ|SLAJ|PAPX|PCPX)$/.test(p)) return ['J', 'H', 'A'];
  return ['A', 'E', 'J'];
}

function pickBios(list, serial) {
  const valid = list.filter((b) => b && b.romver);
  for (const r of preferredRegions(serial)) {
    const hit = valid.find((b) => b.region === r);
    if (hit) return hit;
  }
  return valid[0] || null;
}

// Sets key=value inside [section] of an INI file, creating the section or key when missing.
function setIniValue(text, section, key, value) {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let sectionEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*\[(.+?)\]\s*$/);
    if (header) {
      if (inSection) {
        sectionEnd = i;
        break;
      }
      inSection = header[1] === section;
      continue;
    }
    if (inSection && new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) {
      lines[i] = `${key} = ${value}`;
      return lines.join('\n');
    }
  }
  if (inSection) {
    const at = sectionEnd < 0 ? lines.length : sectionEnd;
    let insert = at;
    while (insert > 0 && lines[insert - 1].trim() === '') insert--;
    lines.splice(insert, 0, `${key} = ${value}`);
    return lines.join('\n');
  }
  const trimmed = text.replace(/\s*$/, '');
  return `${trimmed}${trimmed ? '\n\n' : ''}[${section}]\n${key} = ${value}\n`;
}

module.exports = { readRomver, biosInfo, pickBios, preferredRegions, setIniValue, REGION_NAMES };
