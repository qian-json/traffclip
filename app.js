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
const secs = store.get('secs', {}); // camera id -> replay seconds
const state = { queue: false, merge: store.get('merge', false), queued: [], listening: null, max: null };
const HZ = 90000;

const grid = document.getElementById('grid');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cams = window.CAMERAS.map((c, i) => ({ ...c, i, live: null, buf: [], rec: null }));

// ---- grid ----------------------------------------------------------------

grid.innerHTML = cams.map((c) => `
<div class="cell" data-i="${c.i}">
  <button class="x" data-a="close" title="close (Esc)" aria-label="close">×</button>
  <div class="view" title="open large"><img loading="lazy" alt="" src="images/${esc(c.id)}.jpg"></div>
  <div class="name" title="${esc(c.name)}">${esc(c.name)}</div>
  <div class="meta">${esc(c.region)} · ${esc(c.id)} <span class="st"></span></div>
  <div class="row">
    <button data-a="conn">connect</button>
    <button data-a="rec" disabled>rec</button><span class="sw"></span>
    <span class="gap"></span>
    <button data-a="clip" disabled title="save the last few seconds">clip</button>
    <button data-a="key" title="key that clips this camera">key ${esc(keys[c.id]?.label || '—')}</button>
    <label title="replay buffer length"><input data-a="secs" type="number" min="5" max="3600" step="5" value="${secsOf(c)}">s</label>
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
  if (e.target.closest('.view')) {
    if (!cell.classList.contains('max')) openMax(c);
    return;
  }
  const b = e.target.closest('button');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'conn') c.live ? disconnect(c) : connect(c);
  else if (a === 'rec') c.rec ? stopRec(c) : startRec(c);
  else if (a === 'clip') clip(c);
  else if (a === 'key') listen(state.listening === c.id ? null : c.id);
  else if (a === 'close') closeMax(c);
});

grid.addEventListener('change', (e) => {
  if (e.target.dataset.a !== 'secs') return;
  const c = cams[e.target.closest('.cell').dataset.i];
  const v = Math.round(Math.min(3600, Math.max(5, +e.target.value || 30)));
  e.target.value = v;
  secs[c.id] = v;
  store.set('secs', secs);
});

function secsOf(c) { return secs[c.id] || 30; }

function sync(c) {
  const on = !!c.live;
  c.el.classList.toggle('on', on);
  c.btn.conn.textContent = on ? 'disconnect' : 'connect';
  c.btn.rec.disabled = !on;
  c.btn.clip.disabled = !on;
  c.btn.rec.textContent = c.rec ? 'stop' : 'rec';
  c.btn.rec.classList.toggle('on', !!c.rec);
  if (!c.rec) c.sw.textContent = '';
  updateCount();
  renderKeys();
}

function status(c, text, bad) {
  c.status = text;
  c.bad = !!bad;
  if (!c.flashTimer) paint(c);
}

// short-lived message, then back to the connection status
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

// ---- connection ------------------------------------------------------------

function connect(c) {
  if (solo.checked) {
    for (const o of cams) if (o !== c && o.live && !o.rec) disconnect(o);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  // once real frames show, the placeholder goes away (letterbox bars turn black)
  video.addEventListener('loadeddata', () => c.view.classList.add('live'));
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
  c.view.classList.remove('live');
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
  // keep N seconds behind what's on screen, starting on a keyframe. Until
  // video is playing there is no screen position yet, so only the cap applies
  // (N + 1 min behind the newest frame, which also bounds memory while a
  // hidden tab has the video paused)
  const n = secsOf(c) * HZ;
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
  shade.hidden = false;
  document.body.classList.add('maxed');
}

function closeMax(c) {
  c.el.classList.remove('max');
  c.spacer?.remove();
  c.spacer = null;
  state.max = null;
  shade.hidden = true;
  document.body.classList.remove('maxed');
}

// ---- clips & recordings ------------------------------------------------------

function clip(c) {
  if (!c.live) return flash(c, 'connect first');
  const end = c.live.playhead();
  const start = end - secsOf(c) * HZ;
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

const lengthOf = (samples) => {
  const last = samples[samples.length - 1];
  return (last.dts + last.dur - samples[0].dts) / HZ;
};

function output(c, item) {
  const s = Math.round(lengthOf(item.samples));
  const what = item.kind === 'clip' ? 'clip' : 'recording';
  if (state.queue) {
    state.queued.push(item);
    flash(c, `${what} queued (${s}s)`);
    updateQueue();
  } else {
    flash(c, `${what} saved (${s}s)`);
    downloadAll(filesOf([item]));
  }
}

// overlapping or touching clips of one camera (same connection) become one
function mergeClips(items) {
  const clips = items.filter((it) => it.kind === 'clip')
    .sort((a, b) => a.cam.i - b.cam.i || a.conn - b.conn || a.n0 - b.n0);
  const merged = [];
  let cur = null;
  for (const it of clips) {
    if (cur && cur.cam === it.cam && cur.conn === it.conn && it.n0 <= cur.n1 + 1) {
      if (it.n1 > cur.n1) {
        const n1 = cur.n1;
        cur.samples = cur.samples.concat(it.samples.filter((s) => s.n > n1));
        cur.n1 = it.n1;
      }
      cur.merged++;
    } else {
      if (cur) merged.push(cur);
      cur = { ...it, merged: 1 };
    }
  }
  if (cur) merged.push(cur);
  return [...items.filter((it) => it.kind !== 'clip'), ...merged].sort((a, b) => a.at - b.at);
}

function filesOf(items) {
  const files = [];
  for (const it of items) {
    // a mid-stream resolution change needs a new file
    const parts = [];
    for (const s of it.samples) {
      const cur = parts[parts.length - 1];
      if (cur && cur[0].cfg === s.cfg) cur.push(s);
      else if (s.key) parts.push([s]);
    }
    const base = [it.cam.id, slug(it.cam.name), stamp(it.at), it.merged > 1 ? `clip-merged${it.merged}` : it.kind].join('_');
    parts.forEach((p, i) => files.push({ name: base + (parts.length > 1 ? '-' + (i + 1) : '') + '.mp4', blob: MP4.file(p) }));
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

// ---- header ------------------------------------------------------------------

const qBtn = document.getElementById('queue');
const mBtn = document.getElementById('merge');
const note = document.getElementById('note');

qBtn.onclick = () => {
  if (!state.queue) {
    state.queue = true;
  } else {
    state.queue = false;
    const items = state.merge ? mergeClips(state.queued) : state.queued;
    state.queued = [];
    if (items.length) {
      const files = filesOf(items);
      note.textContent = `downloading ${files.length} file${files.length > 1 ? 's' : ''}`;
      downloadAll(files).then(() => setTimeout(() => { note.textContent = ''; }, 2000));
    }
  }
  updateQueue();
};

mBtn.onclick = () => {
  state.merge = !state.merge;
  store.set('merge', state.merge);
  updateQueue();
};

function updateQueue() {
  const n = state.queued.length;
  qBtn.textContent = state.queue ? `queue on${n ? ` (${n})` : ''}` : 'queue off';
  qBtn.classList.toggle('on', state.queue);
  qBtn.title = state.queue ? 'press to download everything queued' : 'hold downloads until pressed again';
  mBtn.textContent = state.merge ? 'merge overlaps on' : 'merge overlaps off';
  mBtn.classList.toggle('on', state.merge);
}
updateQueue();

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
      (!q || `${c.name} ${c.id} ${c.region}`.toLowerCase().includes(q));
    c.el.hidden = !hit;
  }
  updateCount();
}

function updateCount() {
  const shown = cams.filter((c) => !c.el.hidden).length;
  const live = cams.filter((c) => c.live).length;
  document.getElementById('count').textContent =
    (shown === cams.length ? `${cams.length} cameras` : `${shown} of ${cams.length}`) + (live ? ` · ${live} connected` : '');
}
updateCount();

// ---- keys --------------------------------------------------------------------

const MODS = ['Control', 'Alt', 'Shift', 'Meta'];

function comboOf(e) {
  if (!e.key || !e.code || MODS.includes(e.key)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd'].filter(Boolean);
  const name = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : /^Digit\d$/.test(e.code) ? e.code.slice(5)
      : e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : e.code;
  return { combo: [...mods, e.code].join('+'), label: [...mods, name].join('+') };
}

// Settings > keybinds. keys['*'] clips every connected camera; any other
// entry is one camera's id. Rows: that "all" key, then every camera that is
// connected or already has a key.
const panel = document.getElementById('settings');
const keylist = document.getElementById('keylist');
const setBtn = document.getElementById('settings-btn');
const solo = document.getElementById('solo');
solo.checked = store.get('solo', false);
solo.onchange = () => store.set('solo', solo.checked);

setBtn.onclick = () => {
  panel.hidden = !panel.hidden;
  setBtn.classList.toggle('on', !panel.hidden);
  listen(null);
};

function closeSettings() {
  panel.hidden = true;
  setBtn.classList.remove('on');
  listen(null);
}

// which key slot (camera id or '*') waits for a keypress; shown on the
// camera's own key button and in the settings list
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
  const rows = [{ id: '*', name: 'All connected cameras' }, ...cams.filter((c) => c.live || keys[c.id])];
  keylist.innerHTML = rows.map((r) => {
    const listening = state.listening === r.id;
    return `<div class="krow">
      <span class="kname">${esc(r.name)}${r.region ? ` <span class="meta">${esc(r.id)}</span>` : ''}</span>
      <button data-k="${esc(r.id)}" class="${listening ? 'on' : ''}">${listening ? 'press a key' : esc(keys[r.id]?.label || '—')}</button>
      ${keys[r.id] ? `<button data-clear="${esc(r.id)}" title="remove key" aria-label="remove key">×</button>` : '<span class="kx"></span>'}
    </div>`;
  }).join('') + (rows.length > 1 ? '' : '<p>Connect a camera to give it its own key.</p>');
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
    if (!panel.hidden) return closeSettings();
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
  if (!panel.hidden && !e.target.closest('#settings, #settings-btn')) closeSettings();
});

addEventListener('beforeunload', (e) => {
  if (state.queued.length || cams.some((c) => c.rec)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
