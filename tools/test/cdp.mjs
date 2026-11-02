// Headless-Chrome driver for traffclip. Maintenance tooling only; the page never loads it.
//   node tools/test/cdp.mjs tools/test/smoke.mjs
// Needs Node 22 (global WebSocket) and Google Chrome. The steps module's default export gets
// a context: { ev, sleep, click, key, shot, cdp, dl }.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = 9471;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const steps = process.argv[2];
if (!steps) { console.error('usage: node tools/test/cdp.mjs <steps.mjs>'); process.exit(2); }

// another browser on this port would silently receive the commands
if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)) {
  console.error(`port ${PORT} is in use; refusing to run`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'traffclip-test-'));
const dl = join(tmp, 'downloads');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmp, 'profile')}`,
  '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ver;
for (let i = 0; i < 150 && !ver; i++) {
  await sleep(200);
  ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json(), () => null);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') console.log('[exception]', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
const cdp = (method, params) => send(method, params, sessionId);
await cdp('Runtime.enable');
await cdp('Page.navigate', { url: pathToFileURL(resolve('index.html')).href });
await sleep(1500);

const ev = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(`${expr}\n${r.result.exceptionDetails.exception?.description}`);
  return r.result.result.value;
};
const click = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
// Enter must carry text to activate a focused button; rawKeyDown alone does not click
const key = async (k, code, vk, text) => {
  await cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, text });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const shot = async (file) => writeFileSync(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

let failed = false;
try {
  await (await import(pathToFileURL(resolve(steps)).href)).default({ ev, sleep, click, key, shot, cdp, dl });
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  if (!process.env.KEEP) rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : process.exitCode || 0);
