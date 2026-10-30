import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { biquad, filter } from "./dsp.js";
import { writeWav } from "./wav.js";

// คลัง SFX ในตัว: สังเคราะห์ด้วยโค้ดทั้งหมด จึงใช้ได้ทุกที่โดยไม่ติดลิขสิทธิ์
// ไฟล์ถูกสร้างครั้งแรกที่ใช้ลงใน assets/sfx-<id>.wav ของโปรเจกต์

const FS = 44100;

export const SFX = {
  pop: { name: "ป๊อป", desc: "เด้งออกมา ปรากฏตัว" },
  click: { name: "คลิก", desc: "กดปุ่ม เลือก" },
  ding: { name: "ติ๊ง", desc: "ถูกต้อง แจ้งเตือน" },
  chime: { name: "กริ๊ง", desc: "สำเร็จ ได้รางวัล" },
  whoosh: { name: "วูบ", desc: "เปลี่ยนฉาก เลื่อนผ่าน" },
  rise: { name: "วู้ดขึ้น", desc: "ลุ้น ก่อนเฉลย" },
  boing: { name: "เด้งดึ๋ง", desc: "ตลก กระโดด" },
  sparkle: { name: "วิ้ง", desc: "เวทมนตร์ ของใหม่" },
  thud: { name: "ตุ้บ", desc: "ตก ชน หนัก ๆ" },
  applause: { name: "ปรบมือ", desc: "ยินดี จบเรื่อง" },
} as const;
export type SfxId = keyof typeof SFX;

const env = (i: number, n: number, attack: number, decay: number) => {
  const t = i / FS;
  return Math.min(1, t / attack) * Math.exp(-t / decay) * (i < n ? 1 : 0);
};

let seed = 12345;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

export function synthSfx(id: SfxId): Float32Array {
  seed = 12345; // ผลเหมือนเดิมทุกครั้ง
  const make = (sec: number, fn: (i: number, t: number) => number) => {
    const n = Math.round(sec * FS);
    return Float32Array.from({ length: n }, (_, i) => fn(i, i / FS));
  };
  switch (id) {
    case "pop":
      return make(0.18, (i, t) => Math.sin(2 * Math.PI * (900 - 2600 * t) * t) * env(i, 1e9, 0.002, 0.035) * 0.9);
    case "click":
      return make(0.06, (i) => (noise() * 0.5 + Math.sin((2 * Math.PI * 2000 * i) / FS) * 0.5) * env(i, 1e9, 0.0005, 0.008));
    case "ding":
      return make(1.2, (i, t) => (Math.sin(2 * Math.PI * 1318.5 * t) + 0.4 * Math.sin(2 * Math.PI * 2637 * t)) * env(i, 1e9, 0.003, 0.35) * 0.55);
    case "chime":
      return make(1.4, (i, t) => {
        const a = Math.sin(2 * Math.PI * 1046.5 * t) * env(i, 1e9, 0.003, 0.3);
        const j = i - Math.round(0.12 * FS);
        const b = j > 0 ? Math.sin(2 * Math.PI * 1568 * (j / FS)) * env(j, 1e9, 0.003, 0.45) : 0;
        return (a + b) * 0.45;
      });
    case "whoosh": {
      const raw = make(0.7, () => noise());
      const out = new Float32Array(raw.length);
      // ฟิลเตอร์ band-pass ที่กวาดความถี่ขึ้นลง ทำทีละช่วงสั้น ๆ
      const block = 512;
      for (let s = 0; s < raw.length; s += block) {
        const t = s / raw.length;
        const f = 300 + 2500 * Math.sin(Math.PI * t);
        const seg = filter(raw.subarray(s, s + block), biquad("bandpass", f, FS, 1.2));
        for (let i = 0; i < seg.length; i++) out[s + i] = seg[i] * Math.sin(Math.PI * ((s + i) / raw.length)) * 1.4;
      }
      return out;
    }
    case "rise":
      return make(1.0, (i, t) => Math.sin(2 * Math.PI * (200 * t + 500 * t * t)) * (t / 1.0) * env(i, 1e9, 0.01, 10) * 0.5 * (t < 0.95 ? 1 : (1 - t) / 0.05));
    case "boing":
      return make(0.6, (i, t) => Math.sin(2 * Math.PI * (180 + 60 * Math.sin(2 * Math.PI * 14 * t)) * t) * env(i, 1e9, 0.002, 0.2) * 0.8);
    case "sparkle":
      return make(0.9, (i, t) => {
        let v = 0;
        for (let k = 0; k < 6; k++) {
          const onset = k * 0.09;
          if (t >= onset) v += Math.sin(2 * Math.PI * (2000 + k * 450) * (t - onset)) * Math.exp(-(t - onset) / 0.12);
        }
        return v * 0.18;
      });
    case "thud":
      return make(0.45, (i, t) => (Math.sin(2 * Math.PI * (90 - 60 * t) * t) * 0.9 + noise() * 0.15 * Math.exp(-t / 0.02)) * env(i, 1e9, 0.001, 0.12));
    case "applause": {
      // เสียงปรบมือ = เสียงรบกวนสั้น ๆ จำนวนมากที่ผ่าน band-pass
      const out = new Float32Array(Math.round(2.2 * FS));
      for (let c = 0; c < 260; c++) {
        const at = Math.floor(Math.abs(noise()) * (out.length - 3000));
        const amp = 0.3 + Math.abs(noise()) * 0.7;
        for (let i = 0; i < 1500; i++) out[at + i] += noise() * amp * Math.exp(-i / 200);
      }
      const shaped = filter(out, biquad("bandpass", 1600, FS, 0.7));
      const fade = (i: number) => Math.min(1, i / (0.2 * FS), (out.length - i) / (0.6 * FS));
      return shaped.map((v, i) => v * fade(i) * 0.5);
    }
  }
}

/** สร้างไฟล์ SFX ลง assets/ ของโปรเจกต์ (ถ้ายังไม่มี) แล้วคืน path ที่ใส่ในเลเยอร์เสียงได้ */
export function ensureSfx(projectDir: string, id: SfxId): string {
  if (!(id in SFX)) throw new Error(`ไม่มี SFX "${id}" (มี: ${Object.keys(SFX).join(", ")})`);
  const rel = `assets/sfx-${id}.wav`;
  const abs = join(projectDir, rel);
  if (!existsSync(abs)) {
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    const x = synthSfx(id);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    writeWav(abs, peak > 0 ? x.map((v) => (v / peak) * 0.89) : x, FS);
  }
  return rel;
}
