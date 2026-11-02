// End-to-end smoke test against the live DOTD streams: play, clip by key, merge, record,
// save, window, map, popovers. Run from the repo root: node tools/test/cdp.mjs tools/test/smoke.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export default async ({ ev, sleep, click, key, dl }) => {
  const check = (label, ok, got) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`);
    if (!ok) process.exitCode = 1;
  };
  const center = (expr) => ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);

  check('518 tiles', (await ev(`document.querySelectorAll('.cell').length`)) === 518);
  const M = await ev(`cams.find((c) => c.id === 'mnr-cam-001').i`);

  await click(...(await center(`cams[${M}].view`)));
  const live = await ev(`new Promise((r) => { const t = setInterval(() => { if (cams[${M}].view.classList.contains('live')) { clearInterval(t); r(true); } }, 200); setTimeout(() => r(false), 25000); })`);
  check('click a picture plays it', live);
  await sleep(5000);

  await ev(`keys[cams[${M}].id] = { combo: 'KeyJ', label: 'J' }; paintKey(cams[${M}].id); mBox.checked = true; mBox.onchange(); 1`);
  await key('j', 'KeyJ', 74); await sleep(2000); await key('j', 'KeyJ', 74); await sleep(300);
  check('two key clips merge', (await ev(`plan().length`)) === 1 && (await ev(`plan()[0].parts.length`)) === 2);
  check('merge toast', (await ev(`toast.textContent`)).startsWith('Merged 2 clips'));

  await ev(`startRec(cams[${M}]); 1`); await sleep(3000); await ev(`stopRec(cams[${M}]); 1`);
  check('recording added', (await ev(`plan().length`)) === 2);

  await ev(`popOut(cams[${M}]); 1`); await sleep(1500);
  check('window mirrors the live tile', (await ev(`document.querySelector('.win').className`)).includes('live'));

  await click(...(await center(`document.getElementById('view-map')`))); await sleep(300);
  check('map shows located cameras', (await ev(`document.querySelectorAll('.m-dot').length`)) > 400);
  await click(...(await center(`document.getElementById('view-grid')`)));

  await click(...(await center(`setBtn`)));
  await click(...(await center(`qList`)));
  check('popovers are exclusive', await ev(`panel.hidden && !qPanel.hidden`));
  await click(...(await center(`qAll`))); await sleep(2500);
  const files = readdirSync(dl).filter((f) => f.endsWith('.mp4'));
  check('two files saved', files.length === 2, files);
  for (const f of files) {
    const err = spawnSync('ffmpeg', ['-v', 'error', '-i', `${dl}/${f}`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    check(`${f} decodes`, !err.trim(), err);
  }
};
