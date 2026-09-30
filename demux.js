'use strict';
// MPEG-TS -> H.264 samples. Video only: the DOTD streams carry no audio.
// Timestamps are 90 kHz ticks.

const Demux = (() => {
  class TS {
    constructor() {
      this.pmt = -1;
      this.video = -1;
      this.chunks = [];
      this.size = 0;
      this.units = [];
    }

    // Feed one whole segment; returns its access units [{pts, dts, nals}].
    segment(b) {
      let i = 0;
      while (i + 188 < b.length && !(b[i] === 0x47 && b[i + 188] === 0x47)) i++;
      for (; i + 188 <= b.length; i += 188) {
        if (b[i] !== 0x47) continue;
        const end = i + 188;
        const pusi = b[i + 1] & 0x40;
        const pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2];
        const afc = (b[i + 3] >> 4) & 3;
        if (!(afc & 1)) continue;
        let o = i + 4;
        if (afc & 2) o += 1 + b[o];
        if (o >= end) continue;
        // PAT/PMT fit in one packet here; only read a table from its start
        if (pid === 0) {
          if (pusi) this.readPat(b, o + 1 + b[o], end);
        } else if (pid === this.pmt) {
          if (pusi) this.readPmt(b, o + 1 + b[o], end);
        } else if (pid === this.video) {
          if (pusi) this.flush();
          this.chunks.push(b.subarray(o, end));
          this.size += end - o;
        }
      }
      this.flush();
      const units = this.units.map((u) => ({ pts: u.pts, dts: u.dts, nals: splitNals(join(u.raw)) }));
      this.units = [];
      return units;
    }

    readPat(b, o, end) {
      const last = Math.min(o + 3 + (((b[o + 1] & 0x0f) << 8) | b[o + 2]) - 4, end);
      for (let j = o + 8; j + 4 <= last; j += 4) {
        if (((b[j] << 8) | b[j + 1]) !== 0) {
          this.pmt = ((b[j + 2] & 0x1f) << 8) | b[j + 3];
          return;
        }
      }
    }

    readPmt(b, o, end) {
      const last = Math.min(o + 3 + (((b[o + 1] & 0x0f) << 8) | b[o + 2]) - 4, end);
      let j = o + 12 + (((b[o + 10] & 0x0f) << 8) | b[o + 11]);
      while (j + 5 <= last) {
        const type = b[j];
        const pid = ((b[j + 1] & 0x1f) << 8) | b[j + 2];
        if (type === 0x1b) {
          this.video = pid;
          return;
        }
        j += 5 + (((b[j + 3] & 0x0f) << 8) | b[j + 4]);
      }
    }

    flush() {
      if (!this.size) return;
      const pes = join(this.chunks);
      this.chunks = [];
      this.size = 0;
      if (pes[0] !== 0 || pes[1] !== 0 || pes[2] !== 1) return;
      const flags = pes[7] >> 6;
      const payload = pes.subarray(9 + pes[8]);
      const prev = this.units[this.units.length - 1];
      const pts = flags & 2 ? readTs(pes, 9) : null;
      const dts = flags === 3 ? readTs(pes, 14) : pts;
      // frames over 64 KB arrive as several PES packets, either without a
      // timestamp or repeating it; the next one can start mid-NAL
      if (pts === null || (prev && prev.pts === pts && prev.dts === dts)) {
        if (prev) prev.raw.push(payload);
        return;
      }
      this.units.push({ pts, dts, raw: [payload] });
    }
  }

  function join(parts) {
    if (parts.length === 1) return parts[0];
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function readTs(b, o) {
    return (b[o] & 0x0e) * 536870912 + b[o + 1] * 4194304 + (b[o + 2] & 0xfe) * 16384 + b[o + 3] * 128 + (b[o + 4] >> 1);
  }

  // Annex B -> NAL units, start codes stripped.
  function splitNals(p) {
    const out = [];
    const n = p.length;
    let i = 0;
    let s = -1;
    const cut = (e) => {
      while (e > s && p[e - 1] === 0) e--;
      if (e > s) out.push(p.subarray(s, e));
    };
    while (i + 2 < n) {
      if (p[i + 2] > 1) { i += 3; continue; }
      if (p[i] === 0 && p[i + 1] === 0 && p[i + 2] === 1) {
        if (s >= 0) cut(i);
        i += 3;
        s = i;
      } else i++;
    }
    if (s >= 0) cut(n);
    return out;
  }

  const SAR = [null, [1, 1], [12, 11], [10, 11], [16, 11], [40, 33], [24, 11], [20, 11], [32, 11],
    [80, 33], [18, 11], [15, 11], [64, 33], [160, 99], [4, 3], [3, 2], [2, 1]];

  function unescape(nal) {
    const out = [];
    for (let i = 0; i < nal.length; i++) {
      if (i > 1 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
      out.push(nal[i]);
    }
    return new Uint8Array(out);
  }

  class Bits {
    constructor(b) { this.b = b; this.p = 0; }
    bit() {
      if (this.p >= this.b.length * 8) throw new Error('sps overrun');
      const v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1;
      this.p++;
      return v;
    }
    bits(n) { let v = 0; while (n--) v = v * 2 + this.bit(); return v; }
    ue() { let z = 0; while (!this.bit()) z++; return this.bits(z) + 2 ** z - 1; }
    se() { const v = this.ue(); return v & 1 ? (v + 1) / 2 : -v / 2; }
  }

  function parseSps(nal) {
    const r = new Bits(unescape(nal));
    r.bits(8);
    const profile = r.bits(8);
    r.bits(16);
    r.ue();
    let chroma = 1, depthY = 0, depthC = 0;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      chroma = r.ue();
      if (chroma === 3) r.bit();
      depthY = r.ue();
      depthC = r.ue();
      r.bit();
      if (r.bit()) {
        for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
          if (!r.bit()) continue;
          let last = 8, next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
            if (next !== 0) next = (last + r.se() + 256) % 256;
            if (next !== 0) last = next;
          }
        }
      }
    }
    r.ue();
    const poc = r.ue();
    if (poc === 0) r.ue();
    else if (poc === 1) {
      r.bit(); r.se(); r.se();
      for (let n = r.ue(); n > 0; n--) r.se();
    }
    r.ue();
    r.bit();
    const wMbs = r.ue() + 1;
    const hUnits = r.ue() + 1;
    const frameOnly = r.bit();
    if (!frameOnly) r.bit();
    r.bit();
    let cl = 0, cr = 0, ct = 0, cb = 0;
    if (r.bit()) { cl = r.ue(); cr = r.ue(); ct = r.ue(); cb = r.ue(); }
    let sar = [1, 1];
    if (r.bit() && r.bit()) {
      const idc = r.bits(8);
      if (idc === 255) sar = [r.bits(16), r.bits(16)];
      else if (SAR[idc]) sar = SAR[idc];
    }
    const cx = chroma === 0 || chroma === 3 ? 1 : 2;
    const cy = (chroma === 1 ? 2 : 1) * (2 - frameOnly);
    return {
      width: wMbs * 16 - cx * (cl + cr),
      height: (2 - frameOnly) * hUnits * 16 - cy * (ct + cb),
      sar, chroma, depthY, depthC,
    };
  }

  function config(sps, pps) {
    let info = { width: 0, height: 0, sar: [1, 1], chroma: 1, depthY: 0, depthC: 0 };
    try { info = parseSps(sps); } catch (e) { /* MSE reads the SPS itself; files fall back to 0x0 */ }
    const hex = (n) => n.toString(16).padStart(2, '0');
    return { sps, pps, codec: 'avc1.' + hex(sps[1]) + hex(sps[2]) + hex(sps[3]), profile: sps[1], ...info };
  }

  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  return { TS, config, same };
})();
