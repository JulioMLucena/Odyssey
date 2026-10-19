// Builds a tiny fake PS2 disc image in memory and checks that the ISO reader finds the serial.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectIso, serialFromBoot } = require('../src/iso');
const { parseGameIndex, lookup } = require('../src/gamedb');

const S = 2048;

function dirRecord(name, lba, size, isDir) {
  const nameBuf = Buffer.from(name, 'latin1');
  const len = 33 + nameBuf.length + (nameBuf.length % 2 === 0 ? 1 : 0);
  const r = Buffer.alloc(len);
  r[0] = len;
  r.writeUInt32LE(lba, 2);
  r.writeUInt32BE(lba, 6);
  r.writeUInt32LE(size, 10);
  r.writeUInt32BE(size, 14);
  r[25] = isDir ? 2 : 0;
  r[32] = nameBuf.length;
  nameBuf.copy(r, 33);
  return r;
}

function makeIso(cnfText) {
  const img = Buffer.alloc(S * 24);
  const pvd = img.subarray(16 * S, 17 * S);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'latin1');
  pvd.write('PLAYSTATION'.padEnd(32), 8, 'latin1');
  pvd.write('TEST_DISC'.padEnd(32), 40, 'latin1');
  dirRecord('\u0000', 20, S, true).copy(pvd, 156);
  const cnf = Buffer.from(cnfText, 'latin1');
  const root = Buffer.concat([
    dirRecord('\u0000', 20, S, true),
    dirRecord('\u0001', 20, S, true),
    dirRecord('SLES_511.56;1', 22, 1000, false),
    dirRecord('SYSTEM.CNF;1', 21, cnf.length, false),
  ]);
  root.copy(img, 20 * S);
  cnf.copy(img, 21 * S);
  const file = path.join(os.tmpdir(), `odyssey-test-${process.pid}.iso`);
  fs.writeFileSync(file, img);
  return file;
}

assert.strictEqual(serialFromBoot('cdrom0:\\SLES_511.56;1'), 'SLES-51156');
assert.strictEqual(serialFromBoot('cdrom:\\SLUS_200.62;1'), 'SLUS-20062');
assert.strictEqual(serialFromBoot('garbage'), null);

const ps2 = makeIso('BOOT2 = cdrom0:\\SLES_511.56;1\r\nVER = 1.02\r\nVMODE = PAL\r\n');
const info = inspectIso(ps2);
assert.strictEqual(info.ok, true);
assert.strictEqual(info.platform, 'ps2');
assert.strictEqual(info.serial, 'SLES-51156');
assert.strictEqual(info.region, 'Europa');
assert.strictEqual(info.videoMode, 'PAL');
assert.strictEqual(info.version, '1.02');
assert.strictEqual(info.volume, 'TEST_DISC');
fs.unlinkSync(ps2);

const ps1 = makeIso('BOOT = cdrom:\\SLUS_007.07;1\r\nTCB = 4\r\n');
assert.strictEqual(inspectIso(ps1).platform, 'ps1');
fs.unlinkSync(ps1);

const junk = path.join(os.tmpdir(), `odyssey-junk-${process.pid}.iso`);
fs.writeFileSync(junk, Buffer.alloc(S * 20));
assert.strictEqual(inspectIso(junk).ok, false);
fs.unlinkSync(junk);

const db = parseGameIndex('SLES-51156:\n  name: "Silent Hill 2 - Director\'s Cut"\n  region: "PAL-M5"\n  compat: 5\n  speedHacks:\n    eeCycleRate: 1\nSLPM-12345:\n  name: "テスト"\n  name-en: "Test Game"\n  compat: 3\n');
assert.deepStrictEqual(lookup(db, 'SLES-51156'), { name: "Silent Hill 2 - Director's Cut", region: 'PAL-M5', compat: 5, compatLabel: 'Perfeito' });
assert.strictEqual(lookup(db, 'SLPM-12345').name, 'Test Game');
assert.strictEqual(lookup(db, 'SLUS-00000'), null);

const engineIndex = path.join(__dirname, '..', '..', 'bin', 'resources', 'GameIndex.yaml');
if (fs.existsSync(engineIndex)) {
  const real = parseGameIndex(fs.readFileSync(engineIndex, 'utf8'));
  assert.ok(real.size > 10000, 'GameIndex should have thousands of entries');
  assert.strictEqual(lookup(real, 'SLES-51156').compat, 5);
}

console.log('ISO reader: all tests passed');

// ---------- BIOS helpers ----------
const { readRomver, pickBios, setIniValue } = require('../src/bios');

function fakeBios(romver) {
  const buf = Buffer.alloc(0x3000);
  const entries = [
    ['RESET', 0x2000],
    ['ROMDIR', 0x40],
    ['EXTINFO', 0x10],
    ['ROMVER', 0x10],
  ];
  let off = 0;
  const dirAt = 0x100;
  entries.forEach(([name, size], i) => {
    const p = dirAt + i * 16;
    buf.write(name, p, 'latin1');
    buf.writeUInt32LE(size, p + 12);
    if (name === 'ROMVER') buf.write(romver, off, 'latin1');
    off += (size + 15) & ~15;
  });
  return buf;
}
assert.strictEqual(readRomver(fakeBios('0230EC20040614')), '0230EC20040614');
const list = [
  { name: 'SCPH-90000 (JP).bin', romver: '0250JC', region: 'J' },
  { name: 'SCPH-90001 (USA).bin', romver: '0250AC', region: 'A' },
  { name: 'SCPH-90004 (EU).bin', romver: '0250EC', region: 'E' },
];
assert.strictEqual(pickBios(list, 'SLES-51156').name, 'SCPH-90004 (EU).bin');
assert.strictEqual(pickBios(list, 'SLUS-20312').name, 'SCPH-90001 (USA).bin');
assert.strictEqual(pickBios(list, 'SLPM-65051').name, 'SCPH-90000 (JP).bin');
assert.strictEqual(pickBios([list[0]], 'SLES-51156').name, 'SCPH-90000 (JP).bin');

const ini = '[UI]\nSettingsVersion = 1\n\n[Filenames]\nBIOS = \n\n[EmuCore]\nCdvdShareWrite = false\n';
assert.ok(setIniValue(ini, 'Filenames', 'BIOS', 'x.bin').includes('[Filenames]\nBIOS = x.bin\n'));
const noKey = setIniValue('[UI]\nA = 1\n\n[Filenames]\nOther = 2\n\n[X]\nY = 3\n', 'Filenames', 'BIOS', 'x.bin');
assert.ok(noKey.includes('Other = 2\nBIOS = x.bin\n\n[X]'));
assert.ok(setIniValue('[UI]\nA = 1\n', 'Filenames', 'BIOS', 'x.bin').endsWith('[Filenames]\nBIOS = x.bin\n'));
console.log('BIOS helpers: all tests passed');

// ---------- Dreamcast ----------
const { inspectGdi, inspectCdi, chdKind } = require('../src/dreamcast');
function ipBin(product, title, area) {
  const b = Buffer.alloc(0x100, 0x20);
  b.write('SEGA SEGAKATANA ', 0, 'latin1');
  b.write(area.padEnd(8), 0x30, 'latin1');
  b.write(product.padEnd(10), 0x40, 'latin1');
  b.write('V1.004', 0x4a, 'latin1');
  b.write(title.padEnd(128), 0x80, 'latin1');
  return b;
}
const dcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssey-dc-'));
const t3 = Buffer.concat([Buffer.alloc(16), ipBin('MK-51000', 'SONIC ADVENTURE', 'JUE'), Buffer.alloc(4096)]);
fs.writeFileSync(path.join(dcDir, 'track03.bin'), t3);
fs.writeFileSync(path.join(dcDir, 'game.gdi'), '3\n1 0 4 2352 track01.bin 0\n2 450 0 2352 track02.raw 0\n3 45000 4 2352 track03.bin 0\n');
const gdi = inspectGdi(path.join(dcDir, 'game.gdi'));
assert.strictEqual(gdi.platform, 'dreamcast');
assert.strictEqual(gdi.serial, 'MK-51000');
assert.strictEqual(gdi.internalTitle, 'SONIC ADVENTURE');
assert.strictEqual(gdi.region, 'Japão · América do Norte · Europa');
fs.writeFileSync(path.join(dcDir, 'game.cdi'), Buffer.concat([Buffer.alloc(300000), ipBin('T-9504N', 'CRAZY TAXI', 'U'), Buffer.alloc(1000)]));
assert.strictEqual(inspectCdi(path.join(dcDir, 'game.cdi')).serial, 'T-9504N');

function fakeChd(tag) {
  const head = Buffer.alloc(124);
  head.write('MComprHD', 0, 'latin1');
  head.writeUInt32BE(124, 8);
  head.writeUInt32BE(5, 12);
  head.writeBigUInt64BE(200n, 48);
  const meta = Buffer.alloc(16);
  meta.write(tag, 0, 'latin1');
  return Buffer.concat([head, Buffer.alloc(76), meta]);
}
fs.writeFileSync(path.join(dcDir, 'a.chd'), fakeChd('CHGD'));
fs.writeFileSync(path.join(dcDir, 'b.chd'), fakeChd('DVD '));
assert.strictEqual(chdKind(path.join(dcDir, 'a.chd')), 'dreamcast');
assert.strictEqual(chdKind(path.join(dcDir, 'b.chd')), 'ps2');
fs.rmSync(dcDir, { recursive: true, force: true });
console.log('Dreamcast reader: all tests passed');

// ---------- PS4 ----------
const { parseSfo, isPs4GameDir, isAddonDir, inspectPs4Dir } = require('../src/ps4');
function sfo(entries) {
  const keys = Buffer.concat(entries.map(([k]) => Buffer.from(k + '\0', 'latin1')));
  const datas = entries.map(([, v]) => (typeof v === 'number' ? (() => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; })() : Buffer.from(v + '\0', 'utf8')));
  const head = Buffer.alloc(20 + entries.length * 16);
  head.write('\0PSF', 0, 'latin1');
  head.writeUInt32LE(0x101, 4);
  const keyTable = head.length;
  const keysPadded = Buffer.concat([keys, Buffer.alloc((4 - (keys.length % 4)) % 4)]);
  const dataTable = keyTable + keysPadded.length;
  head.writeUInt32LE(keyTable, 8);
  head.writeUInt32LE(dataTable, 12);
  head.writeUInt32LE(entries.length, 16);
  let ko = 0, dof = 0;
  entries.forEach(([k, v], i) => {
    const e = 20 + i * 16;
    head.writeUInt16LE(ko, e);
    head.writeUInt16LE(typeof v === 'number' ? 0x0404 : 0x0204, e + 2);
    head.writeUInt32LE(datas[i].length, e + 4);
    head.writeUInt32LE(datas[i].length, e + 8);
    head.writeUInt32LE(dof, e + 12);
    ko += k.length + 1;
    dof += datas[i].length;
  });
  return Buffer.concat([head, keysPadded, ...datas]);
}
const p4 = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssey-ps4-'));
const g = path.join(p4, 'CUSA00001');
fs.mkdirSync(path.join(g, 'sce_sys'), { recursive: true });
fs.writeFileSync(path.join(g, 'eboot.bin'), 'x');
fs.writeFileSync(path.join(g, 'sce_sys', 'param.sfo'), sfo([['APP_VER', '01.02'], ['CONTENT_ID', 'EP9000-CUSA00001_00-GAME000000000000'], ['TITLE', 'Bloodborne™'], ['TITLE_ID', 'CUSA00001'], ['PARENTAL_LEVEL', 5]]));
assert.ok(isPs4GameDir(g));
assert.ok(isAddonDir(path.join(p4, 'CUSA00001-patch')));
assert.ok(!isAddonDir(g));
const info4 = inspectPs4Dir(g);
assert.strictEqual(info4.platform, 'ps4');
assert.strictEqual(info4.serial, 'CUSA00001');
assert.strictEqual(info4.internalTitle, 'Bloodborne™');
assert.strictEqual(info4.version, '01.02');
assert.strictEqual(info4.region, 'Europa');
assert.strictEqual(parseSfo(Buffer.from('nope')), null);
fs.rmSync(p4, { recursive: true, force: true });
console.log('PS4 reader: all tests passed');
