'use strict';

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('traffclip.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('traffclip.' + k, JSON.stringify(v)); } catch (e) { /* private window */ }
  },
};

const keys = store.get('keys', {}); // camera id -> {combo, label}
const clampSecs = (v) => Math.round(Math.min(3600, Math.max(5, +v || 30)));
let replaySecs = clampSecs(store.get('replay', 30));
const favs = new Set(store.get('favs', []));
const state = { merge: store.get('merge', false), favOnly: store.get('favonly', false), list: [], listening: null, max: null };
const HZ = 90000;

const grid = document.getElementById('grid');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cams = window.CAMERAS.map((c, i) => ({ ...c, i, live: null, buf: [], rec: null }));

// Lucide icons (ISC license), inlined to stay dependency-free
const icon = (cls, shapes) => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
const paths = (...ds) => ds.map((d) => `<path d="${d}"/>`).join('');
const ICONS = icon('i-open', paths('M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3')) +
  icon('i-close', paths('M8 3v3a2 2 0 0 1-2 2H3', 'M21 8h-3a2 2 0 0 1-2-2V3', 'M3 16h3a2 2 0 0 1 2 2v3', 'M16 21v-3a2 2 0 0 1 2-2h3'));
const CONNECT_ICONS = icon('i-play', paths('M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z')) +
  icon('i-stop', '<rect width="18" height="18" x="3" y="3" rx="2"/>');
const MERGE_ICON = icon('i-merge', paths('m8 6 4-4 4 4', 'M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22', 'm20 22-5-5'));
const POP_ICON = icon('i-pop', paths('M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4') + '<rect width="10" height="7" x="12" y="13" rx="2"/>');
const STAR_ICON = icon('i-star', paths('M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'));
const CLIP_ICON = icon('i-clip', paths('m12.296 3.464 3.02 3.956', 'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'm6.18 5.276 3.1 3.899'));

grid.innerHTML = cams.map((c) => `
<div class="cell" data-i="${c.i}">
  <button class="x" data-a="close" title="close (Esc)" aria-label="close">×</button>
  <div class="view"><img loading="lazy" alt="" src="images/${esc(c.id)}.jpg"><span class="spin"></span><button class="cn" data-a="conn" title="connect" aria-label="connect">${CONNECT_ICONS}</button><button class="po" data-a="pop" title="open in a window" aria-label="open in a window">${POP_ICON}</button><button class="fs" data-a="fs" title="open large" aria-label="open large">${ICONS}</button></div>
  <div class="name"><button class="star" data-a="fav">${STAR_ICON}</button><span title="${esc(c.name)}">${esc(c.name)}</span></div>
  <div class="meta">${esc(c.region)} · ${esc(c.id)} <span class="st"></span></div>
  <div class="row">
    <button data-a="rec" disabled>rec</button><span class="sw"></span>
    <span class="gap"></span>
    <button data-a="key" title="key that clips this camera">key ${esc(keys[c.id]?.label || '—')}</button>
    <button data-a="clip" class="clip" disabled title="grab the last few seconds">clip</button>
  </div>
</div>`).join('');

for (const el of grid.children) {
  const c = cams[el.dataset.i];
  c.el = el;
  c.view = el.querySelector('.view');
  c.st = el.querySelector('.st');
  c.sw = el.querySelector('.sw');
  c.btn = {};
  for (const b of el.querySelectorAll('[data-a]')) c.btn[b.dataset.a] = b;
}

grid.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') e.target.closest('.view').classList.add('none');
}, true);

grid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const c = cams[cell.dataset.i];
  if (e.target.closest('.fs')) {
    cell.classList.contains('max') ? closeMax(c) : openMax(c);
    return;
  }
  if (e.target.closest('.po')) {
    if (cell.classList.contains('max')) closeMax(c);
    popOut(c);
    return;
  }
  const b = e.target.closest('button');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'conn') toggle(c);
  else if (a === 'rec') c.rec ? stopRec(c) : startRec(c);
  else if (a === 'clip') clip(c);
  else if (a === 'key') listen(state.listening === c.id ? null : c.id);
  else if (a === 'close') closeMax(c);
  else if (a === 'fav') toggleFav(c);
});

function toggle(c) {
  c.live ? disconnect(c) : connect(c);
}

function secsOf() { return replaySecs; }

function sync(c) {
  const on = !!c.live;
  c.el.classList.toggle('on', on);
  c.btn.conn.title = c.btn.conn.ariaLabel = on ? 'disconnect' : 'connect';
  c.btn.rec.disabled = !on;
  c.btn.clip.disabled = !on;
  c.btn.rec.textContent = c.rec ? 'stop' : 'rec';
  c.btn.rec.classList.toggle('on', !!c.rec);
  if (!c.rec) c.sw.textContent = '';
  updateCount();
  renderKeys();
  changed();
}

// letterboxes a camera's current video frame into a canvas (map preview, windows)
function drawVideo(canvas, video) {
  const w = Math.round(canvas.clientWidth * devicePixelRatio);
  const h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (!w || !h || !video.videoWidth) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  const s = Math.min(w / video.videoWidth, h / video.videoHeight);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(video, (w - video.videoWidth * s) / 2, (h - video.videoHeight * s) / 2, video.videoWidth * s, video.videoHeight * s);
}

function changed() {
  document.dispatchEvent(new Event('camchange'));
}

function toggleFav(c) {
  favs.has(c.id) ? favs.delete(c.id) : favs.add(c.id);
  store.set('favs', [...favs]);
  paintFav(c);
  updateFavs();
  renderKeys();
  if (state.favOnly) filter();
  changed();
}

function paintFav(c) {
  const on = favs.has(c.id);
  c.el.classList.toggle('fav', on);
  c.btn.fav.title = c.btn.fav.ariaLabel = on ? 'remove from favorites' : 'add to favorites';
}

function status(c, text, bad) {
  c.status = text;
  c.bad = !!bad;
  if (!c.flashTimer) paint(c);
}

function flash(c, text) {
  clearTimeout(c.flashTimer);
  c.st.textContent = '· ' + text;
  c.st.classList.remove('bad');
  c.flashTimer = setTimeout(() => { c.flashTimer = null; paint(c); }, 3000);
}

function paint(c) {
  c.st.textContent = c.status ? '· ' + c.status : '';
  c.st.classList.toggle('bad', c.bad);
}

function connect(c) {
  if (solo.checked) {
    for (const o of cams) if (o !== c && o.live && !o.rec && !o.win) disconnect(o);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.addEventListener('loadeddata', () => {
    c.view.classList.add('live');
    c.view.classList.remove('loading');
  });
  c.view.classList.add('loading');
  c.view.append(video);
  c.buf = [];
  c.live = new Live(c.url, video, {
    status: (text, bad) => status(c, text, bad),
    samples: (s) => onSamples(c, s),
  });
  sync(c);
}

function disconnect(c) {
  if (c.rec) stopRec(c);
  c.live.stop();
  c.live = null;
  c.buf = [];
  c.view.querySelector('video')?.remove();
  c.view.classList.remove('live', 'loading');
  status(c, '');
  sync(c);
}

function onSamples(c, samples) {
  c.buf.push(...samples);
  if (c.rec) {
    for (const s of samples) {
      if (!c.rec.samples.length && !s.key) continue;
      c.rec.samples.push(s);
    }
  }
  // Keep N seconds behind the frame on screen, cut on a keyframe. Before
  // playback starts, or while a hidden tab pauses the video, only the cap
  // (newest - N - 60 s) applies.
  const n = secsOf() * HZ;
  const shown = c.live.player.playhead();
  let from = c.live.newest - n - 60 * HZ;
  if (shown !== null) from = Math.max(from, shown - n);
  let k = 0;
  for (let i = 0; i < c.buf.length && c.buf[i].dts <= from; i++) if (c.buf[i].key) k = i;
  if (k > 0) c.buf.splice(0, k);
}

// one camera enlarged over the page; a spacer holds its grid slot
const shade = document.getElementById('shade');
shade.onclick = () => state.max && closeMax(state.max);

function openMax(c) {
  if (state.max) closeMax(state.max);
  if (!c.live) connect(c);
  state.max = c;
  c.spacer = document.createElement('div');
  c.spacer.style.height = c.el.offsetHeight + 'px';
  c.el.before(c.spacer);
  c.el.classList.add('max');
  c.btn.fs.title = c.btn.fs.ariaLabel = 'back to grid (Esc)';
  shade.hidden = false;
  document.body.classList.add('maxed');
}

function closeMax(c) {
  c.el.classList.remove('max');
  c.btn.fs.title = c.btn.fs.ariaLabel = 'open large';
  c.spacer?.remove();
  c.spacer = null;
  state.max = null;
  shade.hidden = true;
  document.body.classList.remove('maxed');
}

function clip(c) {
  if (!c.live) return flash(c, 'not connected');
  const end = c.live.playhead();
  const start = end - secsOf() * HZ;
  const buf = c.buf;
  let k = 0;
  for (let i = 0; i < buf.length && buf[i].dts <= start; i++) if (buf[i].key) k = i;
  let e = buf.length;
  while (e > k && buf[e - 1].dts >= end) e--;
  const samples = buf.slice(k, e);
  if (!samples.length) return flash(c, 'nothing buffered yet');
  output(c, { kind: 'clip', cam: c, conn: c.live.id, samples, n0: samples[0].n, n1: samples[samples.length - 1].n, at: new Date() });
}

function startRec(c) {
  if (!c.live) return;
  const ph = c.live.playhead();
  let k = -1;
  for (let i = 0; i < c.buf.length && c.buf[i].dts <= ph; i++) if (c.buf[i].key) k = i;
  if (k < 0) k = c.buf.findIndex((s) => s.key);
  c.rec = { samples: k < 0 ? [] : c.buf.slice(k), t0: Date.now(), at: new Date() };
  sync(c);
  tickClock(c);
}

function stopRec(c) {
  const rec = c.rec;
  c.rec = null;
  sync(c);
  // end on what's on screen, not on video fetched ahead of it
  const end = c.live && c.live.player.playhead();
  let samples = rec.samples;
  if (end !== null && end !== undefined) {
    let e = samples.length;
    while (e > 0 && samples[e - 1].dts >= end) e--;
    samples = samples.slice(0, e);
  }
  if (!samples.length) return flash(c, 'recording empty');
  output(c, { kind: 'rec', cam: c, samples, at: rec.at });
}

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

function tickClock(c) {
  if (c.rec) c.sw.textContent = '● ' + clock(Date.now() - c.rec.t0);
}
Tick.on(() => { for (const c of cams) if (c.rec) tickClock(c); });

function output(c, item) {
  state.list.push(item);
  const entry = plan().find((en) => en.parts.includes(item));
  const s = Math.round(durOf(entry));
  const merges = entry.parts.length - 1;
  if (item.kind === 'clip') floatClip(c, entry.parts.length);
  document.dispatchEvent(new CustomEvent('clipped', { detail: c }));
  if (merges) {
    flash(c, `${s}s`);
    notify(`${c.name}: clip merged (${s}s)`);
  } else {
    flash(c, `${item.kind === 'clip' ? 'clip' : 'recording'} added (${s}s)`);
  }
  updateList();
}

function floatClip(c, joined) {
  const from = c.clipFrom || c.btn.clip;
  c.clipFrom = null;
  const r = from.getBoundingClientRect();
  // under the map the tile's button is covered; the map pulses the camera's dot instead
  if (!r.width || (from === c.btn.clip && document.body.classList.contains('mapped') && !c.el.classList.contains('max'))) return;
  const el = document.createElement('div');
  el.className = 'floater';
  el.innerHTML = `<span class="fbody"><span class="disc">${CLIP_ICON}</span>${joined > 1 ? `<span class="streak">${MERGE_ICON}${joined}</span>` : ''}</span>`;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  el.style.setProperty('--drift', `${Math.round(Math.random() * 40 - 20)}px`);
  el.addEventListener('animationend', (e) => {
    if (e.target === el && e.animationName === 'fade') el.remove();
  });
  document.body.append(el);
}

// List entries = the files that will be saved. With merge on, clips of one
// camera (same connection) that overlap or touch share one entry. The clips
// stay separate in state.list, so turning merge off splits them again.
function plan() {
  const clips = state.list.filter((it) => it.kind === 'clip')
    .sort((a, b) => a.cam.i - b.cam.i || a.conn - b.conn || a.n0 - b.n0);
  const out = [];
  let cur = null;
  for (const it of clips) {
    if (state.merge && cur && cur.cam === it.cam && cur.conn === it.conn && it.n0 <= cur.n1 + 1) {
      cur.parts.push(it);
      cur.n1 = Math.max(cur.n1, it.n1);
    } else {
      cur = { kind: 'clip', cam: it.cam, conn: it.conn, n1: it.n1, at: it.at, parts: [it] };
      out.push(cur);
    }
  }
  for (const it of state.list) {
    if (it.kind !== 'clip') out.push({ kind: it.kind, cam: it.cam, at: it.at, parts: [it] });
  }
  return out.sort((a, b) => a.at - b.at);
}

// one continuous run: each later clip adds only the frames after the last one
function samplesOf(entry) {
  if (entry.parts.length === 1) return entry.parts[0].samples;
  let samples = [];
  let n1 = -Infinity;
  for (const p of entry.parts) {
    samples = samples.concat(p.samples.filter((s) => s.n > n1));
    n1 = Math.max(n1, p.n1);
  }
  return samples;
}

function durOf(entry) {
  let end = 0;
  for (const p of entry.parts) {
    const last = p.samples[p.samples.length - 1];
    end = Math.max(end, last.dts + last.dur);
  }
  return (end - entry.parts[0].samples[0].dts) / HZ;
}

function filesOf(entries) {
  const files = [];
  for (const en of entries) {
    // a mid-stream resolution change needs a new file
    const pieces = [];
    for (const s of samplesOf(en)) {
      const cur = pieces[pieces.length - 1];
      if (cur && cur[0].cfg === s.cfg) cur.push(s);
      else if (s.key) pieces.push([s]);
    }
    const kind = en.parts.length > 1 ? `clip-merged${en.parts.length}` : en.kind;
    const base = [en.cam.id, slug(en.cam.name), stamp(en.at), kind].join('_');
    pieces.forEach((p, i) => files.push({ name: base + (pieces.length > 1 ? '-' + (i + 1) : '') + '.mp4', blob: MP4.file(p) }));
  }
  return files;
}

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

async function downloadAll(files) {
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f.blob);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (files.length > 1) await new Promise((r) => setTimeout(r, 300));
  }
}

const mBox = document.getElementById('merge');
const note = document.getElementById('note');
const qList = document.getElementById('qlist');
const qPanel = document.getElementById('qpanel');
const qItems = document.getElementById('qitems');
const qAll = document.getElementById('qall');
const qClear = document.getElementById('qclear');
const autoRemove = document.getElementById('autoremove');

autoRemove.checked = store.get('autoremove', true);
autoRemove.onchange = () => store.set('autoremove', autoRemove.checked);

function saveEntries(entries = plan()) {
  if (!entries.length) return;
  const files = filesOf(entries);
  const done = new Set(entries.flatMap((en) => en.parts));
  if (autoRemove.checked) state.list = state.list.filter((it) => !done.has(it));
  else done.forEach((it) => { it.saved = true; });
  notify(`saving ${files.length} file${files.length > 1 ? 's' : ''}`);
  downloadAll(files);
  updateList();
}

mBox.checked = state.merge;
mBox.onchange = () => {
  const before = plan().length;
  state.merge = mBox.checked;
  store.set('merge', state.merge);
  const after = plan().length;
  if (after !== before) {
    notify(state.merge ? `overlapping clips merged: ${before} → ${after}` : `clips split apart: ${before} → ${after}`);
  }
  updateList();
};

function updateList() {
  const n = plan().length;
  qList.textContent = `${n} clip${n === 1 ? '' : 's'} ▾`;
  renderList();
}

const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function renderList() {
  if (qPanel.hidden) return;
  const entries = plan();
  qItems.innerHTML = entries.length ? entries.map((en, i) => {
    const what = en.parts.length > 1 ? `${en.parts.length} clips merged` : en.kind === 'clip' ? 'clip' : 'recording';
    const saved = en.parts.every((p) => p.saved) ? ' · saved' : '';
    return `<div class="qrow">
      <span class="qname">${esc(en.cam.name)}<br><span class="meta">${what} · ${clock(Math.round(durOf(en)) * 1000)} · ${timeOf(en.at)}${saved}</span></span>
      <button data-save="${i}" title="download this one">save</button>
      <button data-del="${i}" title="remove from the list" aria-label="remove">×</button>
    </div>`;
  }).join('') : '<p>No clips yet.<br>Clips and recordings show up here.</p>';
  qAll.disabled = qClear.disabled = !entries.length;
}

qItems.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  const en = b && plan()[b.dataset.save ?? b.dataset.del];
  if (!en) return;
  if (b.dataset.save !== undefined) return saveEntries([en]);
  const drop = new Set(en.parts);
  state.list = state.list.filter((it) => !drop.has(it));
  updateList();
});

qAll.onclick = () => saveEntries();

// clearing throws clips away, so it takes a second click
let clearTimer = null;
qClear.onclick = () => {
  clearTimeout(clearTimer);
  if (qClear.dataset.armed) {
    state.list = [];
    disarmClear();
    updateList();
    return;
  }
  qClear.dataset.armed = '1';
  qClear.textContent = 'click again to clear';
  clearTimer = setTimeout(disarmClear, 3000);
};

function disarmClear() {
  delete qClear.dataset.armed;
  qClear.textContent = 'clear';
}
updateList();

const search = document.getElementById('search');
const region = document.getElementById('region');
const regions = [...new Set(cams.map((c) => c.region))];
region.innerHTML = '<option value="">all regions</option>' +
  regions.map((r) => `<option>${esc(r)}</option>`).join('');
search.oninput = region.onchange = filter;

function filter() {
  const q = search.value.trim().toLowerCase();
  for (const c of cams) {
    const hit = (!region.value || c.region === region.value) &&
      (!state.favOnly || favs.has(c.id)) &&
      (!q || `${c.name} ${c.id} ${c.region}`.toLowerCase().includes(q));
    c.el.hidden = !hit;
  }
  updateCount();
  changed();
}

const favBtn = document.getElementById('favs-btn');
favBtn.onclick = () => {
  state.favOnly = !state.favOnly;
  store.set('favonly', state.favOnly);
  updateFavs();
  filter();
};

function updateFavs() {
  favBtn.innerHTML = `${STAR_ICON}${favs.size}`;
  favBtn.classList.toggle('on', state.favOnly);
  favBtn.title = state.favOnly ? 'showing favorites only' : 'show favorites only';
}
cams.forEach(paintFav);
updateFavs();
if (state.favOnly) filter();

function updateCount() {
  const shown = cams.filter((c) => !c.el.hidden).length;
  const live = cams.filter((c) => c.live).length;
  document.getElementById('count').textContent =
    (shown === cams.length ? `${cams.length} cameras` : `${shown} of ${cams.length} cameras`) + (live ? ` · ${live} connected` : '');
}
updateCount();

const MODS = ['Control', 'Alt', 'Shift', 'Meta'];

function comboOf(e) {
  if (!e.key || !e.code || MODS.includes(e.key)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd'].filter(Boolean);
  const name = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : /^Digit\d$/.test(e.code) ? e.code.slice(5)
      : e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : e.code;
  return { combo: [...mods, e.code].join('+'), label: [...mods, name].join('+') };
}

// keys['*'] clips every connected camera; other entries are camera ids.
const panel = document.getElementById('settings');
const keylist = document.getElementById('keylist');
const setBtn = document.getElementById('settings-btn');
const solo = document.getElementById('solo');
solo.checked = store.get('solo', false);
solo.onchange = () => store.set('solo', solo.checked);
const replayBox = document.getElementById('replay');
const tutSecs = document.getElementById('tut-secs');
replayBox.value = tutSecs.textContent = replaySecs;
replayBox.onchange = () => {
  replaySecs = clampSecs(replayBox.value);
  replayBox.value = tutSecs.textContent = replaySecs;
  store.set('replay', replaySecs);
};

const tutorial = document.getElementById('tutorial');
const POPS = [[panel, setBtn], [tutorial, document.getElementById('tutorial-btn')], [qPanel, qList]];
for (const [pop, btn] of POPS) {
  btn.onclick = () => {
    const open = pop.hidden || !btn.classList.contains('on');
    closePops();
    if (!open) return;
    pop.hidden = false;
    btn.classList.add('on');
    renderKeys();
    renderList();
  };
}

function closePops() {
  for (const [pop, btn] of POPS) {
    pop.hidden = true;
    btn.classList.remove('on');
  }
  listen(null);
}

// the key slot (camera id or '*') waiting for a keypress
function listen(id) {
  const prev = state.listening;
  state.listening = id;
  paintKey(prev);
  paintKey(id);
  renderKeys();
}

function paintKey(id) {
  const c = id && id !== '*' && cams.find((x) => x.id === id);
  if (!c) return;
  const on = state.listening === id;
  c.btn.key.classList.toggle('on', on);
  c.btn.key.textContent = on ? 'press a key' : 'key ' + (keys[id]?.label || '—');
}

function renderKeys() {
  if (panel.hidden) return;
  const fav = cams.filter((c) => favs.has(c.id));
  const rows = [{ id: '*', name: 'All connected cameras' }, ...fav, ...cams.filter((c) => !favs.has(c.id) && (c.live || keys[c.id]))];
  keylist.innerHTML = rows.map((r) => {
    const listening = state.listening === r.id;
    const star = favs.has(r.id) ? `<span class="kstar" title="favorite">${STAR_ICON}</span>` : '';
    return `<div class="krow">
      <span class="kname">${star}${esc(r.name)}${r.region ? ` <span class="meta">${esc(r.id)}</span>` : ''}</span>
      <button data-k="${esc(r.id)}" class="${listening ? 'on' : ''}">${listening ? 'press a key' : esc(keys[r.id]?.label || '—')}</button>
      ${keys[r.id] ? `<button data-clear="${esc(r.id)}" title="remove key" aria-label="remove key">×</button>` : '<span class="kx"></span>'}
    </div>`;
  }).join('') + (rows.length > 1 ? '' : '<p>Connect or star a camera to give it its own key.</p>');
}

keylist.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.clear) {
    delete keys[b.dataset.clear];
    store.set('keys', keys);
    paintKey(b.dataset.clear);
    renderKeys();
  } else {
    listen(state.listening === b.dataset.k ? null : b.dataset.k);
  }
});

let noteTimer = null;
function notify(text) {
  clearTimeout(noteTimer);
  note.textContent = text;
  noteTimer = setTimeout(() => { note.textContent = ''; }, 2500);
}

addEventListener('keydown', (e) => {
  const id = state.listening;
  if (id) {
    if (!comboOf(e)) return;
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') delete keys[id];
    else if (e.key !== 'Escape') keys[id] = comboOf(e);
    store.set('keys', keys);
    listen(null);
    return;
  }
  if (e.key === 'Escape') {
    if (POPS.some(([pop]) => !pop.hidden)) return closePops();
    if (state.max) return closeMax(state.max);
  }
  // typing in a field never clips (checkboxes don't count)
  if (e.repeat || e.target.closest?.('input:not([type=checkbox]), select, textarea')) return;
  const k = comboOf(e);
  if (!k) return;
  const all = keys['*']?.combo === k.combo;
  const hit = new Set(all ? cams.filter((c) => c.live) : []);
  for (const cam of cams) if (keys[cam.id]?.combo === k.combo) hit.add(cam);
  if (!hit.size && !all) return;
  e.preventDefault();
  if (!hit.size) return notify('no cameras connected');
  hit.forEach(clip);
});

addEventListener('mousedown', (e) => {
  if (state.listening && !e.target.closest('[data-k], [data-a="key"]')) listen(null);
  if (POPS.some(([pop]) => !pop.hidden) && !e.target.closest('.pop, #settings-btn, #tutorial-btn, #qlist')) closePops();
});

addEventListener('beforeunload', (e) => {
  if (state.list.some((it) => !it.saved) || cams.some((c) => c.rec)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
