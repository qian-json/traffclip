'use strict';
// Anomaly scan. Operators aim and zoom cameras at crashes, chases, and work
// zones, so a camera that is not showing its usual view is worth a look. For
// each camera: take the keyframes of the current segment, median them into a
// 64x48 grayscale image (passing headlights drop out), and compare edge
// directions with the camera's usual view for the current light (refs.js,
// day or night by sun elevation) and with the previous scan. docs.md has the
// measurements behind the constants.

const SCAN_W = 64, SCAN_H = 48;
const SCAN_TOP = 11;          // rows holding the burned-in caption and clock
const SCAN_T = 0.25;          // similarity below this means a different view
const SCAN_MOVED = 0.2;       // below this against the previous scan, call it a fresh change
const SCAN_STRUCTURE = 0.1;   // less edge structure than this (dark, glare, rain) can't be judged
const SCAN_PER_HOST = 4;
const SCAN_EVERY = 10 * 60e3;
const SCAN_KEEP = 3 * 3600e3; // a page load restores saved results younger than this
const scanState = { running: null, results: new Map(), at: null, scanned: 0, offline: 0, unclear: 0, lastEnd: 0, done: 0, total: 0 };

const scanBtn = document.getElementById('scan-btn');
const scanLabel = scanBtn.querySelector('span');
const oddPanel = document.getElementById('oddpanel');
const scanMenu = document.getElementById('scanmenu');
const oddItems = document.getElementById('odd-items');
const oddOnly = document.getElementById('odd-only');
const autoScan = document.getElementById('autoscan');

// ---- storage: per camera, the previous scan and views marked usual; the latest results ----

const scanDb = (() => {
  let db = null;
  const open = () => db || (db = new Promise((res, rej) => {
    const r = indexedDB.open('traffclip', 2);
    r.onupgradeneeded = () => {
      for (const name of ['last', 'usual', 'scan']) {
        if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
      }
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      res(r.result);
    };
    // a tab still running an older version holds the database open
    r.onblocked = () => rej(new Error('blocked'));
    r.onerror = () => rej(r.error);
  }));
  const run = async (store, mode, fn) => {
    try {
      const d = await open();
      return await new Promise((res, rej) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => res(req.result);
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) {
      return undefined; // private windows can refuse storage; the scan still works without memory
    }
  };
  return {
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, key, val) => run(store, 'readwrite', (s) => s.put(val, key)),
  };
})();

// ---- usual views shipped in refs.js (loaded on first scan) ------------------

let refsLoad = null;
function loadRefs() {
  return refsLoad || (refsLoad = new Promise((res) => {
    if (window.REFS) return res(window.REFS);
    const s = document.createElement('script');
    s.src = 'refs.js';
    s.onload = () => res(window.REFS);
    s.onerror = () => res(null);
    document.head.append(s);
  }));
}

const refCache = new Map();
function refFor(regime, id) {
  const key = regime + ' ' + id;
  if (!refCache.has(key)) {
    const b64 = window.REFS?.[regime]?.[id];
    refCache.set(key, b64 ? describe(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))) : null);
  }
  return refCache.get(key);
}

// ---- light: which usual view applies -----------------------------------------

function sunElevation(lat, lon, d) {
  const rad = Math.PI / 180;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const g = 2 * Math.PI / 365 * ((d - start) / 864e5 - 0.5);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
    0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const hour = ((minutes + eqt + 4 * lon) / 4 - 180) * rad;
  const cos = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hour);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

const regionCenter = {};
for (const c of cams) {
  if (c.lat == null) continue;
  const r = (regionCenter[c.region] ??= [0, 0, 0]);
  r[0] += c.lat;
  r[1] += c.lon;
  r[2]++;
}

// day, night, or both around dusk and dawn
function regimes(c, when) {
  const r = regionCenter[c.region];
  const [lat, lon] = c.lat != null ? [c.lat, c.lon] : r ? [r[0] / r[2], r[1] / r[2]] : [31, -91.5];
  const e = sunElevation(lat, lon, when);
  return e > 3 ? ['day'] : e < -3 ? ['night'] : ['day', 'night'];
}

// ---- image comparison ----------------------------------------------------------

// Edge directions with doubled angles (so light-on-dark and dark-on-light match),
// weighted by contrast-normalized strength, ignoring blown-out light and its edges.
function describe(g) {
  const W = SCAN_W, H = SCAN_H, n = W * H;
  const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n), ok = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x > 0 && x < W - 1) gx[i] = g[i + 1] - g[i - 1];
      if (y > 0 && y < H - 1) gy[i] = g[i + W] - g[i - W];
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
  }
  const lit = (i) => g[i] >= 215;
  for (let y = SCAN_TOP; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      ok[i] = !lit(i) && !(y > 0 && lit(i - W)) && !(y < H - 1 && lit(i + W)) &&
        !(x > 0 && lit(i - 1)) && !(x < W - 1 && lit(i + 1)) ? 1 : 0;
    }
  }
  const strong = [];
  for (let i = SCAN_TOP * W; i < n; i++) if (ok[i] && mag[i] > 0) strong.push(mag[i]);
  strong.sort((a, b) => a - b);
  const scale = strong.length ? strong[Math.floor(0.9 * (strong.length - 1))] : 1;
  const c = new Float32Array(n), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const w = Math.min(mag[i] / (scale + 1e-6), 1);
    const d = mag[i] * mag[i] + 1e-6;
    c[i] = (gx[i] * gx[i] - gy[i] * gy[i]) / d * w;
    s[i] = 2 * gx[i] * gy[i] / d * w;
  }
  return { c, s };
}

// best correlation over small shifts, so a camera that wobbles still matches
function similarity(a, b, r = 4) {
  const W = SCAN_W, H = SCAN_H;
  let best = -1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let num = 0, na = 0, nb = 0;
      const y0 = Math.max(SCAN_TOP, SCAN_TOP + dy), y1 = Math.min(H, H + dy);
      const x0 = Math.max(0, dx), x1 = Math.min(W, W + dx);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * W + x, j = (y - dy) * W + (x - dx);
          num += a.c[i] * b.c[j] + a.s[i] * b.s[j];
          na += a.c[i] * a.c[i] + a.s[i] * a.s[i];
          nb += b.c[j] * b.c[j] + b.s[j] * b.s[j];
        }
      }
      best = Math.max(best, num / (Math.sqrt(na * nb) + 1e-6));
    }
  }
  return best;
}

// share of the frame with clear edges that are not headlight or glare halos
function structure(g) {
  const W = SCAN_W, H = SCAN_H;
  const lit = (i) => g[i] >= 215;
  let n = 0;
  for (let y = SCAN_TOP; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (lit(i) || lit(i - 1) || lit(i + 1) || (y > 0 && lit(i - W)) || (y < H - 1 && lit(i + W))) continue;
      const gx = g[i + 1] - g[i - 1], gy = y > 0 && y < H - 1 ? g[i + W] - g[i - W] : 0;
      if (Math.hypot(gx, gy) > 16) n++;
    }
  }
  return n / ((H - SCAN_TOP) * W);
}

function median(frames) {
  const out = new Uint8Array(SCAN_W * SCAN_H);
  const px = new Array(frames.length);
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < frames.length; k++) px[k] = frames[k][i];
    px.sort((a, b) => a - b);
    out[i] = px[frames.length >> 1];
  }
  return out;
}

// ---- one camera ------------------------------------------------------------------

function avcc(parts) {
  let size = 0;
  for (const p of parts) size += 4 + p.length;
  const data = new Uint8Array(size);
  const dv = new DataView(data.buffer);
  let o = 0;
  for (const p of parts) {
    dv.setUint32(o, p.length);
    data.set(p, o + 4);
    o += 4 + p.length;
  }
  return data;
}

async function sampleCamera(c, signal) {
  const get = async (url, headers) => {
    const r = await fetch(url, { cache: 'no-store', signal, headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  };
  const lines = (text) => text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const master = await (await get(c.url)).text();
  if (!master.startsWith('#EXTM3U')) throw new Error('offline');
  let listUrl = c.url, list = master;
  if (master.includes('#EXT-X-STREAM-INF')) {
    listUrl = new URL(lines(master)[0], c.url).href;
    list = await (await get(listUrl)).text();
  }
  const segs = lines(list);
  if (!segs.length) throw new Error('offline');
  const r = await get(new URL(segs[segs.length - 1], listUrl).href);
  const units = new Demux.TS().segment(new Uint8Array(await r.arrayBuffer()));

  let sps = null, pps = null;
  const keys = [];
  for (const u of units) {
    const parts = [];
    let key = false;
    for (const nal of u.nals) {
      const t = nal[0] & 31;
      if (t === 7) sps = nal;
      else if (t === 8) pps = nal;
      else if (t !== 9 && t !== 12) {
        if (t === 5) key = true;
        parts.push(nal);
      }
    }
    if (key && sps && pps) keys.push(parts);
  }
  if (!keys.length) throw new Error('no keyframe');
  const cfg = Demux.config(sps.slice(), pps.slice());

  const canvas = new OffscreenCanvas(SCAN_W, SCAN_H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  const grays = [];
  let thumb = null;
  const dec = new VideoDecoder({
    output(f) {
      ctx.drawImage(f, 0, 0, SCAN_W, SCAN_H);
      const d = ctx.getImageData(0, 0, SCAN_W, SCAN_H).data;
      const g = new Uint8Array(SCAN_W * SCAN_H);
      for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      grays.push(g);
      if (!thumb) thumb = createImageBitmap(f, { resizeWidth: 192, resizeQuality: 'medium' }).finally(() => f.close());
      else f.close();
    },
    error() {},
  });
  dec.configure({ codec: cfg.codec, description: MP4.avcC(cfg), optimizeForLatency: true });
  keys.forEach((parts, i) => dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: i * 1e6, data: avcc(parts) })));
  try {
    await dec.flush();
  } finally {
    if (dec.state !== 'closed') dec.close();
  }
  if (!grays.length) throw new Error('decode failed');
  return { gray: median(grays), thumb: await thumb };
}

async function judge(c, gray, when) {
  if (structure(gray) < SCAN_STRUCTURE) return { unclear: true };
  const cur = describe(gray);
  const light = regimes(c, when);
  const usual = light.map((r) => refFor(r, c.id)).filter(Boolean);
  for (const u of (await scanDb.get('usual', c.id)) || []) {
    if (light.includes(u.regime)) usual.push(describe(u.gray));
  }
  const last = await scanDb.get('last', c.id);
  await scanDb.put('last', c.id, { t: when.getTime(), light, gray });

  const home = usual.length ? Math.max(...usual.map((u) => similarity(cur, u))) : null;
  const recent = last && when - last.t < 3 * 3600e3 && last.light.some((r) => light.includes(r));
  const prev = recent ? similarity(cur, describe(last.gray)) : null;
  const off = home !== null ? home < SCAN_T : prev !== null && prev < SCAN_T;
  if (!off) return null;
  const moved = prev !== null && prev < SCAN_MOVED;
  return { home, moved, light, gray, reason: moved ? 'moved since last scan' : 'off its usual view' };
}

// ---- running a scan --------------------------------------------------------------

async function runScan(quiet) {
  if (scanState.running) {
    scanState.running.abort();
    return;
  }
  const ctl = new AbortController();
  ctl.quiet = quiet;
  scanState.running = ctl;
  // "show only these" narrows the grid, not what gets scanned
  const list = cams.filter((c) => shows(c, false));
  const results = new Map();
  let done = 0, offline = 0, unclear = 0;
  const when = new Date();
  scanState.total = list.length;
  const show = () => {
    scanState.done = done;
    scanLabel.textContent = `Scanning ${Math.round(100 * done / list.length)}%`;
    renderScanMenu();
  };
  show();
  if (!(await loadRefs())) notify('refs.js is missing, so only changes since the last scan count');

  const hosts = {};
  for (const c of list) (hosts[new URL(c.url).host] ??= []).push(c);
  const worker = async (queue) => {
    while (queue.length && !ctl.signal.aborted) {
      const c = queue.shift();
      try {
        const s = await sampleCamera(c, ctl.signal);
        const r = await judge(c, s.gray, when);
        if (r?.unclear) unclear++;
        if (r && !r.unclear) results.set(c, { ...r, thumb: s.thumb });
        else s.thumb?.close();
      } catch (e) {
        if (!ctl.signal.aborted) offline++;
      }
      done++;
      show();
    }
  };
  await Promise.all(Object.values(hosts).flatMap((q) => Array.from({ length: SCAN_PER_HOST }, () => worker(q))));
  scanState.running = null;
  scanState.lastEnd = Date.now();
  if (ctl.signal.aborted) {
    for (const r of results.values()) r.thumb?.close();
    notify('Scan stopped');
    paintScanBtn();
    return;
  }
  for (const r of scanState.results.values()) r.thumb?.close();
  scanState.results = new Map([...results].sort(([, a], [, b]) => (a.home ?? 0) - (b.home ?? 0)));
  scanState.at = when;
  scanState.scanned = list.length - offline;
  scanState.offline = offline;
  scanState.unclear = unclear;
  notify(`${scanState.results.size} unusual of ${scanState.scanned} scanned`);
  showResults();
  saveScan();
  if (!ctl.quiet && scanState.results.size && oddPanel.hidden) togglePop(oddPanel, scanBtn, renderOdd);
}

function showResults() {
  for (const c of cams) setOdd(c, scanState.results.has(c));
  paintScanBtn();
  renderScanMenu();
  if (state.oddOnly) filter();
  changed();
  renderOdd();
}

// ---- cache: the latest results survive a reload ------------------------------------

let saving = Promise.resolve();
function saveScan() {
  saving = saving.then(async () => {
    const { results, at, lastEnd, scanned, offline, unclear } = scanState;
    const rows = [];
    for (const [c, r] of results) {
      r.jpeg ??= await toJpeg(r.thumb);
      rows.push({ id: c.id, home: r.home, moved: r.moved, light: r.light, gray: r.gray, reason: r.reason, jpeg: r.jpeg });
    }
    await scanDb.put('scan', 'latest', { at: at.getTime(), end: lastEnd, scanned, offline, unclear, results: rows });
  });
}

async function toJpeg(bitmap) {
  try {
    const cv = new OffscreenCanvas(bitmap.width, bitmap.height);
    cv.getContext('2d').drawImage(bitmap, 0, 0);
    return await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } catch (e) {
    return null; // no thumbnail, or one already closed
  }
}

async function restoreScan() {
  const saved = await scanDb.get('scan', 'latest');
  if (!saved || Date.now() - saved.at > SCAN_KEEP) return;
  const byId = new Map(cams.map((c) => [c.id, c]));
  const results = new Map();
  for (const { id, ...r } of saved.results) {
    const c = byId.get(id);
    if (!c) continue;
    r.thumb = r.jpeg && await createImageBitmap(r.jpeg).catch(() => null);
    results.set(c, r);
  }
  // a scan that finished meanwhile is newer
  if (scanState.at) {
    for (const r of results.values()) r.thumb?.close();
    return;
  }
  Object.assign(scanState, { results, at: new Date(saved.at), lastEnd: saved.end, scanned: saved.scanned, offline: saved.offline, unclear: saved.unclear });
  showResults();
}

function setOdd(c, on) {
  c.odd = on;
  c.el.classList.toggle('odd', on);
  c.view.title = on ? `Unusual: ${scanState.results.get(c)?.reason}` : '';
}

const hm = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function ago(d) {
  const m = Math.floor((Date.now() - d) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

function paintScanBtn() {
  if (scanState.running) return;
  const at = scanState.at;
  scanLabel.textContent = at ? `${scanState.results.size} unusual` : 'Scan';
  scanBtn.classList.toggle('found', scanState.results.size > 0);
}

function paintAge() {
  const el = document.getElementById('odd-age');
  const text = scanState.at ? `${hm(scanState.at)} · ${ago(scanState.at)}` : '';
  if (el.textContent !== text) el.textContent = text;
}

function renderOdd() {
  if (oddPanel.hidden) return;
  const at = scanState.at;
  document.getElementById('odd-title').textContent = at ? `${scanState.results.size} unusual` : 'Scan';
  paintAge();
  oddItems.innerHTML = '';
  for (const [c, r] of scanState.results) {
    const row = document.createElement('div');
    row.className = 'orow';
    row.dataset.i = c.i;
    const pct = r.home !== null ? ` · ${Math.max(0, Math.round(r.home * 100))}% match` : '';
    row.innerHTML = `<canvas class="othumb"></canvas><div class="oinfo"><div class="oname">${esc(c.name)}</div>` +
      `<div class="meta">${esc(c.region)} · ${r.reason}${pct}</div>` +
      '<div class="obtns"><button class="sm" data-o="open">Open</button><button class="sm" data-o="pop">Window</button>' +
      '<button class="sm" data-o="usual" title="Stop flagging this camera">Mark usual</button></div></div>';
    const cv = row.querySelector('canvas');
    if (r.thumb) {
      cv.width = r.thumb.width;
      cv.height = r.thumb.height;
      cv.getContext('2d').drawImage(r.thumb, 0, 0);
    }
    oddItems.append(row);
  }
  if (!scanState.results.size) {
    oddItems.innerHTML = '<p>Every scanned camera shows its usual view.</p>';
  }
  document.getElementById('odd-note').textContent = at
    ? `${scanState.scanned} scanned${scanState.offline ? `, ${scanState.offline} offline` : ''}${scanState.unclear ? `, ${scanState.unclear} too dark to judge` : ''}.`
    : '';
}

oddItems.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const c = cams[b.closest('.orow').dataset.i];
  const r = scanState.results.get(c);
  if (b.dataset.o === 'open') openMax(c);
  else if (b.dataset.o === 'pop') popOut(c);
  else if (b.dataset.o === 'usual') {
    b.disabled = true;
    const list = (await scanDb.get('usual', c.id)) || [];
    for (const regime of r.light) list.push({ regime, gray: r.gray });
    await scanDb.put('usual', c.id, list.slice(-6));
    r.thumb?.close();
    scanState.results.delete(c);
    setOdd(c, false);
    paintScanBtn();
    if (state.oddOnly) filter();
    changed();
    renderOdd();
    saveScan();
  }
});

// ---- the scan button's menu: start or stop, progress, and the last scan's numbers ----

function renderScanMenu() {
  if (scanMenu.hidden) return;
  const { running, at, results } = scanState;
  const pct = scanState.total ? Math.round(100 * scanState.done / scanState.total) : 0;
  document.getElementById('scan-age').textContent = at ? `${hm(at)} · ${ago(at)}` : running ? '' : 'not run yet';
  document.getElementById('scan-progress').hidden = !running;
  scanMenu.querySelector('.bar i').style.width = `${pct}%`;
  document.getElementById('scan-pct').textContent = `${pct}% · ${scanState.done} of ${scanState.total}`;
  const stat = (label, n, cls = '') => `<span>${label}</span><b class="${cls}">${n}</b>`;
  document.getElementById('scan-stats').innerHTML = at
    ? stat('Unusual', results.size, results.size ? 'amber' : '') + stat('Scanned', scanState.scanned) +
      stat('Offline', scanState.offline) + stat('Too dark', scanState.unclear)
    : '';
  const n = cams.filter((c) => shows(c, false)).length;
  document.getElementById('scan-scope').textContent = running ? '' : `Checks the ${n} cameras on screen, about ${Math.round(n * 0.3)} MB.`;
  const go = document.getElementById('scan-go');
  go.textContent = running ? 'Stop' : at ? 'Scan again' : 'Start scan';
  const view = document.getElementById('scan-view');
  view.hidden = running || !results.size;
  view.textContent = `View ${results.size} unusual`;
}

POPS.push([scanMenu, scanBtn, renderScanMenu], [oddPanel, scanBtn, renderOdd]);
STICKY.add(scanMenu).add(oddPanel);
scanBtn.onclick = () => togglePop(scanMenu, scanBtn, renderScanMenu);
document.getElementById('scan-go').onclick = () => runScan(false);
document.getElementById('scan-view').onclick = () => togglePop(oddPanel, scanBtn, renderOdd);

document.getElementById('odd-rescan').onclick = () => {
  togglePop(scanMenu, scanBtn, renderScanMenu);
  // an auto-scan already under way keeps going and reports back when done
  if (scanState.running) scanState.running.quiet = false;
  else runScan(false);
};

oddOnly.checked = false;
oddOnly.onchange = () => {
  state.oddOnly = oddOnly.checked;
  filter();
};

paintScanBtn();
let restored = false;
restoreScan().finally(() => { restored = true; });

autoScan.checked = store.get('autoscan', false);
autoScan.onchange = () => store.set('autoscan', autoScan.checked);
Tick.on(() => {
  if (!oddPanel.hidden) paintAge();
  if (!scanMenu.hidden && !scanState.running) renderScanMenu();
  // auto-scan counts from a restored scan too, so a reload doesn't trigger one
  if (autoScan.checked && restored && !scanState.running && Date.now() - scanState.lastEnd > SCAN_EVERY) runScan(true);
});
