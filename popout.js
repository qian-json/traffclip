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
  el.innerHTML = `<div class="win-bar"><span class="win-name"></span><button class="win-cn">${CONNECT_ICONS}</button><button class="win-clip">clip</button>` +
    '<button class="win-x" title="close" aria-label="close">×</button></div>' +
    `<div class="win-view"><img alt="" src="images/${esc(c.id)}.jpg"><canvas></canvas><span class="spin"></span></div>`;
  el.querySelector('.win-name').textContent = c.name;
  const w = 360, h = 270, step = wins.size * 28;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  winLayer.append(el);
  place(el, innerWidth - w - 24 - step, innerHeight - h - 24 - step);

  const win = { el, cam: c, canvas: el.querySelector('canvas'), connBtn: el.querySelector('.win-cn'), clipBtn: el.querySelector('.win-clip') };
  c.win = win;
  wins.add(win);
  raise(win);

  el.addEventListener('pointerdown', () => raise(win));
  win.connBtn.addEventListener('click', () => toggle(c));
  win.clipBtn.addEventListener('click', () => {
    c.clipFrom = win.clipBtn;
    clip(c);
  });
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
  bar.addEventListener('pointerup', () => { drag = null; });

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

// keeps the bar grabbable: 120 px of it stays on screen beside the buttons, above the status bar
function place(el, x, y) {
  const w = el.offsetWidth;
  el.style.left = `${Math.min(Math.max(x, 120 - w), innerWidth - 120)}px`;
  el.style.top = `${Math.min(Math.max(y, 0), innerHeight - 60)}px`;
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
    win.connBtn.title = win.connBtn.ariaLabel = c.live ? 'disconnect' : 'connect';
    if (video) drawVideo(win.canvas, video);
  }
  if (wins.size) winFrame = requestAnimationFrame(drawWins);
}

addEventListener('resize', () => {
  for (const win of wins) place(win.el, win.el.offsetLeft, win.el.offsetTop);
});
