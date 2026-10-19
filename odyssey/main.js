'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const { inspectIso } = require('./src/iso');
const { loadGameIndex, lookup } = require('./src/gamedb');
const { biosInfo, pickBios, setIniValue } = require('./src/bios');
const { inspectDreamcast, chdKind, MAGIC: KATANA } = require('./src/dreamcast');

const COVER_URL = (serial) => `https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/default/${serial}.jpg`;
const GAME_EXTENSIONS = new Set(['.iso', '.gdi', '.cdi', '.chd']);
// Bump when the way games are identified changes, so cached entries get inspected again.
const LIBRARY_VERSION = 2;

const SYSTEMS = {
  ps2: { name: 'PlayStation 2', needsBios: true },
  dreamcast: { name: 'Dreamcast', needsBios: false },
};

let win = null;
let running = null; // { child, key, startedAt }

// ---------- paths ----------

const userDir = () => app.getPath('userData');
const storePath = () => path.join(userDir(), 'odyssey.json');
const coversDir = () => path.join(userDir(), 'covers');
const engineDataDir = () => path.join(userDir(), 'engine-data');
// The engine appends "PCSX2" to whatever -datapath it gets, so its real data root is engine-data/PCSX2.
const engineRootDir = () => path.join(engineDataDir(), 'PCSX2');
const biosDir = () => path.join(engineRootDir(), 'bios');
const legacyBiosDir = () => path.join(engineDataDir(), 'bios');

function bundledEngineDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, 'engine');
}

function findEngineExe(dir) {
  try {
    const exe = fs.readdirSync(dir).find((f) => /^pcsx2-qt.*\.exe$/i.test(f) && !/updater/i.test(f));
    return exe ? path.join(dir, exe) : null;
  } catch {
    return null;
  }
}

function enginePath() {
  const custom = store.enginePath;
  if (custom && fs.existsSync(custom)) return custom;
  return findEngineExe(bundledEngineDir());
}

// ---------- Dreamcast engine (Flycast) ----------
// Flycast keeps emu.cfg and its data folder (VMU saves) next to its .exe. The installed app folder is
// replaced on every update, so Odyssey runs a copy that lives in its own data folder.
const flycastHome = () => path.join(userDir(), 'engines', 'flycast');

function bundledFlycast() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'engines', 'flycast') : path.join(__dirname, 'engines', 'flycast');
  const exe = path.join(dir, 'flycast.exe');
  return fs.existsSync(exe) ? exe : null;
}

function flycastPath() {
  const src = bundledFlycast();
  if (!src) return null;
  const dest = path.join(flycastHome(), 'flycast.exe');
  try {
    const a = fs.statSync(src);
    const b = fs.existsSync(dest) ? fs.statSync(dest) : null;
    if (!b || b.size !== a.size || Math.abs(b.mtimeMs - a.mtimeMs) > 2000) {
      fs.mkdirSync(flycastHome(), { recursive: true });
      fs.copyFileSync(src, dest);
      fs.utimesSync(dest, a.atime, a.mtime);
    }
    return dest;
  } catch {
    return src;
  }
}

function gameIndexPath() {
  const exe = enginePath();
  const dir = exe ? path.dirname(exe) : bundledEngineDir();
  return path.join(dir, 'resources', 'GameIndex.yaml');
}

// ---------- store ----------

let store = { folders: [], fullscreen: true, enginePath: null, games: {}, stats: {} };

function loadStore() {
  try {
    store = { ...store, ...JSON.parse(fs.readFileSync(storePath(), 'utf8')) };
  } catch {
    /* first run */
  }
}

function saveStore() {
  fs.mkdirSync(userDir(), { recursive: true });
  const tmp = storePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, storePath());
}

// ---------- library ----------

function walk(dir, depth, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) walk(full, depth - 1, out);
    else if (e.isFile() && GAME_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

function prettyFileName(file) {
  return path
    .basename(file, path.extname(file))
    .replace(/\s*\((?:En|Fr|De|Es|It|Pt|Ja|Nl|Sv|No|Da|Fi|Pl|Ru)(?:,[A-Za-z]{2})*\)\s*/g, ' ')
    .replace(/\s*\((?:USA|Europe|Japan|World|Brazil|Rev \d+|Disc \d+)[^)]*\)\s*/gi, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Dreamcast dumps are often just "disc.gdi"; then the title stored on the disc is the better name.
function gameTitle(file, info) {
  const fromFile = prettyFileName(file);
  const generic = /^(disc|disk|game|track\s*\d*|cd\s*\d*)$/i.test(fromFile);
  if (generic && info.internalTitle) {
    return info.internalTitle.toLowerCase().replace(/(^|[\s:-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  if (generic) return path.basename(path.dirname(file));
  return fromFile;
}

function statKey(game) {
  return game.serial || game.path;
}

function inspectFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.gdi' || ext === '.cdi') return inspectDreamcast(file);
  if (ext === '.chd') {
    const kind = chdKind(file);
    if (kind === 'dreamcast' || kind === 'ps2') return { ok: true, platform: kind, serial: null };
    return { ok: false, platform: 'unknown', reason: 'CHD de CD: ainda não sei dizer de qual console é.' };
  }
  const info = inspectIso(file);
  if (info.platform === 'unknown') {
    // A Dreamcast data image saved as .iso starts straight with IP.BIN.
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(0x100);
      fs.readSync(fd, head, 0, 0x100, 0);
      if (head.subarray(0, KATANA.length).equals(KATANA)) return require('./src/dreamcast').parseIpBin(head, 0);
    } finally {
      fs.closeSync(fd);
    }
  }
  return info;
}

function buildGame(file, info, db) {
  const meta = info.platform === 'ps2' ? lookup(db, info.serial) : null;
  const st = fs.statSync(file);
  return {
    path: file,
    fileName: path.basename(file),
    size: st.size,
    mtime: st.mtimeMs,
    platform: info.platform || 'unknown',
    serial: info.serial || null,
    title: (meta && meta.name) || gameTitle(file, info),
    region: info.region || null,
    regionCode: (meta && meta.region) || null,
    videoMode: info.videoMode || null,
    version: info.version || null,
    volume: info.volume || null,
    compat: meta ? meta.compat : null,
    compatLabel: meta ? meta.compatLabel : null,
    error: info.ok ? null : info.reason,
    v: LIBRARY_VERSION,
  };
}

function scanLibrary() {
  const db = loadGameIndex(gameIndexPath());
  const files = [];
  for (const folder of store.folders) walk(folder, 3, files);

  const games = {};
  for (const file of files) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const cached = store.games[file];
    if (cached && cached.size === st.size && cached.mtime === st.mtimeMs && cached.v === LIBRARY_VERSION) {
      // Refresh DB fields in case the engine (and its GameIndex) was updated.
      const meta = cached.platform === 'ps2' ? lookup(db, cached.serial) : null;
      games[file] = meta ? { ...cached, title: meta.name || cached.title, compat: meta.compat, compatLabel: meta.compatLabel } : cached;
      continue;
    }
    let info;
    try {
      info = inspectFile(file);
    } catch (e) {
      info = { ok: false, reason: 'Não consegui ler o arquivo: ' + e.message };
    }
    games[file] = buildGame(file, info, db);
  }
  store.games = games;
  saveStore();
  return libraryView();
}

function libraryView() {
  return Object.values(store.games)
    .map((g) => {
      const s = store.stats[statKey(g)] || {};
      const cover = g.serial && g.platform === 'ps2' ? path.join(coversDir(), g.serial + '.jpg') : null;
      return {
        ...g,
        playSeconds: s.seconds || 0,
        lastPlayed: s.lastPlayed || null,
        launches: s.launches || 0,
        coverUrl: cover && fs.existsSync(cover) ? pathToFileURL(cover).href : null,
      };
    })
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.title.localeCompare(b.title, 'pt-BR'));
}

async function fetchCover(serial) {
  if (!serial) return null;
  const dest = path.join(coversDir(), serial + '.jpg');
  if (fs.existsSync(dest)) return pathToFileURL(dest).href;
  try {
    const res = await net.fetch(COVER_URL(serial));
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return null;
    fs.mkdirSync(coversDir(), { recursive: true });
    fs.writeFileSync(dest, buf);
    return pathToFileURL(dest).href;
  } catch {
    return null;
  }
}

// ---------- BIOS ----------

function listBios() {
  try {
    return fs
      .readdirSync(biosDir())
      .map((f) => biosInfo(path.join(biosDir(), f)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Points the engine at the BIOS whose region matches the game, through [Filenames] BIOS in
// inis/PCSX2.ini. The engine rejects an INI without its own SettingsVersion, so on the very first
// launch we let it write its defaults with -testconfig (initializes config and exits) and then edit.
function selectBiosFor(serial) {
  const bios = pickBios(listBios(), serial);
  if (!bios) return null;
  const ini = path.join(engineRootDir(), 'inis', 'PCSX2.ini');
  if (!fs.existsSync(ini)) {
    const exe = enginePath();
    if (exe) {
      spawnSync(exe, engineArgs(['-testconfig']), { cwd: path.dirname(exe), timeout: 30000, windowsHide: true, stdio: 'ignore' });
    }
  }
  try {
    const text = fs.readFileSync(ini, 'utf8');
    fs.writeFileSync(ini, setIniValue(text, 'Filenames', 'BIOS', bios.name));
    return bios;
  } catch {
    // No INI yet: the engine will pick a BIOS from the folder on its own.
    return null;
  }
}

// Odyssey 0.1.0/0.1.1 imported BIOS files into engine-data/bios, which the engine never reads.
// Move them to the folder the engine actually searches.
function migrateLegacyBios() {
  let files;
  try {
    files = fs.readdirSync(legacyBiosDir());
  } catch {
    return;
  }
  fs.mkdirSync(biosDir(), { recursive: true });
  for (const f of files) {
    const src = path.join(legacyBiosDir(), f);
    const dest = path.join(biosDir(), f);
    try {
      if (!fs.statSync(src).isFile()) continue;
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } catch {
      /* leave it; the user can import again */
    }
  }
  try {
    fs.rmdirSync(legacyBiosDir());
  } catch {
    /* not empty or already gone */
  }
}

// A PS2 BIOS is a 4 MB ROM that starts with a "RESET" entry in its ROMDIR table.
function looksLikePs2Bios(file) {
  const st = fs.statSync(file);
  if (st.size < 4 * 1024 * 1024 || st.size > 8 * 1024 * 1024) return false;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.includes(Buffer.from('RESET\0', 'latin1'));
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- engine ----------

function engineArgs(extra) {
  return ['-odyssey', '-datapath', engineDataDir(), ...extra];
}

function launchEngine(args, key) {
  const exe = enginePath();
  if (!exe) return { ok: false, error: 'O motor do Odyssey não foi encontrado. Indique o executável em Ajustes.' };
  fs.mkdirSync(biosDir(), { recursive: true });
  return startProcess(exe, engineArgs(args), key);
}

function startProcess(exe, args, key) {
  if (running) return { ok: false, error: 'Já tem um jogo aberto. Feche ele antes de abrir outro.' };
  const child = spawn(exe, args, { cwd: path.dirname(exe), detached: false, stdio: 'ignore' });
  running = { child, key, startedAt: Date.now() };
  child.on('error', (e) => finishRun(e.message));
  child.on('exit', () => finishRun(null));
  send('engine:state', { running: true, key });
  return { ok: true };
}

function finishRun(error) {
  if (!running) return;
  const { key, startedAt } = running;
  running = null;
  if (key) {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const s = store.stats[key] || { seconds: 0, launches: 0 };
    s.seconds += seconds;
    s.launches += 1;
    s.lastPlayed = Date.now();
    store.stats[key] = s;
    saveStore();
  }
  send('engine:state', { running: false, key, error });
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- IPC ----------

function status() {
  return {
    folders: store.folders,
    fullscreen: store.fullscreen,
    engine: enginePath(),
    engineCustom: store.enginePath,
    bios: listBios(),
    dreamcast: Boolean(bundledFlycast()),
    biosDir: biosDir(),
    running: running ? running.key : null,
    version: app.getVersion(),
  };
}

ipcMain.handle('status', () => status());
ipcMain.handle('library:list', () => libraryView());
ipcMain.handle('library:scan', () => scanLibrary());
ipcMain.handle('library:cover', (_e, serial) => fetchCover(serial));

ipcMain.handle('folders:add', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Escolha a pasta dos seus jogos', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return status();
  if (!store.folders.includes(r.filePaths[0])) store.folders.push(r.filePaths[0]);
  saveStore();
  return status();
});

ipcMain.handle('folders:remove', (_e, folder) => {
  store.folders = store.folders.filter((f) => f !== folder);
  saveStore();
  return status();
});

ipcMain.handle('bios:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolha o arquivo da BIOS do seu PS2',
    properties: ['openFile'],
    filters: [{ name: 'BIOS do PS2', extensions: ['bin', 'rom', 'BIN', 'ROM'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, status: status() };
  const src = r.filePaths[0];
  if (!looksLikePs2Bios(src)) {
    return { ok: false, error: 'Esse arquivo não parece uma BIOS de PS2. A BIOS tem 4 MB e é extraída do seu próprio console.', status: status() };
  }
  fs.mkdirSync(biosDir(), { recursive: true });
  fs.copyFileSync(src, path.join(biosDir(), path.basename(src)));
  return { ok: true, status: status() };
});

ipcMain.handle('bios:open', () => {
  fs.mkdirSync(biosDir(), { recursive: true });
  shell.openPath(biosDir());
});

ipcMain.handle('settings:fullscreen', (_e, on) => {
  store.fullscreen = Boolean(on);
  saveStore();
  return status();
});

ipcMain.handle('settings:engine', async (_e, reset) => {
  if (reset) {
    store.enginePath = null;
  } else {
    const r = await dialog.showOpenDialog(win, {
      title: 'Escolha o executável do motor (pcsx2-qt.exe)',
      properties: ['openFile'],
      filters: [{ name: 'Executável', extensions: ['exe'] }],
    });
    if (r.canceled || !r.filePaths[0]) return status();
    store.enginePath = r.filePaths[0];
  }
  saveStore();
  return status();
});

ipcMain.handle('game:play', (_e, file) => {
  const game = store.games[file];
  if (!game) return { ok: false, error: 'Esse jogo não está mais na biblioteca. Atualize a lista.' };
  if (!fs.existsSync(file)) return { ok: false, error: 'O arquivo do jogo não foi encontrado. Ele foi movido ou apagado?' };
  if (game.platform === 'dreamcast') {
    const exe = flycastPath();
    if (!exe) return { ok: false, error: 'O motor de Dreamcast não veio nesta versão do Odyssey.' };
    const args = ['-config', `window:fullscreen=${store.fullscreen ? 'yes' : 'no'}`, file];
    return startProcess(exe, args, statKey(game));
  }
  if (game.platform !== 'ps2') return { ok: false, error: 'Esse disco ainda não tem um motor no Odyssey.' };
  if (listBios().length === 0) return { ok: false, needsBios: true, error: 'Falta a BIOS do PS2. Importe ela em Ajustes antes de jogar.' };
  const bios = selectBiosFor(game.serial);
  const args = ['-batch', '-nogui'];
  if (store.fullscreen) args.push('-fullscreen');
  args.push('--', file);
  const r = launchEngine(args, statKey(game));
  return bios ? { ...r, bios: bios.name } : r;
});

ipcMain.handle('game:reveal', (_e, file) => shell.showItemInFolder(file));

ipcMain.handle('engine:settings', () => launchEngine([], null));

ipcMain.handle('engine:stop', () => {
  if (running) running.child.kill();
  return { ok: true };
});

ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ---------- updates ----------
// The installed version updates itself from GitHub Releases (electron-updater downloads only the
// changed blocks). The portable .exe can't replace itself, so it just tells the user a new one exists.

const RELEASES_URL = 'https://github.com/JulioMLucena/Odyssey/releases/latest';
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
let update = { state: 'idle' }; // idle | checking | downloading | ready | available-portable | error

function setUpdate(next) {
  update = { ...next };
  send('update:state', update);
}

function setupUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = !isPortable;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'idle' }));
  autoUpdater.on('update-available', (info) =>
    setUpdate(isPortable ? { state: 'available-portable', version: info.version } : { state: 'downloading', version: info.version, percent: 0 })
  );
  autoUpdater.on('download-progress', (p) => setUpdate({ ...update, state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => setUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', () => setUpdate({ state: 'idle' }));

  const check = () => {
    if (update.state === 'downloading' || update.state === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => setUpdate({ state: 'idle' }));
  };
  setTimeout(check, 4000);
  setInterval(check, 60 * 60 * 1000);

  ipcMain.handle('update:install', () => {
    if (update.state === 'available-portable') {
      shell.openExternal(RELEASES_URL);
      return { ok: true };
    }
    if (update.state !== 'ready') return { ok: false };
    if (running) return { ok: false, error: 'Feche o jogo antes de atualizar.' };
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true };
  });
}

ipcMain.handle('update:state', () => update);

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'Odyssey',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    loadStore();
    migrateLegacyBios();
    createWindow();
    setupUpdater();
  });
  app.on('window-all-closed', () => {
    if (running) running.child.kill();
    app.quit();
  });
}
