import type { AudioFx } from "./schema.js";

// engine ประมวลผลเสียงของคลิป (TypeScript ล้วน ไม่ต้องพึ่งโปรแกรมภายนอก)
// ใช้ตอนเตรียมเสียงทั้งสำหรับพรีวิวและไฟล์ที่ส่งออก จึงได้ยินเหมือนกันทุกที่
// ลำดับ: กลับด้าน → ลดเสียงรบกวน → ความเร็ว/ระดับเสียง → ตัดเสียงต่ำ/EQ → เสียงพิเศษ → คอมเพรสเซอร์ → echo → ห้องก้อง → ปรับความดัง → gain → fade

export const NEUTRAL_FX: AudioFx = {
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
  speed: 1,
  pitch: 0,
  reverse: false,
  denoise: 0,
  normalize: false,
  compressor: false,
  highpass: false,
  eq: { low: 0, mid: 0, high: 0 },
  voice: "none",
  echo: 0,
  reverb: "none",
};

export function isNeutralFx(fx: AudioFx | undefined): boolean {
  return !fx || JSON.stringify({ ...NEUTRAL_FX, ...fx, eq: { ...NEUTRAL_FX.eq, ...fx.eq } }) === JSON.stringify(NEUTRAL_FX);
}

/** ความยาวที่เปลี่ยนไปจากเอฟเฟกต์ (ไม่รวมหางเสียงก้อง) ใช้ประมาณในหน้าจอ */
export const fxLengthFactor = (fx: AudioFx | undefined) => 1 / (fx?.speed ?? 1);

export function processAudio(input: Float32Array, fs: number, fx: AudioFx): Float32Array {
  let x: Float32Array = Float32Array.from(input);
  if (fx.reverse) x.reverse();
  if (fx.denoise > 0) x = denoise(x, fs, fx.denoise);

  const pitchRatio = Math.pow(2, fx.pitch / 12);
  if (fx.pitch !== 0) x = resample(x, pitchRatio); // เสียงสูงขึ้น/ต่ำลง และสั้นลง/ยาวขึ้น
  const stretch = (fx.pitch !== 0 ? pitchRatio : 1) / fx.speed; // ชดเชยความยาวจาก pitch แล้วใส่ความเร็ว
  if (Math.abs(stretch - 1) > 0.005) x = timeStretch(x, fs, stretch);

  if (fx.highpass) x = chain(x, [biquad("highpass", 90, fs), biquad("highpass", 90, fs)]);
  if (fx.eq.low || fx.eq.mid || fx.eq.high) {
    x = chain(x, [biquad("lowshelf", 200, fs, 0.707, fx.eq.low), biquad("peaking", 1000, fs, 1, fx.eq.mid), biquad("highshelf", 4000, fs, 0.707, fx.eq.high)]);
  }
  if (fx.voice !== "none") x = voicePreset(x, fs, fx.voice);
  if (fx.compressor) x = compress(x, fs);
  if (fx.echo > 0) x = echo(x, fs, fx.echo);
  if (fx.reverb !== "none") x = reverb(x, fs, fx.reverb);
  if (fx.normalize) x = normalize(x, -20, fs);

  const g = fx.gain;
  const fi = Math.min(x.length, Math.round(fx.fadeIn * fs));
  const fo = Math.min(x.length, Math.round(fx.fadeOut * fs));
  for (let i = 0; i < x.length; i++) {
    let v = x[i] * g;
    if (i < fi) v *= i / fi;
    if (i >= x.length - fo) v *= (x.length - 1 - i) / fo;
    x[i] = Math.max(-1, Math.min(1, v));
  }
  return x;
}

// ---------- ฟิลเตอร์ (RBJ Audio EQ Cookbook) ----------

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };
type FilterType = "lowpass" | "highpass" | "bandpass" | "peaking" | "lowshelf" | "highshelf";

export function biquad(type: FilterType, f0: number, fs: number, q = 0.707, gainDb = 0): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * Math.min(f0, fs * 0.45)) / fs;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case "lowpass":
      [b0, b1, b2, a0, a1, a2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "highpass":
      [b0, b1, b2, a0, a1, a2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "bandpass":
      [b0, b1, b2, a0, a1, a2] = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "peaking":
      [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
      break;
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      [b0, b1, b2] = [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s)];
      [a0, a1, a2] = [A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
      break;
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      [b0, b1, b2] = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)];
      [a0, a1, a2] = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function filter(x: Float32Array, c: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

const chain = (x: Float32Array, filters: Biquad[]) => filters.reduce((acc, f) => filter(acc, f), x);

// ---------- เสียงพิเศษ ----------

const drive = (x: Float32Array, amount: number) => {
  const norm = Math.tanh(amount);
  return x.map((v) => Math.tanh(v * amount) / norm);
};

function voicePreset(x: Float32Array, fs: number, voice: AudioFx["voice"]): Float32Array {
  switch (voice) {
    case "radio":
      return drive(chain(x, [biquad("highpass", 400, fs), biquad("highpass", 400, fs), biquad("lowpass", 3000, fs), biquad("lowpass", 3000, fs)]), 2.5);
    case "phone":
      return drive(chain(x, [biquad("highpass", 500, fs), biquad("highpass", 500, fs), biquad("lowpass", 3400, fs), biquad("lowpass", 3400, fs), biquad("peaking", 1800, fs, 1, 4)]), 1.6);
    case "megaphone":
      return drive(chain(x, [biquad("highpass", 700, fs), biquad("lowpass", 4500, fs), biquad("peaking", 1500, fs, 0.8, 8)]), 4);
    case "underwater":
      return chain(x, [biquad("lowpass", 450, fs), biquad("lowpass", 450, fs), biquad("peaking", 250, fs, 1, 4)]);
    case "robot": {
      // ring modulation + เสียงสะท้อนสั้น ๆ แบบโลหะ
      const y = new Float32Array(x.length);
      const d = Math.round(fs * 0.012);
      for (let i = 0; i < x.length; i++) {
        const rm = x[i] * Math.sin((2 * Math.PI * 55 * i) / fs);
        y[i] = 0.75 * rm + 0.25 * x[i] + (i >= d ? 0.35 * y[i - d] : 0);
      }
      return y;
    }
    default:
      return x;
  }
}

// ---------- ไดนามิก ----------

export function compress(x: Float32Array, fs: number, thresholdDb = -24, ratio = 4, attack = 0.005, release = 0.08, makeupDb = 6): Float32Array {
  const a = Math.exp(-1 / (attack * fs));
  const r = Math.exp(-1 / (release * fs));
  const makeup = Math.pow(10, makeupDb / 20);
  const y = new Float32Array(x.length);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const level = Math.abs(x[i]);
    env = level > env ? a * env + (1 - a) * level : r * env + (1 - r) * level;
    const db = 20 * Math.log10(env + 1e-9);
    const over = db - thresholdDb;
    const gainDb = over > 0 ? -over * (1 - 1 / ratio) : 0;
    y[i] = x[i] * Math.pow(10, gainDb / 20) * makeup;
  }
  return y;
}

/** ปรับความดังคลิป: RMS ของช่วงที่มีเสียง = -20 dBFS แล้วจำกัด peak ไม่เกิน -1 dBFS */
export function normalize(x: Float32Array, targetDb = -20, fs = 24000): Float32Array {
  // คิด RMS เฉพาะช่วง 20ms ที่มีเสียง (ดังกว่า -50 dBFS) ไม่ให้ช่วงเงียบดึงค่าลง
  const win = Math.max(1, Math.round(fs * 0.02));
  const gate = Math.pow(10, -50 / 20);
  let sum = 0, n = 0, peak = 0;
  for (let s = 0; s < x.length; s += win) {
    let ws = 0;
    const e = Math.min(x.length, s + win);
    for (let i = s; i < e; i++) {
      ws += x[i] * x[i];
      peak = Math.max(peak, Math.abs(x[i]));
    }
    if (Math.sqrt(ws / (e - s)) > gate) {
      sum += ws;
      n += e - s;
    }
  }
  if (!n || peak === 0) return x;
  const rms = Math.sqrt(sum / n);
  const g = Math.min(Math.pow(10, targetDb / 20) / rms, Math.pow(10, -1 / 20) / peak);
  return x.map((v) => v * g);
}

// ---------- เวลา: echo, ห้องก้อง ----------

function echo(x: Float32Array, fs: number, amount: number): Float32Array {
  const delay = Math.round(fs * 0.28);
  const fb = 0.25 + 0.45 * amount;
  const repeats = Math.ceil(Math.log(0.01) / Math.log(fb));
  const y = new Float32Array(x.length + delay * repeats);
  y.set(x);
  const wet = new Float32Array(y.length);
  for (let i = delay; i < y.length; i++) wet[i] = (i - delay < x.length ? x[i - delay] : 0) + fb * wet[i - delay];
  for (let i = 0; i < y.length; i++) y[i] += wet[i] * 0.6 * amount;
  return y;
}

const REVERB_PARAMS = {
  room: { size: 0.7, damp: 0.5, wet: 0.22, tail: 0.6 },
  hall: { size: 0.84, damp: 0.3, wet: 0.3, tail: 1.6 },
  cave: { size: 0.93, damp: 0.15, wet: 0.38, tail: 2.6 },
} as const;

/** Freeverb (Schroeder/Moorer): comb 8 ตัวขนาน + allpass 4 ตัวต่อกัน */
function reverb(x: Float32Array, fs: number, kind: Exclude<AudioFx["reverb"], "none">): Float32Array {
  const p = REVERB_PARAMS[kind];
  const scale = fs / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ buf: new Float32Array(Math.round(n * scale)), i: 0, store: 0 }));
  const alls = [556, 441, 341, 225].map((n) => ({ buf: new Float32Array(Math.round(n * scale)), i: 0 }));
  const len = x.length + Math.round(p.tail * fs);
  const y = new Float32Array(len);
  for (let n = 0; n < len; n++) {
    const inp = (n < x.length ? x[n] : 0) * 0.015;
    let out = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - p.damp) + c.store * p.damp;
      c.buf[c.i] = inp + c.store * p.size;
      c.i = (c.i + 1) % c.buf.length;
      out += o;
    }
    for (const a of alls) {
      const b = a.buf[a.i];
      a.buf[a.i] = out + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      out = b - out;
    }
    y[n] = (n < x.length ? x[n] * (1 - p.wet * 0.5) : 0) + out * p.wet * 3;
  }
  return y;
}

// ---------- ความเร็ว/ระดับเสียง ----------

/** เปลี่ยนอัตราสุ่มแบบ linear: ratio > 1 = สั้นลงและเสียงสูงขึ้น */
export function resample(x: Float32Array, ratio: number): Float32Array {
  const n = Math.max(1, Math.floor(x.length / ratio));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const f = p - j;
    y[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return y;
}

/**
 * ยืด/หดเวลาโดยระดับเสียงไม่เปลี่ยน (WSOLA)
 * factor > 1 = ยาวขึ้น (ช้าลง), factor < 1 = สั้นลง (เร็วขึ้น)
 */
export function timeStretch(x: Float32Array, fs: number, factor: number): Float32Array {
  const N = 2 * Math.round(fs * 0.02); // เฟรม ~40ms
  const Hs = N / 2;
  const Ha = Hs / factor;
  const tol = Math.round(N / 4);
  if (x.length < N * 2) return resample(x, 1 / factor);
  const outLen = Math.round(x.length * factor);
  const y = new Float32Array(outLen + N);
  const wsum = new Float32Array(outLen + N);
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const at = (i: number) => (i >= 0 && i < x.length ? x[i] : 0);

  let prev = 0;
  for (let m = 0; m * Hs < outLen; m++) {
    const target = Math.round(m * Ha);
    let best = target;
    if (m > 0) {
      // หา offset ที่รูปคลื่นต่อจากเฟรมก่อนหน้าได้เนียนที่สุด (cross-correlation แบบข้ามทีละ 2)
      const natural = prev + Hs;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const s = target + d;
        let score = 0;
        for (let i = 0; i < N; i += 2) score += at(s + i) * at(natural + i);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    }
    const o = m * Hs;
    for (let i = 0; i < N && o + i < y.length; i++) {
      y[o + i] += at(best + i) * w[i];
      wsum[o + i] += w[i];
    }
    prev = best;
  }
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = wsum[i] > 1e-3 ? y[i] / wsum[i] : 0;
  return out;
}

// ---------- ลดเสียงรบกวน (spectral gating) ----------

function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

/**
 * ลดเสียงรบกวนคงที่ (พัดลม แอร์ เสียงซ่า): ประเมินโปรไฟล์เสียงรบกวนจากช่วงที่เงียบที่สุดของคลิป
 * แล้วกดความดังในแต่ละย่านความถี่ที่ไม่สูงกว่าเสียงรบกวน
 */
export function denoise(x: Float32Array, fs: number, strength: number): Float32Array {
  const N = 1024;
  const hop = 256;
  if (x.length < N * 4) return x;
  const frames = Math.floor((x.length - N) / hop) + 1;
  const bins = N / 2 + 1;
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const specRe: Float64Array[] = [];
  const specIm: Float64Array[] = [];
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[f * hop + i] * win[i];
    fft(re, im);
    specRe.push(re);
    specIm.push(im);
    for (let k = 0; k < bins; k++) energy[f] += re[k] * re[k] + im[k] * im[k];
  }
  // โปรไฟล์เสียงรบกวน = ค่าเฉลี่ยของ 10% เฟรมที่เงียบที่สุด
  const quiet = [...energy.keys()].sort((a, b) => energy[a] - energy[b]).slice(0, Math.max(3, Math.round(frames * 0.1)));
  const noise = new Float64Array(bins);
  for (const f of quiet) for (let k = 0; k < bins; k++) noise[k] += Math.hypot(specRe[f][k], specIm[f][k]) / quiet.length;

  const over = 1.5 + 2.5 * strength;
  const floor = 0.02 + 0.3 * (1 - strength);
  const prevGain = new Float64Array(bins).fill(1);
  const y = new Float64Array(x.length);
  const norm = new Float64Array(x.length);
  for (let f = 0; f < frames; f++) {
    const re = specRe[f], im = specIm[f];
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]) + 1e-12;
      const g0 = Math.max(floor, 1 - (over * noise[k]) / mag);
      // ปรับ gain นุ่ม ๆ ตามเวลา ลดเสียง "ฟองน้ำ" (musical noise)
      const g = g0 > prevGain[k] ? g0 : 0.6 * prevGain[k] + 0.4 * g0;
      prevGain[k] = g;
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) {
      y[f * hop + i] += re[i] * win[i];
      norm[f * hop + i] += win[i] * win[i];
    }
  }
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = norm[i] > 1e-6 ? y[i] / norm[i] : x[i] * floor;
  return out;
}
