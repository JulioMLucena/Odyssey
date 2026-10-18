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
