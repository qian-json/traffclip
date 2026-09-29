'use strict';
// One live camera: polls the HLS playlist, demuxes each .ts segment into
// H.264 samples on a gapless 0-based timeline, plays them through MSE, and
// hands every sample to the page for the replay buffer and recordings.

// Timer that keeps ticking in background tabs (Chrome throttles plain
// setTimeout chains there to once a minute, which would drop segments).
const Tick = (() => {
  const subs = new Set();
  const fire = () => { for (const f of subs) f(); };
  let started = false;
  function start() {
    started = true;
    let fallback = null;
    const useTimer = () => { if (!fallback) fallback = setInterval(fire, 250); };
    try {
      const src = 'setInterval(() => postMessage(0), 250)';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = fire;
      w.onerror = useTimer;
    } catch (e) {
      useTimer();
    }
  }
  return {
    on(f) { if (!started) start(); subs.add(f); return () => subs.delete(f); },
    wait(ms) {
      const due = performance.now() + ms;
      return new Promise((r) => {
        const off = Tick.on(() => { if (performance.now() >= due) { off(); r(); } });
      });
    },
  };
})();

class Player {
  constructor(video, onError) {
    this.video = video;
    this.onError = (msg) => { if (!this.closed) onError(msg); };
    this.onVideoError = () => this.onError('decode error');
    video.addEventListener('error', this.onVideoError);
    this.ms = new MediaSource();
    this.q = [];
    this.sb = null;
    this.cfg = null;
    this.seq = 1;
    this.started = false;
    this.delay = 15;
    this.url = URL.createObjectURL(this.ms);
    this.opened = new Promise((r) => this.ms.addEventListener('sourceopen', r, { once: true }));
    video.src = this.url;
  }

  async append(samples) {
    await this.opened;
    if (this.closed) return;
    let i = 0;
    while (i < samples.length) {
      const cfg = samples[i].cfg;
      let j = i;
      while (j < samples.length && samples[j].cfg === cfg) j++;
      if (cfg !== this.cfg) {
        const mime = `video/mp4; codecs="${cfg.codec}"`;
        if (!this.sb) {
          if (!MediaSource.isTypeSupported(mime)) return this.onError('codec not supported: ' + cfg.codec);
          this.sb = this.ms.addSourceBuffer(mime);
          this.sb.addEventListener('updateend', () => { this.pump(); this.kick(); });
          this.sb.addEventListener('error', () => this.onError('playback error'));
        } else if (cfg.codec !== this.cfg.codec) {
          this.q.push({ type: mime });
        }
        this.q.push({ data: MP4.init(cfg) });
        this.cfg = cfg;
      }
      this.q.push({ data: MP4.fragment(this.seq++, samples.slice(i, j)) });
      i = j;
    }
    this.pump();
  }

  pump() {
    const sb = this.sb;
    if (this.closed || !sb || sb.updating || this.ms.readyState !== 'open') return;
    while (this.q.length) {
      const op = this.q.shift();
      try {
        if (op.type) { if (sb.changeType) sb.changeType(op.type); continue; }
        if (op.remove) sb.remove(op.remove[0], op.remove[1]);
        else sb.appendBuffer(op.data);
        return;
      } catch (e) {
        if (e.name === 'QuotaExceededError' && op.data) {
          this.q.unshift(op);
          const t = this.video.currentTime;
          if (sb.buffered.length && t - sb.buffered.start(0) > 2) { sb.remove(0, t - 1); return; }
        }
        return this.onError('playback error: ' + e.message);
      }
    }
  }

  // start playing near the live edge once the first batch is buffered
  go() {
    this.ready = true;
    this.kick();
  }

  kick() {
    const v = this.video;
    if (this.started || !this.ready || !this.sb || this.sb.updating || this.q.length || !v.buffered.length) return;
    this.started = true;
    const end = v.buffered.end(v.buffered.length - 1);
    v.currentTime = Math.max(v.buffered.start(0), end - this.delay);
    v.play().catch(() => {});
  }

  // called from the page tick: hold the live delay, hop gaps, drop old video
  tick() {
    const v = this.video;
    const b = v.buffered;
    if (!this.started || !b.length || this.closed) return;
    const t = v.currentTime;
    const end = b.end(b.length - 1);
    if (end - t > this.delay + 20) v.currentTime = end - this.delay;
    else if (v.readyState < 3) {
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) > t && b.start(i) - t < 30) { v.currentTime = b.start(i) + 0.05; break; }
      }
    }
    if (v.paused && !document.hidden) v.play().catch(() => {});
    if (this.sb && !this.q.some((op) => op.remove) && t - b.start(0) > 45) {
      this.q.push({ remove: [0, t - 30] });
      this.pump();
    }
  }

  // media time on screen, in 90 kHz ticks; null when nothing is playing
  playhead() {
    const v = this.video;
    if (!this.started || v.paused || v.readyState < 2) return null;
    return Math.round(v.currentTime * 90000);
  }

  close() {
    this.closed = true;
    this.video.removeEventListener('error', this.onVideoError);
    try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch (e) { /* already ended */ }
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

class Live {
  static count = 0;

  // hooks: {status(text), samples(array)}
  constructor(url, video, hooks) {
    this.url = url;
    this.hooks = hooks;
    this.id = ++Live.count; // clips only merge within one connection
    this.active = true;
    this.abort = new AbortController();
    this.demux = new Demux.TS();
    this.cfg = null;
    this.sps = null;
    this.pps = null;
    this.pending = null;
    this.offset = null;
    this.lastDur = 6000;
    this.n = 0;
    this.newest = null;
    this.chunklist = null;
    this.next = null;
    this.video = video;
    this.errors = [];
    this.player = new Player(video, (msg) => this.recover(msg));
    this.offTick = Tick.on(() => this.player.tick());
    this.loop();
  }

  stop() {
    this.active = false;
    this.abort.abort();
    this.offTick();
    this.player.close();
  }

  // a decode/MSE error kills the player: build a fresh one and resume at the
  // next keyframe (the replay buffer and recordings never stop)
  recover(msg) {
    if (!this.active) return;
    const now = Date.now();
    this.errors = this.errors.filter((t) => now - t < 60000);
    this.errors.push(now);
    if (this.errors.length > 3) return this.hooks.status(msg, true);
    const delay = this.player.delay;
    this.player.close();
    this.player = new Player(this.video, (m) => this.recover(m));
    this.player.delay = delay;
    this.player.ready = true;
    this.resync = true;
  }

  playhead() {
    const p = this.player.playhead();
    return p === null ? this.newest : Math.min(p, this.newest);
  }

  async get(url, as) {
    const r = await fetch(url, { cache: 'no-store', signal: this.abort.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return as === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : r.text();
  }

  async loop() {
    let fails = 0;
    this.hooks.status('connecting');
    while (this.active) {
      try {
        const pl = await this.playlist();
        await this.pull(pl);
        if (fails || !this.live) this.hooks.status('live');
        this.live = true;
        fails = 0;
        await Tick.wait(2000);
      } catch (e) {
        if (!this.active) return;
        fails++;
        this.live = false;
        this.chunklist = null;
        const why = e instanceof TypeError ? 'network/CORS error' : e.message;
        this.hooks.status(fails > 3 ? `offline (${why}), retrying` : 'reconnecting', fails > 3);
        await Tick.wait(Math.min(30000, 2000 * fails));
      }
    }
  }

  async playlist() {
    if (!this.chunklist) {
      const text = await this.get(this.url);
      const lines = text.split(/\r?\n/);
      const i = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
      if (i < 0) return parse(text, this.url);
      const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
      this.chunklist = new URL(uri, this.url).href;
    }
    return parse(await this.get(this.chunklist), this.chunklist);

    function parse(text, base) {
      const segs = [];
      let seq = 0, dur = 0;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = +line.slice(22);
        else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
        else if (line && !line.startsWith('#')) segs.push({ seq: seq + segs.length, dur, url: new URL(line, base).href });
      }
      if (!text.startsWith('#EXTM3U')) throw new Error('not a playlist');
      return { segs };
    }
  }

  async pull(pl) {
    const { segs } = pl;
    if (!segs.length) return;
    const first = segs[0].seq, last = segs[segs.length - 1].seq;
    // first load takes every listed segment (~30 s) so the replay buffer starts full;
    // a sequence that jumped backwards means the server restarted
    if (this.next === null || this.next > last + 3) this.next = first;
    if (this.next < first) this.next = first;
    for (const seg of segs) {
      if (seg.seq < this.next || !this.active) continue;
      const bytes = await this.get(seg.url, 'bytes');
      if (!this.active) return;
      this.next = seg.seq + 1;
      this.player.delay = Math.max(6, seg.dur * 1.3 + 1);
      const out = this.samples(this.demux.segment(bytes));
      if (!out.length) continue;
      let play = out;
      if (this.resync) {
        const k = out.findIndex((x) => x.key);
        play = k < 0 ? [] : out.slice(k);
        if (k >= 0) this.resync = false;
      }
      if (play.length) this.player.append(play);
      this.hooks.samples(out);
    }
    if (!this.player.ready) this.player.go();
  }

  // access units -> finished samples (duration known once the next one arrives)
  samples(units) {
    const out = [];
    for (const u of units) {
      let key = false;
      const parts = [];
      for (const nal of u.nals) {
        const t = nal[0] & 31;
        if (t === 7) this.sps = nal;
        else if (t === 8) this.pps = nal;
        else if (t !== 9 && t !== 12) {
          if (t === 5) key = true;
          parts.push(nal);
        }
      }
      if (!parts.length || !this.sps || !this.pps) continue;
      if (!this.cfg || (key && (!Demux.same(this.sps, this.cfg.sps) || !Demux.same(this.pps, this.cfg.pps)))) {
        if (!key) continue; // start at a keyframe
        this.cfg = Demux.config(this.sps.slice(), this.pps.slice());
      }
      let size = 0;
      for (const p of parts) size += 4 + p.length;
      const data = new Uint8Array(size);
      const dv = new DataView(data.buffer);
      let o = 0;
      for (const p of parts) { dv.setUint32(o, p.length); data.set(p, o + 4); o += 4 + p.length; }
      let cto = u.pts - u.dts;
      if (cto < -(2 ** 32)) cto += 2 ** 33;
      if (cto > 2 ** 32) cto -= 2 ** 33;
      const s = { dts: u.dts, cto: Math.max(0, cto), dur: 0, key, data, cfg: this.cfg, n: 0 };

      // map stream time onto one gapless timeline; a jump (lost segment,
      // encoder restart, 33-bit wrap) is closed up instead of stalling playback
      if (this.offset === null) this.offset = -s.dts;
      s.dts += this.offset;
      const p = this.pending;
      if (p) {
        let d = s.dts - p.dts;
        if (d <= 0 || d > 3 * 90000) {
          d = this.lastDur;
          this.offset += p.dts + d - s.dts;
          s.dts = p.dts + d;
        }
        p.dur = d;
        this.lastDur = d;
        p.n = ++this.n;
        out.push(p);
        this.newest = p.dts + p.dur;
      }
      this.pending = s;
    }
    return out;
  }
}
