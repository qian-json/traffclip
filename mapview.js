'use strict';
// Map view: basemap.js outlines plus one dot per located camera, with
// pan (drag), zoom (wheel, buttons), and clicks that open the camera large.

const mapEl = document.getElementById('map');
const svg = document.getElementById('mapsvg');
const tip = document.getElementById('maptip');
const BM = window.BASEMAP;
const COS = Math.cos(BM.lat0 * Math.PI / 180);
const project = (c) => [(c.lon - BM.lon0) * COS * BM.k, (BM.lat0 - c.lat) * BM.k];
const placed = cams.filter((c) => c.lat != null);
const MIN_W = 4;
let view = BM.view.slice();

svg.innerHTML = `<path class="m-state" d="${BM.state}"/><path class="m-parish" d="${BM.parishes}"/>` +
  `<path class="m-hwy" d="${BM.highways}"/><path class="m-int" d="${BM.interstates}"/><g class="m-labels"></g><g class="m-dots"></g>`;

const byRegion = {};
for (const c of placed) (byRegion[c.region] ??= []).push(project(c));
svg.querySelector('.m-labels').innerHTML = Object.entries(byRegion).map(([name, pts]) => {
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = Math.min(...pts.map((p) => p[1])) - 2;
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><text>${esc(name)}</text></g>`;
}).join('');

const star = STAR_ICON.match(/d="([^"]+)"/)[1];
svg.querySelector('.m-dots').innerHTML = placed.map((c) => {
  const [x, y] = project(c);
  return `<g class="m-dot" data-i="${c.i}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><g class="m-shape">` +
    `<circle class="m-ring" r="6.5"/><circle class="m-core" r="6"/><path class="m-star" d="${star}" transform="translate(-10 -10) scale(.83)"/></g></g>`;
}).join('');
const dots = new Map([...svg.querySelectorAll('.m-dot')].map((d) => [cams[d.dataset.i], d]));

const missing = cams.length - placed.length;
document.getElementById('mapnote').textContent =
  (missing ? `${missing} camera${missing > 1 ? 's' : ''} without a known location aren't shown · ` : '') +
  'Outlines: US Census · Some locations: © OpenStreetMap contributors';

function paintDots() {
  for (const [c, d] of dots) {
    d.classList.toggle('off', c.el.hidden);
    d.classList.toggle('on', !!c.live);
    d.classList.toggle('rec', !!c.rec);
    d.classList.toggle('fav', favs.has(c.id));
  }
}

function apply() {
  svg.setAttribute('viewBox', view.join(' '));
  const u = Math.max(view[2] / (svg.clientWidth || 1), view[3] / (svg.clientHeight || 1));
  svg.style.setProperty('--u', u);
}

function zoomAt(px, py, f) {
  const w = Math.min(Math.max(view[2] * f, MIN_W), BM.view[2] * 1.5);
  f = w / view[2];
  view = [px - (px - view[0]) * f, py - (py - view[1]) * f, view[2] * f, view[3] * f];
  apply();
}

function center() {
  return [view[0] + view[2] / 2, view[1] + view[3] / 2];
}

function fit(pts) {
  if (!pts.length) {
    view = BM.view.slice();
  } else {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = Math.max(Math.max(...xs) - Math.min(...xs), MIN_W * 4), h = Math.max(Math.max(...ys) - Math.min(...ys), MIN_W * 4);
    view = [Math.min(...xs) - w * .1, Math.min(...ys) - h * .1, w * 1.2, h * 1.2];
  }
  apply();
}

const toSvg = (e) => {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
};

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(...toSvg(e), Math.exp(e.deltaY * 0.0015));
}, { passive: false });

let drag = null;
svg.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false, dot: e.target.closest('.m-dot') };
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    svg.classList.add('dragging');
    const u = parseFloat(svg.style.getPropertyValue('--u'));
    view[0] -= dx * u;
    view[1] -= dy * u;
    drag.x = e.clientX;
    drag.y = e.clientY;
    hideTip();
    apply();
    return;
  }
  const d = e.target.closest('.m-dot');
  if (d) showTip(cams[d.dataset.i], e);
  else hideTip();
});
svg.addEventListener('pointerup', (e) => {
  const d = drag && !drag.moved && drag.dot;
  drag = null;
  svg.classList.remove('dragging');
  if (d) {
    hideTip();
    openMax(cams[d.dataset.i]);
  }
});
svg.addEventListener('pointerleave', hideTip);

tip.innerHTML = '<div class="tipview"><img alt=""><canvas></canvas></div><div class="tipname"></div><div class="meta"></div>';
const tipImg = tip.querySelector('img');
const tipCanvas = tip.querySelector('canvas');
let tipCam = null;
let tipFrame = 0;

function showTip(c, e) {
  if (c !== tipCam) {
    tipCam = c;
    tipImg.src = `images/${c.id}.jpg`;
    tip.querySelector('.tipname').textContent = c.name;
  }
  const box = mapEl.getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 200)}px`;
  tip.style.top = `${Math.min(e.clientY - box.top + 14, box.height - 170)}px`;
  tip.hidden = false;
  if (!tipFrame) tipFrame = requestAnimationFrame(drawTip);
}

function hideTip() {
  tip.hidden = true;
  tipCam = null;
}

// copies frames from the camera's own <video>, which keeps playing in its tile under the map
function drawTip() {
  tipFrame = 0;
  const c = tipCam;
  if (!c) return;
  const video = c.live && c.view.classList.contains('live') ? c.view.querySelector('video') : null;
  tip.classList.toggle('live', !!video);
  tip.querySelector('.meta').textContent = c.region + (video ? ' · live' : c.live ? ' · connecting' : '');
  if (video) drawVideo(tipCanvas, video);
  tipFrame = requestAnimationFrame(drawTip);
}

document.getElementById('zoom-in').onclick = () => zoomAt(...center(), 0.6);
document.getElementById('zoom-out').onclick = () => zoomAt(...center(), 1 / 0.6);
document.getElementById('zoom-fit').onclick = () => fit([...dots].filter(([c]) => !c.el.hidden).map(([c]) => project(c)));

region.addEventListener('change', () => {
  if (!mapEl.hidden) fit([...dots].filter(([c]) => !c.el.hidden).map(([c]) => project(c)));
});

document.addEventListener('camchange', paintDots);

document.addEventListener('clipped', (e) => {
  const d = dots.get(e.detail);
  if (!d || mapEl.hidden) return;
  d.classList.remove('pulse');
  void d.getBoundingClientRect();
  d.classList.add('pulse');
});

const header = document.querySelector('header');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--head', `${header.offsetHeight}px`);
  if (!mapEl.hidden) apply();
}).observe(header);
addEventListener('resize', () => { if (!mapEl.hidden) apply(); });

const viewBtns = { grid: document.getElementById('view-grid'), map: document.getElementById('view-map') };
function setView(v) {
  mapEl.hidden = v !== 'map';
  document.body.classList.toggle('mapped', v === 'map');
  for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle('on', k === v);
  store.set('view', v);
  if (v === 'map') {
    paintDots();
    apply();
  }
}
viewBtns.grid.onclick = () => setView('grid');
viewBtns.map.onclick = () => setView('map');
setView(store.get('view', 'grid'));
