'use strict';

(() => {
  const api = window.odyssey;
  const $ = (id) => document.getElementById(id);

  let status = null;
  let games = [];
  let selected = null; // game path
  let filter = '';
  let skipOnboarding = false;

  // ---------- helpers ----------

  function fmtSize(bytes) {
    if (!bytes) return '—';
    const gb = bytes / 1024 ** 3;
    return gb >= 1 ? gb.toFixed(2).replace('.', ',') + ' GB' : Math.round(bytes / 1024 ** 2) + ' MB';
  }

  function fmtTime(sec) {
    if (!sec) return '0 min';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
  }

  function fmtWhen(ts) {
    if (!ts) return 'Nunca';
    const d = new Date(ts);
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days === 0) return 'Hoje, ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Ontem';
    if (days < 7) return `Há ${days} dias`;
    return d.toLocaleDateString('pt-BR');
  }

  function videoLabel(g) {
    if (!g.videoMode) return g.platform === 'ps2' ? 'NTSC' : '—';
    return g.videoMode.toUpperCase() === 'PAL' ? 'PAL · 50 Hz' : g.videoMode.toUpperCase();
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', Boolean(isError));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3200);
  }

  function coverNode(g) {
    if (g.coverUrl) {
      const img = document.createElement('img');
      img.src = g.coverUrl;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    const fb = document.createElement('div');
    fb.className = 'fallback';
    const band = document.createElement('div');
    band.className = 'fb-band';
    band.textContent = g.platform === 'ps2' ? 'PLAYSTATION 2' : g.platform === 'ps1' ? 'PLAYSTATION' : 'DISCO';
    const title = document.createElement('div');
    title.className = 'fb-title';
    title.textContent = g.title;
    const serial = document.createElement('div');
    serial.className = 'fb-band';
    serial.textContent = g.serial || 'SEM SERIAL';
    fb.append(band, title, serial);
    return fb;
  }

  // ---------- rendering ----------

  function visibleGames() {
    if (!filter) return games;
    const q = filter.toLowerCase();
    return games.filter((g) => g.title.toLowerCase().includes(q) || (g.serial || '').toLowerCase().includes(q));
  }

  function renderShelf() {
    const shelf = $('shelf');
    shelf.textContent = '';
    const list = visibleGames();
    for (const g of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(g.path === selected));
      b.dataset.path = g.path;
      const c = document.createElement('div');
      c.className = 'cover';
      c.appendChild(coverNode(g));
      const t = document.createElement('span');
      t.className = 't-title';
      t.textContent = g.title;
      const s = document.createElement('span');
      s.className = 't-serial';
      s.textContent = g.serial || g.fileName;
      b.append(c, t, s);
      b.addEventListener('click', () => select(g.path));
      b.addEventListener('dblclick', () => play(g.path));
      shelf.appendChild(b);
    }
    $('count').textContent = games.length === 1 ? '1 jogo' : `${games.length} jogos`;
    const empty = $('empty');
    if (!games.length) {
      empty.hidden = false;
      empty.textContent = status.folders.length
        ? 'Nenhuma ISO encontrada nas suas pastas. Confira se os jogos estão em .iso e clique em Atualizar biblioteca.'
        : 'Nenhuma pasta de jogos escolhida ainda. Adicione uma em Ajustes.';
    } else if (!list.length) {
      empty.hidden = false;
      empty.textContent = `Nenhum jogo encontrado para "${filter}".`;
    } else {
      empty.hidden = true;
    }
  }

  function renderFeature() {
    const g = games.find((x) => x.path === selected);
    $('feature').hidden = !g;
    if (!g) return;
    const cov = $('featureCover');
    cov.textContent = '';
    cov.appendChild(coverNode(g));
    $('featureEyebrow').textContent =
      (g.platform === 'ps2' ? 'PlayStation 2' : g.platform === 'ps1' ? 'PlayStation' : 'Disco desconhecido') +
      (g.version ? ` · versão ${g.version}` : '');
    $('featureTitle').textContent = g.title;
    $('fSerial').textContent = g.serial || '—';
    $('fRegion').textContent = g.region || '—';
    $('fVideo').textContent = videoLabel(g);
    $('fSize').textContent = fmtSize(g.size);
    $('fTime').textContent = fmtTime(g.playSeconds);
    $('fLast').textContent = fmtWhen(g.lastPlayed);
    const compat = $('fCompat');
    compat.hidden = g.compat == null;
    compat.dataset.level = g.compat || 0;
    $('fCompatText').textContent = g.compatLabel || '';
    const err = $('fError');
    let warn = g.error;
    if (!warn && g.platform === 'ps1') warn = 'Isso é um disco de PS1. O motor atual é de PS2, então esse jogo ainda não roda aqui.';
    if (!warn && g.platform === 'unknown') warn = 'Esse disco não parece ser de PlayStation.';
    err.hidden = !warn;
    err.textContent = warn || '';
    $('btnPlay').disabled = g.platform !== 'ps2';
  }

  function render() {
    renderShelf();
    renderFeature();
  }

  function renderSettings() {
    const fl = $('folderList');
    fl.textContent = '';
    if (!status.folders.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'Nenhuma pasta ainda.';
      fl.appendChild(li);
    }
    for (const f of status.folders) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = f;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = 'Remover';
      rm.setAttribute('aria-label', 'Remover a pasta ' + f);
      rm.addEventListener('click', async () => {
        status = await api.removeFolder(f);
        renderSettings();
        await rescan();
      });
      li.append(span, rm);
      fl.appendChild(li);
    }
    const bl = $('biosList');
    bl.textContent = '';
    if (!status.bios.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'Nenhuma BIOS importada. Os jogos não abrem sem ela.';
      bl.appendChild(li);
    }
    for (const b of status.bios) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${b.name} · ${fmtSize(b.size)}`;
      li.appendChild(span);
      bl.appendChild(li);
    }
    $('optFullscreen').checked = status.fullscreen;
    $('enginePath').textContent = status.engine || 'Motor não encontrado.';
    $('btnEngineReset').hidden = !status.engineCustom;
    $('version').textContent = status.version;
  }

  function renderOnboarding() {
    const needs = !status.folders.length || !status.bios.length;
    const show = needs && !skipOnboarding;
    $('onboarding').hidden = !show;
    $('library').hidden = show;
    $('stepFolder').classList.toggle('done', status.folders.length > 0);
    $('stepFolderDone').hidden = !status.folders.length;
    $('stepFolderDone').textContent = status.folders.join(' · ');
    $('stepBios').classList.toggle('done', status.bios.length > 0);
    $('stepBiosDone').hidden = !status.bios.length;
    $('stepBiosDone').textContent = status.bios.map((b) => b.name).join(' · ');
  }

  // ---------- actions ----------

  function select(p) {
    selected = p;
    render();
    const tile = document.querySelector(`.tile[data-path="${CSS.escape(p)}"]`);
    if (tile) {
      tile.focus({ preventScroll: true });
      tile.scrollIntoView({ block: 'nearest' });
    }
  }

  async function loadCovers() {
    const missing = games.filter((g) => g.serial && !g.coverUrl);
    for (const g of missing) {
      const url = await api.cover(g.serial);
      if (url) {
        g.coverUrl = url;
        render();
      }
    }
  }

  async function rescan(announce) {
    games = await api.scanGames();
    if (!games.find((g) => g.path === selected)) selected = games[0] ? games[0].path : null;
    render();
    if (announce) toast(games.length === 1 ? 'Biblioteca atualizada: 1 jogo.' : `Biblioteca atualizada: ${games.length} jogos.`);
    loadCovers();
  }

  async function refreshStatus() {
    status = await api.status();
    renderSettings();
    renderOnboarding();
  }

  async function play(p) {
    const g = games.find((x) => x.path === p);
    if (!g || g.platform !== 'ps2') return;
    const r = await api.play(p);
    if (!r.ok) {
      toast(r.error, true);
      if (r.needsBios) openDrawer();
      return;
    }
    $('playingTitle').textContent = g.title;
    $('playing').hidden = false;
  }

  async function importBios() {
    const r = await api.importBios();
    status = r.status;
    renderSettings();
    renderOnboarding();
    if (r.ok) toast('BIOS importada.');
    else if (r.error) toast(r.error, true);
  }

  async function addFolder() {
    const before = status.folders.length;
    status = await api.addFolder();
    renderSettings();
    renderOnboarding();
    if (status.folders.length > before) await rescan(true);
  }

  function openDrawer() {
    $('drawer').hidden = false;
    $('btnCloseSettings').focus();
  }
  function closeDrawer() {
    $('drawer').hidden = true;
  }

  // ---------- wiring ----------

  $('btnScan').addEventListener('click', () => rescan(true));
  $('btnSettings').addEventListener('click', openDrawer);
  $('btnCloseSettings').addEventListener('click', closeDrawer);
  $('btnAddFolder').addEventListener('click', addFolder);
  $('obFolder').addEventListener('click', addFolder);
  $('btnBios').addEventListener('click', importBios);
  $('obBios').addEventListener('click', importBios);
  $('btnBiosFolder').addEventListener('click', () => api.openBiosFolder());
  $('obSkip').addEventListener('click', () => {
    skipOnboarding = true;
    renderOnboarding();
  });
  $('optFullscreen').addEventListener('change', async (e) => {
    status = await api.setFullscreen(e.target.checked);
  });
  $('btnEngine').addEventListener('click', async () => {
    status = await api.chooseEngine();
    renderSettings();
  });
  $('btnEngineReset').addEventListener('click', async () => {
    status = await api.resetEngine();
    renderSettings();
  });
  $('btnEngineSettings').addEventListener('click', async () => {
    const r = await api.engineSettings();
    if (!r.ok) toast(r.error, true);
    else {
      $('playingTitle').textContent = 'Ajustes do motor';
      $('playing').hidden = false;
    }
  });
  $('btnPlay').addEventListener('click', () => selected && play(selected));
  $('btnReveal').addEventListener('click', () => selected && api.reveal(selected));
  $('btnStop').addEventListener('click', () => api.stop());
  $('lnkPcsx2').addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal(e.currentTarget.href);
  });
  $('search').addEventListener('input', (e) => {
    filter = e.target.value.trim();
    renderShelf();
  });

  api.onEngineState(async (s) => {
    if (s.running) return;
    $('playing').hidden = true;
    if (s.error) toast('O motor fechou com erro: ' + s.error, true);
    games = await api.listGames();
    render();
  });

  // Keyboard and gamepad navigation over the shelf.
  function columns() {
    const tiles = document.querySelectorAll('.tile');
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    let n = 0;
    for (const t of tiles) {
      if (t.offsetTop !== top) break;
      n++;
    }
    return n;
  }
  function move(dx, dy) {
    const list = visibleGames();
    if (!list.length) return;
    let i = list.findIndex((g) => g.path === selected);
    if (i < 0) i = 0;
    else i = Math.min(list.length - 1, Math.max(0, i + dx + dy * columns()));
    select(list[i].path);
  }

  document.addEventListener('keydown', (e) => {
    if (!$('playing').hidden) return;
    if (e.key === 'Escape' && !$('drawer').hidden) return closeDrawer();
    if (e.target.tagName === 'INPUT' || !$('drawer').hidden || $('library').hidden) return;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (map[e.key]) {
      e.preventDefault();
      move(...map[e.key]);
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault();
      play(selected);
    }
  });

  const padPrev = {};
  function pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const prev = padPrev[p.index] || {};
      const now = {
        a: p.buttons[0] && p.buttons[0].pressed,
        up: (p.buttons[12] && p.buttons[12].pressed) || p.axes[1] < -0.6,
        down: (p.buttons[13] && p.buttons[13].pressed) || p.axes[1] > 0.6,
        left: (p.buttons[14] && p.buttons[14].pressed) || p.axes[0] < -0.6,
        right: (p.buttons[15] && p.buttons[15].pressed) || p.axes[0] > 0.6,
      };
      const active = document.hasFocus() && $('playing').hidden && $('drawer').hidden && !$('library').hidden;
      if (active) {
        if (now.left && !prev.left) move(-1, 0);
        if (now.right && !prev.right) move(1, 0);
        if (now.up && !prev.up) move(0, -1);
        if (now.down && !prev.down) move(0, 1);
        if (now.a && !prev.a && selected) play(selected);
      }
      padPrev[p.index] = now;
    }
    requestAnimationFrame(pollPads);
  }

  // Slow-drifting star field behind everything.
  function stars() {
    const c = $('stars');
    const ctx = c.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pts = [];
    function resize() {
      c.width = innerWidth * devicePixelRatio;
      c.height = innerHeight * devicePixelRatio;
      const n = Math.round((innerWidth * innerHeight) / 5200);
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * c.width,
        y: Math.random() * c.height,
        r: Math.random() * 1.1 + 0.25,
        a: Math.random() * 0.6 + 0.15,
        v: Math.random() * 0.06 + 0.01,
      }));
    }
    function draw() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of pts) {
        if (!reduce) {
          p.x -= p.v * devicePixelRatio;
          if (p.x < 0) p.x = c.width;
        }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = '#c9d2ea';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    addEventListener('resize', () => {
      resize();
      if (reduce) draw();
    });
    resize();
    draw();
  }

  async function boot() {
    stars();
    await refreshStatus();
    games = await api.listGames();
    selected = games[0] ? games[0].path : null;
    render();
    if (status.folders.length) rescan(false);
    requestAnimationFrame(pollPads);
  }

  boot();
})();
