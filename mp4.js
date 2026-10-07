'use strict';
// MP4 output: init and fragment boxes for MSE playback, flat .mp4 files for
// saved clips. Sample: {dts, cto, dur, key, data (AVCC), cfg}.

const MP4 = (() => {
  const TS = 90000; // same clock as MPEG-TS

  class W {
    constructor() { this.a = []; }
    u8(...v) { for (const x of v) this.a.push(x & 255); return this; }
    u16(v) { return this.u8(v >> 8, v); }
    u32(v) { return this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
    u64(v) { return this.u32(Math.floor(v / 2 ** 32)).u32(v % 2 ** 32); }
    zero(n) { while (n--) this.a.push(0); return this; }
    str(s) { for (const c of s) this.a.push(c.charCodeAt(0)); return this; }
    bytes(b) { for (const x of b) this.a.push(x); return this; }
    done() { return new Uint8Array(this.a); }
  }

  function box(type, ...parts) {
    let size = 8;
    for (const p of parts) size += p.length;
    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let o = 8;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const full = (type, version, flags, w) => box(type, new W().u8(version).u8(flags >> 16, flags >> 8, flags).done(), w ? w.done() : new Uint8Array(0));

  const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
  const matrix = (w) => { for (const m of MATRIX) w.u32(m); return w; };

  const ftyp = () => box('ftyp', new W().str('isom').u32(0x200).str('isomiso2avc1mp41').done());

  function mvhd(scale, dur) {
    const w = new W().u32(0).u32(0).u32(scale).u32(dur).u32(0x10000).u16(0x100).zero(10);
    return full('mvhd', 0, 0, matrix(w).zero(24).u32(2));
  }

  function tkhd(cfg, dur) {
    const w = new W().u32(0).u32(0).u32(1).u32(0).u32(dur).zero(8).u16(0).u16(0).u16(0).u16(0);
    const dw = Math.round(cfg.width * cfg.sar[0] / cfg.sar[1]);
    return full('tkhd', 0, 3, matrix(w).u32(dw * 65536).u32(cfg.height * 65536));
  }

  // AVCDecoderConfigurationRecord: the avcC box body, and WebCodecs' decoder description
  function avcC(cfg) {
    const c = new W().u8(1, cfg.sps[1], cfg.sps[2], cfg.sps[3], 0xff, 0xe1)
      .u16(cfg.sps.length).bytes(cfg.sps).u8(1).u16(cfg.pps.length).bytes(cfg.pps);
    if ([100, 110, 122, 144].includes(cfg.profile)) {
      c.u8(0xfc | cfg.chroma, 0xf8 | cfg.depthY, 0xf8 | cfg.depthC, 0);
    }
    return c.done();
  }

  function avc1(cfg) {
    const parts = [box('avcC', avcC(cfg))];
    if (cfg.sar[0] !== cfg.sar[1]) parts.push(box('pasp', new W().u32(cfg.sar[0]).u32(cfg.sar[1]).done()));
    const head = new W().zero(6).u16(1).zero(16).u16(cfg.width).u16(cfg.height)
      .u32(0x480000).u32(0x480000).u32(0).u16(1).zero(32).u16(0x18).u16(0xffff).done();
    return box('avc1', head, ...parts);
  }

  function mdia(cfg, dur, tables) {
    return box('mdia',
      full('mdhd', 0, 0, new W().u32(0).u32(0).u32(TS).u32(dur).u16(0x55c4).u16(0)),
      full('hdlr', 0, 0, new W().u32(0).str('vide').zero(12).str('VideoHandler').u8(0)),
      box('minf',
        full('vmhd', 0, 1, new W().zero(8)),
        box('dinf', full('dref', 0, 0, new W().u32(1).bytes(full('url ', 0, 1)))),
        box('stbl', full('stsd', 0, 0, new W().u32(1).bytes(avc1(cfg))), ...tables)));
  }

  const flagsOf = (s) => (s.key ? 0x02000000 : 0x01010000);

  function init(cfg) {
    const empty = ['stts', 'stsc', 'stco'].map((t) => full(t, 0, 0, new W().u32(0)));
    empty.push(full('stsz', 0, 0, new W().u32(0).u32(0)));
    const moov = box('moov', mvhd(TS, 0),
      box('trak', tkhd(cfg, 0), mdia(cfg, 0, empty)),
      box('mvex', full('trex', 0, 0, new W().u32(1).u32(1).u32(0).u32(0).u32(0))));
    return concat([ftyp(), moov]);
  }

  function fragment(seq, samples) {
    const run = new W().u32(samples.length).u32(0);
    let bytes = 0;
    for (const s of samples) {
      run.u32(s.dur).u32(s.data.length).u32(flagsOf(s)).u32(s.cto);
      bytes += s.data.length;
    }
    const moof = box('moof',
      full('mfhd', 0, 0, new W().u32(seq)),
      box('traf',
        full('tfhd', 0, 0x020000, new W().u32(1)),
        full('tfdt', 1, 0, new W().u64(samples[0].dts)),
        full('trun', 0, 0xf01, run)));
    // trun data_offset sits 84 bytes into moof
    new DataView(moof.buffer).setUint32(84, moof.length + 8);
    const mdat = new Uint8Array(8 + bytes);
    new DataView(mdat.buffer).setUint32(0, mdat.length);
    mdat.set([109, 100, 97, 116], 4);
    let o = 8;
    for (const s of samples) { mdat.set(s.data, o); o += s.data.length; }
    return concat([moof, mdat]);
  }

  function file(samples) {
    const cfg = samples[0].cfg;
    const t0 = samples[0].dts;
    const stts = [], ctts = [], sizes = [], keys = [];
    let dur = 0, bytes = 0, anyCto = false;
    samples.forEach((s, i) => {
      const last = stts[stts.length - 1];
      if (last && last[1] === s.dur) last[0]++; else stts.push([1, s.dur]);
      const lc = ctts[ctts.length - 1];
      if (lc && lc[1] === s.cto) lc[0]++; else ctts.push([1, s.cto]);
      if (s.cto) anyCto = true;
      if (s.key) keys.push(i + 1);
      sizes.push(s.data.length);
      bytes += s.data.length;
      dur = s.dts - t0 + s.dur;
    });
    const ms = Math.round(dur / 90);
    const head = ftyp();
    const big = bytes + 16 > 0xffffffff;
    const mdatHead = big
      ? new W().u32(1).str('mdat').u64(bytes + 16).done()
      : new W().u32(bytes + 8).str('mdat').done();
    const dataAt = head.length + mdatHead.length;

    const w = (rows) => { const x = new W().u32(rows.length); for (const [a, b] of rows) x.u32(a).u32(b); return x; };
    const tables = [full('stts', 0, 0, w(stts))];
    if (anyCto) tables.push(full('ctts', 0, 0, w(ctts)));
    if (keys.length < samples.length) {
      const k = new W().u32(keys.length);
      for (const n of keys) k.u32(n);
      tables.push(full('stss', 0, 0, k));
    }
    tables.push(full('stsc', 0, 0, new W().u32(1).u32(1).u32(samples.length).u32(1)));
    const z = new W().u32(0).u32(sizes.length);
    for (const n of sizes) z.u32(n);
    tables.push(full('stsz', 0, 0, z));
    tables.push(dataAt + bytes > 0xffffffff
      ? full('co64', 0, 0, new W().u32(1).u64(dataAt))
      : full('stco', 0, 0, new W().u32(1).u32(dataAt)));

    // edit list skips the B-frame reorder delay so playback starts at 0
    const edts = box('edts', full('elst', 0, 0, new W().u32(1).u32(ms).u32(samples[0].cto).u32(0x10000)));
    const moov = box('moov', mvhd(1000, ms), box('trak', tkhd(cfg, ms), edts, mdia(cfg, dur, tables)));
    return new Blob([head, mdatHead, ...samples.map((s) => s.data), moov], { type: 'video/mp4' });
  }

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  return { init, fragment, file, avcC };
})();
