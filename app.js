'use strict';

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('traffclip.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('traffclip.' + k, JSON.stringify(v)); } catch (e) { /* private window */ }
  },
};

const keys = store.get('keys', {}); // camera id, or '*' for every connected camera -> {combo, label}
const clampSecs = (v) => Math.round(Math.min(3600, Math.max(5, +v || 30)));
let replaySecs = clampSecs(store.get('replay', 30));
const favs = new Set(store.get('favs', []));
const state = { merge: store.get('merge', false), favOnly: store.get('favonly', false), oddOnly: false, list: [], listening: null, max: null };
const HZ = 90000;

const grid = document.getElementById('grid');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cams = window.CAMERAS.map((c, i) => ({ ...c, i, live: null, buf: [], rec: null }));

// Lucide icons (ISC license), inlined to stay dependency-free
const icon = (shapes, cls) => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
const paths = (...ds) => ds.map((d) => `<path d="${d}"/>`).join('');
const ICON = {
  expand: icon(paths('M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'), 'i-open'),
  collapse: icon(paths('M8 3v3a2 2 0 0 1-2 2H3', 'M21 8h-3a2 2 0 0 1-2-2V3', 'M3 16h3a2 2 0 0 1 2 2v3', 'M16 21v-3a2 2 0 0 1 2-2h3'), 'i-close'),
  locate: icon(paths('M2 12h3', 'M19 12h3', 'M12 2v3', 'M12 19v3') + '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>'),
  play: icon(paths('M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'), 'i-play'),
  stop: icon('<rect width="18" height="18" x="3" y="3" rx="2"/>', 'i-stop'),
  merge: icon(paths('m8 6 4-4 4 4', 'M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22', 'm20 22-5-5')),
  pop: icon(paths('M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4') + '<rect width="10" height="7" x="12" y="13" rx="2"/>'),
  star: icon(paths('M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'), 'i-star'),
  clip: icon(paths('m12.296 3.464 3.02 3.956', 'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'm6.18 5.276 3.1 3.899')),
  search: icon(paths('m21 21-4.34-4.34') + '<circle cx="11" cy="11" r="8"/>'),
  grid: icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
  map: icon(paths('M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z', 'M15 5.764v15', 'M9 3.236v15')),
  cctv: icon(paths('M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97', 'M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z', 'M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15', 'M2 21v-4', 'M7 9h.01')),
  binoculars: icon(paths('M10 10h4', 'M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3', 'M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z', 'M22 16H2', 'M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z', 'M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3')),
  help: icon('<circle cx="12" cy="12" r="10"/>' + paths('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01')),
  settings: icon(paths('M14 17H5', 'M19 7h-9') + '<circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
  download: icon(paths('M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5')),
  x: icon(paths('M18 6 6 18', 'm6 6 12 12')),
  chevron: icon(paths('m6 9 6 6 6-6')),
  plus: icon(paths('M5 12h14', 'M12 5v14')),
  minus: icon(paths('M5 12h14')),
};
for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]);

const REC_IDLE = '<i></i>';
const REC_ON = ICON.stop;

grid.innerHTML = cams.map((c) => `
<div class="cell" data-i="${c.i}">
  <div class="view"><img loading="lazy" alt="" src="images/${esc(c.id)}.jpg"><span class="spin"></span>
    <button class="play" data-a="conn" title="Play" aria-label="Play ${esc(c.name)}">${ICON.play}</button>
    <span class="chips"><span class="chip rec">REC <span class="sw"></span></span><span class="chip odd">UNUSUAL</span></span>
    <span class="ctl"><button data-a="stop" title="Stop watching" aria-label="Stop watching">${ICON.stop}</button><button data-a="pop" title="Open in a window" aria-label="Open in a window">${ICON.pop}</button><button data-a="fs" title="Open large" aria-label="Open large">${ICON.expand}${ICON.collapse}</button></span>
  </div>
  <div class="info">
    <button class="star" data-a="fav">${ICON.star}</button>
    <span class="label"><span class="nm" title="${esc(c.name)}">${esc(c.name)}</span><span class="rg">${esc(c.region)}<span class="st"></span></span></span>
    <span class="acts"><button class="rec" data-a="rec">${REC_IDLE}</button><button class="clip" data-a="clip" aria-label="Clip">${ICON.clip}<span class="secs"></span><kbd>${esc(keys[c.id]?.label || '')}</kbd></button></span>
  </div>
  <button class="x" data-a="close" title="Back to the grid (Esc)" aria-label="Close">${ICON.x}</button>
</div>`).join('');

for (const el of grid.children) {
  const c = cams[el.dataset.i];
  c.el = el;
  c.view = el.querySelector('.view');
  c.st = el.querySelector('.st');
  c.sw = el.querySelector('.sw');
  c.kbd = el.querySelector('.clip kbd');
  c.secs = el.querySelector('.secs');
  c.btn = {};
  for (const b of el.querySelectorAll('[data-a]')) c.btn[b.dataset.a] = b;
}

const head = document.getElementById('grid-head');
const liveBtn = document.getElementById('live-btn');
const livePanel = document.getElementById('livepanel');
const liveItems = document.getElementById('live-items');

grid.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') e.target.closest('.view').classList.add('none');
}, true);

grid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const c = cams[cell.dataset.i];
  const a = e.target.closest('button')?.dataset.a;
  if (a === 'fs') state.max === c ? closeMax(c) : openMax(c);
  else if (a === 'pop') {
    if (state.max === c) closeMax(c);
    popOut(c);
  } else if (a === 'conn' || (!a && !c.live && e.target.closest('.view'))) c.live || connect(c);
  else if (a === 'stop') c.live && disconnect(c);
  else if (a === 'rec') c.rec ? stopRec(c) : startRec(c);
  else if (a === 'clip') clip(c, c.btn.clip);
  else if (a === 'close') closeMax(c);
  else if (a === 'fav') toggleFav(c);
});

function toggle(c) {
  c.live ? disconnect(c) : connect(c);
}

function sync(c) {
  c.el.classList.toggle('on', !!c.live);
  c.el.classList.toggle('rec', !!c.rec);
  c.btn.rec.innerHTML = c.rec ? REC_ON : REC_IDLE;
  c.btn.rec.title = c.btn.rec.ariaLabel = c.rec ? 'Stop recording' : 'Record';
  if (!c.rec) c.sw.textContent = '';
  updateHeads();
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
  renderKeys();
  if (state.favOnly) filter();
  changed();
}

function paintFav(c) {
  const on = favs.has(c.id);
  c.el.classList.toggle('fav', on);
  c.btn.fav.title = c.btn.fav.ariaLabel = on ? 'Remove from favorites' : 'Add to favorites';
}

// connection trouble shows after the region; 'live' needs no words, the chip says it
function status(c, text, bad) {
  c.st.textContent = text && text !== 'live' ? ' · ' + text : '';
  c.st.classList.toggle('bad', !!bad);
}

function connect(c) {
  if (solo.checked) {
    for (const o of cams) if (o !== c && o.live && !o.rec && !o.win) disconnect(o);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  // reveal on 'playing', not 'loadeddata': the first decoded frame sits still
  // until the player jumps to the live edge and starts
  video.addEventListener('playing', () => {
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
  const n = replaySecs * HZ;
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
  // a filtered-out tile has no slot to hold
  if (!c.el.hidden) {
    c.spacer = document.createElement('div');
    c.spacer.style.height = c.el.offsetHeight + 'px';
    c.el.before(c.spacer);
  }
  c.el.classList.add('max');
  c.btn.fs.title = c.btn.fs.ariaLabel = 'Back to the grid (Esc)';
  shade.hidden = false;
  document.body.classList.add('maxed');
}

function closeMax(c) {
  c.el.classList.remove('max');
  c.btn.fs.title = c.btn.fs.ariaLabel = 'Open large';
  c.spacer?.remove();
  c.spacer = null;
  state.max = null;
  shade.hidden = true;
  document.body.classList.remove('maxed');
}

// from: the clip button the badge floats up from; key presses use the window's when one is open
function clip(c, from = state.max !== c && c.win ? c.win.clipBtn : c.btn.clip) {
  if (!c.live) return notify(`${c.name} isn't playing`);
  const end = c.live.playhead();
  const start = end - replaySecs * HZ;
  const buf = c.buf;
  let k = 0;
  for (let i = 0; i < buf.length && buf[i].dts <= start; i++) if (buf[i].key) k = i;
  let e = buf.length;
  while (e > k && buf[e - 1].dts >= end) e--;
  const samples = buf.slice(k, e);
  if (!samples.length) return notify('Nothing to clip yet');
  output(c, { kind: 'clip', cam: c, conn: c.live.id, samples, n0: samples[0].n, n1: samples[samples.length - 1].n, at: new Date() }, from);
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
  const end = c.live?.player.playhead();
  let samples = rec.samples;
  if (end != null) {
    let e = samples.length;
    while (e > 0 && samples[e - 1].dts >= end) e--;
    samples = samples.slice(0, e);
  }
  if (!samples.length) return notify('The recording was empty');
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
  if (c.rec) c.sw.textContent = clock(Date.now() - c.rec.t0);
}
Tick.on(() => { for (const c of cams) if (c.rec) tickClock(c); });

function output(c, item, from) {
  state.list.push(item);
  const entry = plan().find((en) => en.parts.includes(item));
  const len = clock(Math.round(durOf(entry)) * 1000);
  if (from) floatClip(c, from, entry.parts.length);
  document.dispatchEvent(new CustomEvent('clipped', { detail: c }));
  if (entry.parts.length > 1) notify(`Merged ${entry.parts.length} clips · ${len}`);
  else if (item.kind === 'rec') notify(`Recording added · ${len}`);
  updateList();
}

function floatClip(c, from, joined) {
  const r = from.getBoundingClientRect();
  // under the map the tile's button is covered; the map pulses the camera's dot instead
  if (!r.width || (from === c.btn.clip && document.body.classList.contains('mapped') && !c.el.classList.contains('max'))) return;
  const el = document.createElement('div');
  el.className = 'floater';
  el.innerHTML = `<span class="fbody"><span class="disc">${ICON.clip}</span>${joined > 1 ? `<span class="streak">${ICON.merge}${joined}</span>` : ''}</span>`;
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
const qList = document.getElementById('qlist');
const qBadge = qList.querySelector('.badge');
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
  notify(`Saving ${files.length} file${files.length > 1 ? 's' : ''}`);
  downloadAll(files);
  updateList();
}

mBox.checked = state.merge;
mBox.onchange = () => {
  const before = plan().length;
  state.merge = mBox.checked;
  store.set('merge', state.merge);
  const after = plan().length;
  if (after !== before) notify(`${state.merge ? 'Merged' : 'Split'} clips: ${before} → ${after}`);
  updateList();
};

function updateList() {
  const n = plan().length;
  qBadge.textContent = n;
  qBadge.hidden = !n;
  qList.title = n ? `${n} clip${n === 1 ? '' : 's'} to save` : 'Clips and recordings';
  renderList();
}

const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function renderList() {
  if (qPanel.hidden) return;
  const entries = plan();
  qItems.innerHTML = entries.length ? entries.map((en, i) => {
    const what = en.parts.length > 1 ? `${ICON.merge}${en.parts.length} clips merged` : en.kind === 'clip' ? 'Clip' : 'Recording';
    const saved = en.parts.every((p) => p.saved) ? ' · saved' : '';
    return `<div class="qrow">
      <img src="images/${esc(en.cam.id)}.jpg" alt="">
      <span class="qname"><span>${esc(en.cam.name)}</span><small>${what} · ${clock(Math.round(durOf(en)) * 1000)} · ${timeOf(en.at)}${saved}</small></span>
      <button class="ic" data-save="${i}" title="Save" aria-label="Save">${ICON.download}</button>
      <button class="ic" data-del="${i}" title="Remove" aria-label="Remove">${ICON.x}</button>
    </div>`;
  }).join('') : '<p>No clips yet.</p>';
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
  qClear.textContent = 'Click again to clear';
  clearTimer = setTimeout(disarmClear, 3000);
};

function disarmClear() {
  delete qClear.dataset.armed;
  qClear.textContent = 'Clear';
}
updateList();

const search = document.getElementById('search');
search.placeholder = `Search ${cams.length} cameras`;
search.oninput = filter;

// region picker: a button holding the value plus a listbox of regions with their camera counts
const region = document.getElementById('region');
const regionList = document.getElementById('region-list');
regionList.innerHTML = ['', ...new Set(cams.map((c) => c.region).sort())].map((r) =>
  `<button type="button" role="option" data-v="${esc(r)}"><span>${esc(r || 'All regions')}</span><span class="n">${cams.filter((c) => !r || c.region === r).length}</span></button>`).join('');

function setRegion(v) {
  region.value = v;
  region.firstElementChild.textContent = v || 'All regions';
  for (const o of regionList.children) o.setAttribute('aria-selected', o.dataset.v === v);
}
setRegion('');

regionList.addEventListener('click', (e) => {
  const o = e.target.closest('[role=option]');
  if (!o) return;
  closePops();
  if (o.dataset.v === region.value) return;
  setRegion(o.dataset.v);
  filter();
  region.dispatchEvent(new Event('change'));
});

// arrows, Home/End, and type-ahead; stopping propagation keeps letters from firing clip keys
regionList.addEventListener('keydown', (e) => {
  const opts = [...regionList.children];
  const i = opts.indexOf(document.activeElement);
  const starts = (o) => o.textContent.toLowerCase().startsWith(e.key.toLowerCase());
  let to;
  if (e.key === 'ArrowDown') to = opts[Math.min(i + 1, opts.length - 1)];
  else if (e.key === 'ArrowUp') to = opts[Math.max(i - 1, 0)];
  else if (e.key === 'Home') to = opts[0];
  else if (e.key === 'End') to = opts[opts.length - 1];
  else if (e.key.length === 1 && e.key !== ' ') to = opts.find((o, j) => j > i && starts(o)) || opts.find(starts);
  else return;
  e.preventDefault();
  e.stopPropagation();
  to?.focus();
});

function shows(c, odd = state.oddOnly) {
  const q = search.value.trim().toLowerCase();
  return (!region.value || c.region === region.value) &&
    (!state.favOnly || favs.has(c.id)) &&
    (!odd || c.odd) &&
    (!q || `${c.name} ${c.id} ${c.region}`.toLowerCase().includes(q));
}

function filter() {
  for (const c of cams) c.el.hidden = !shows(c);
  updateHeads();
  changed();
}

function clearFilters() {
  search.value = '';
  setRegion('');
  setFavOnly(false);
  state.oddOnly = document.getElementById('odd-only').checked = false;
  filter();
}

// leaving the favorites filter returns to where the full grid was scrolled
const favBtn = document.getElementById('favs-btn');
let gridScroll = 0;
favBtn.onclick = () => {
  if (!state.favOnly) gridScroll = scrollY;
  setFavOnly(!state.favOnly);
  filter();
  scrollTo(0, state.favOnly ? 0 : gridScroll);
};

function setFavOnly(on) {
  state.favOnly = on;
  store.set('favonly', on);
  updateFavs();
}

function updateFavs() {
  favBtn.classList.toggle('on', state.favOnly);
  favBtn.setAttribute('aria-pressed', state.favOnly);
  favBtn.title = favBtn.ariaLabel = state.favOnly ? 'Showing favorites only' : 'Show favorites only';
}

function updateHeads() {
  const shown = cams.filter((c) => !c.el.hidden).length;
  const live = cams.filter((c) => c.live).length;
  head.querySelector('h2').textContent = !shown ? 'No cameras match' : state.favOnly ? 'Favorites' : 'All cameras';
  head.querySelector('.n').textContent = shown || '';
  const badge = liveBtn.querySelector('.badge');
  badge.textContent = live;
  badge.hidden = !live;
  renderLive();
}

// ---- playing cameras: the header's Live menu -----------------------------------

let liveFrame = 0;
function renderLive() {
  if (livePanel.hidden) return;
  const on = cams.filter((c) => c.live);
  document.getElementById('live-stop').disabled = !on.length;
  if (!on.length) {
    liveItems.innerHTML = '<p>Nothing is playing.</p>';
    return;
  }
  liveItems.innerHTML = on.map((c) => `<div class="lrow" data-i="${c.i}">
    <span class="lthumb"><img src="images/${esc(c.id)}.jpg" alt=""><canvas></canvas></span>
    <span class="qname"><span>${esc(c.name)}</span><small></small></span>
    <button class="ic" data-l="find" title="Find on the page" aria-label="Find ${esc(c.name)}">${ICON.locate}</button>
    <button class="ic" data-l="max" title="Open large" aria-label="Open ${esc(c.name)} large">${ICON.expand}</button>
    <button class="ic" data-l="pop" title="Open in a window" aria-label="Open ${esc(c.name)} in a window">${ICON.pop}</button>
    <button class="ic stop" data-l="stop" title="Stop watching" aria-label="Stop ${esc(c.name)}">${ICON.stop}</button>
  </div>`).join('');
  if (!liveFrame) liveFrame = requestAnimationFrame(drawLive);
}

// live thumbnails and status, mirrored from each tile's own video like the windows
function drawLive() {
  liveFrame = 0;
  const rows = liveItems.querySelectorAll('.lrow');
  if (livePanel.hidden || !rows.length) return;
  for (const row of rows) {
    const c = cams[row.dataset.i];
    const video = c.view.classList.contains('live') ? c.view.querySelector('video') : null;
    row.classList.toggle('on', !!video);
    if (video) drawVideo(row.querySelector('canvas'), video);
    const status = c.region + (c.rec ? ` · rec ${clock(Date.now() - c.rec.t0)}` : '') + c.st.textContent;
    const small = row.querySelector('small');
    if (small.textContent !== status) small.textContent = status;
    small.classList.toggle('bad', !!c.rec || c.st.classList.contains('bad'));
  }
  liveFrame = requestAnimationFrame(drawLive);
}

liveItems.addEventListener('click', (e) => {
  const b = e.target.closest('[data-l]');
  if (!b) return;
  const c = cams[b.closest('.lrow').dataset.i];
  const a = b.dataset.l;
  if (a === 'stop') return c.live && disconnect(c);
  if (a === 'find') jumpTo(c);
  else if (a === 'max') openMax(c);
  else popOut(c);
});

document.getElementById('live-stop').onclick = () => {
  for (const c of cams) if (c.live) disconnect(c);
};

cams.forEach(paintFav);
updateFavs();
// also applies a search the browser restored on reload
filter();


const MODS = ['Control', 'Alt', 'Shift', 'Meta'];

function comboOf(e) {
  if (!e.key || !e.code || MODS.includes(e.key)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd'].filter(Boolean);
  const name = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : /^Digit\d$/.test(e.code) ? e.code.slice(5)
      : e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : e.code;
  return { combo: [...mods, e.code].join('+'), label: [...mods, name].join('+') };
}

const panel = document.getElementById('settings');
const keylist = document.getElementById('keylist');
const setBtn = document.getElementById('settings-btn');
const solo = document.getElementById('solo');
solo.checked = store.get('solo', false);
solo.onchange = () => store.set('solo', solo.checked);
const replayBox = document.getElementById('replay');
replayBox.onchange = () => {
  replaySecs = clampSecs(replayBox.value);
  store.set('replay', replaySecs);
  paintSecs();
};

function paintSecs() {
  replayBox.value = replaySecs;
  for (const el of document.querySelectorAll('.n-secs')) el.textContent = replaySecs;
  for (const c of cams) {
    c.btn.clip.title = `Clip the last ${replaySecs} seconds`;
    c.secs.textContent = `Last ${replaySecs} s`;
  }
}
paintSecs();

// header popovers: [panel, button, render]; scan.js adds its own
const POPS = [[panel, setBtn, renderKeys], [document.getElementById('tutorial'), document.getElementById('tutorial-btn')],
  [qPanel, qList, renderList]];
POPS.push([regionList, region, () => regionList.querySelector('[aria-selected=true]').focus()], [livePanel, liveBtn, renderLive]);
for (const [pop, btn, render] of POPS) btn.onclick = () => togglePop(pop, btn, render);
region.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && regionList.hidden) {
    e.preventDefault();
    togglePop(regionList, region, POPS.find(([p]) => p === regionList)[2]);
  }
});

// camera panels stay open while you play, pop out, or enlarge cameras; scan.js adds its own
const STICKY = new Set([qPanel, livePanel]);

function togglePop(pop, btn, render) {
  const open = pop.hidden;
  closePops();
  if (!open) return;
  pop.hidden = false;
  btn.classList.add('on');
  btn.setAttribute('aria-expanded', true);
  render?.();
}

function closePops() {
  for (const [pop, btn] of POPS) {
    // focus inside a closing popover goes back to its button
    if (!pop.hidden && pop.contains(document.activeElement)) btn.focus();
    pop.hidden = true;
    btn.classList.remove('on');
    btn.setAttribute('aria-expanded', false);
  }
  listen(null);
}

// the key slot (camera id or '*') waiting for a keypress
function listen(id) {
  const prev = state.listening;
  state.listening = id;
  paintKey(prev);
  renderKeys();
}

function paintKey(id) {
  const c = id && id !== '*' && cams.find((x) => x.id === id);
  if (c) c.kbd.textContent = keys[id]?.label || '';
}

function renderKeys() {
  if (panel.hidden) return;
  const fav = cams.filter((c) => favs.has(c.id));
  const rows = [{ id: '*', name: 'All live cameras' }, ...fav, ...cams.filter((c) => !favs.has(c.id) && (c.live || keys[c.id]))];
  keylist.innerHTML = rows.map((r) => {
    const listening = state.listening === r.id;
    const star = favs.has(r.id) ? `<span class="kstar" title="Favorite">${ICON.star}</span>` : '';
    return `<div class="krow">
      <span class="kname">${star}<span>${esc(r.name)}</span></span>
      <button data-k="${esc(r.id)}" class="kbd${listening ? ' on' : ''}${keys[r.id] ? '' : ' unset'}">${listening ? 'press a key' : esc(keys[r.id]?.label || '—')}</button>
    </div>`;
  }).join('') + (rows.length > 1 ? '' : '<p>Play or star a camera to give it a key.</p>');
}

keylist.addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]');
  if (b) listen(state.listening === b.dataset.k ? null : b.dataset.k);
});

const toast = document.getElementById('toast');
let toastTimer = null;
function notify(text) {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
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
    // the large view covers the popovers, so it closes first
    if (state.max) return closeMax(state.max);
    if (POPS.some(([pop]) => !pop.hidden)) return closePops();
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
  if (!hit.size) return notify('No cameras are playing');
  for (const c of hit) clip(c);
});

addEventListener('mousedown', (e) => {
  if (state.listening && !e.target.closest('[data-k]')) listen(null);
  const open = POPS.find(([pop]) => !pop.hidden);
  if (!open || open[0].contains(e.target) || open[1].contains(e.target)) return;
  if (STICKY.has(open[0]) && e.target.closest('.cell, .win, .m-dot, #shade')) return;
  closePops();
});

addEventListener('beforeunload', (e) => {
  if (state.list.some((it) => !it.saved) || cams.some((c) => c.rec)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
