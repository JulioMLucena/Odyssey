// Looks up game names and compatibility in the engine's GameIndex.yaml (shipped with PCSX2).
// The file has ~13k entries; we only read the three fields we need with a line scanner.
'use strict';

const fs = require('fs');

const COMPAT_LABELS = {
  0: 'Desconhecida',
  1: 'Nada funciona',
  2: 'Só a intro',
  3: 'Chega ao menu',
  4: 'Jogável com problemas',
  5: 'Perfeito',
};

function parseGameIndex(text) {
  const db = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^([A-Z]{4}-\d{5}):\s*$/);
    if (top) {
      current = { serial: top[1] };
      db.set(top[1], current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^ {2}(name|name-en|region|compat):\s*(.*?)\s*$/);
    if (field) {
      let v = field[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
      current[field[1]] = field[1] === 'compat' ? Number(v) : v;
    }
  }
  return db;
}

let cache = null;
let cachePath = null;

function loadGameIndex(yamlPath) {
  if (cache && cachePath === yamlPath) return cache;
  try {
    cache = parseGameIndex(fs.readFileSync(yamlPath, 'utf8'));
  } catch (e) {
    cache = new Map();
  }
  cachePath = yamlPath;
  return cache;
}

function lookup(db, serial) {
  if (!serial || !db) return null;
  const e = db.get(serial);
  if (!e) return null;
  const compat = Number.isFinite(e.compat) ? e.compat : 0;
  return {
    name: e['name-en'] || e.name || null,
    region: e.region || null,
    compat,
    compatLabel: COMPAT_LABELS[compat] || COMPAT_LABELS[0],
  };
}

module.exports = { parseGameIndex, loadGameIndex, lookup, COMPAT_LABELS };
