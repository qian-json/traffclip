'use strict';
// Floating camera windows. Each mirrors its camera's tile video into a canvas
// (the tile keeps the one live stream); drag by the bar, resize from the corner.

const winLayer = document.getElementById('wins');
const wins = new Set();
let winZ = 0;
let winFrame = 0;

function popOut(c) {
  if (c.win) return raise(c.win);
  if (!c.live) connect(c);
  const el = document.createElement('div');
  el.className = 'win';
  el.innerHTML = '<div class="win-bar"><span class="win-name"></span>' +
    `<button class="ic win-go" title="Find this camera" aria-label="Find this camera">${ICON.locate}</button>` +
    `<button class="ic win-max" title="Open large" aria-label="Open large">${ICON.expand}</button>` +
    `<button class="ic win-cn">${ICON.play}${ICON.stop}</button><button class="win-clip" title="Clip" aria-label="Clip">${ICON.clip}</button>` +
    `<button class="ic win-x" title="Close" aria-label="Close">${ICON.x}</button></div>` +
    `<div class="win-view"><img alt="" src="images/${esc(c.id)}.jpg"><canvas></canvas><span class="spin"></span></div>`;
  const name = el.querySelector('.win-name');
  name.textContent = name.title = c.name;
  const w = 360, h = 278, step = wins.size * 28;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  winLayer.append(el);
  place(el, innerWidth - w - 24 - step, innerHeight - h - 24 - step);

  const win = { el, cam: c, canvas: el.querySelector('canvas'), connBtn: el.querySelector('.win-cn'), clipBtn: el.querySelector('.win-clip') };
  c.win = win;
  wins.add(win);
  raise(win);

  el.addEventListener('pointerdown', () => raise(win));
  el.querySelector('.win-go').addEventListener('click', () => jumpTo(c));
  el.querySelector('.win-max').addEventListener('click', () => openMax(c));
  win.connBtn.addEventListener('click', () => toggle(c));
  win.clipBtn.addEventListener('click', () => clip(c, win.clipBtn));
  el.querySelector('.win-x').addEventListener('click', () => closeWin(win));

  const bar = el.querySelector('.win-bar');
  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => {
    if (drag) place(el, e.clientX - drag.dx, e.clientY - drag.dy);
  });
  bar.addEventListener('lostpointercapture', () => { drag = null; });
  bar.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button')) openMax(c);
  });

  if (!winFrame) winFrame = requestAnimationFrame(drawWins);
}

function closeWin(win) {
  win.el.remove();
  wins.delete(win);
  win.cam.win = null;
}

function raise(win) {
  win.el.style.zIndex = ++winZ;
}

// keeps the bar grabbable: 120 px of it stays on screen beside the buttons
function place(el, x, y) {
  const w = el.offsetWidth;
  el.style.left = `${Math.min(Math.max(x, 120 - w), innerWidth - 120)}px`;
  el.style.top = `${Math.min(Math.max(y, 0), innerHeight - 60)}px`;
}

// shows the camera in the current view: its dot on the map, otherwise its tile
function jumpTo(c) {
  if (state.max) closeMax(state.max);
  if (c.el.hidden) {
    clearFilters();
    notify('Filters cleared');
  }
  if (!mapEl.hidden && focusDot(c)) return;
  setView('grid');
  c.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  c.el.classList.remove('flash');
  void c.el.offsetWidth;
  c.el.classList.add('flash');
}

function drawWins() {
  winFrame = 0;
  for (const win of wins) {
    const c = win.cam;
    const video = c.live && c.view.classList.contains('live') ? c.view.querySelector('video') : null;
    win.el.classList.toggle('live', !!video);
    win.el.classList.toggle('loading', !!c.live && !video);
    win.el.classList.toggle('rec', !!c.rec);
    win.el.classList.toggle('on', !!c.live);
    win.clipBtn.disabled = !c.live;
    win.connBtn.title = win.connBtn.ariaLabel = c.live ? 'Stop watching' : 'Watch live';
    if (video) drawVideo(win.canvas, video);
  }
  if (wins.size) winFrame = requestAnimationFrame(drawWins);
}

addEventListener('resize', () => {
  for (const win of wins) place(win.el, win.el.offsetLeft, win.el.offsetTop);
});
