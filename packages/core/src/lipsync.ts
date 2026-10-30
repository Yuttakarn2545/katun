import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MouthCue, MouthShape } from "./schema.js";
import { readWav, wavDuration } from "./wav.js";

// หารูปปากตามเวลา: ใช้ Rhubarb ถ้ามี ไม่มีก็ใช้ความดังของเสียง (ใช้ได้กับทุกภาษารวมถึงไทย)

export function findRhubarb(root: string): string | undefined {
  const candidates = [process.env.RHUBARB_PATH, join(root, "tools", "rhubarb", "rhubarb.exe"), join(root, "tools", "rhubarb", "rhubarb")];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

export function mouthCues(wavPath: string, rhubarb: string | undefined): MouthCue[] {
  return rhubarb ? rhubarbCues(wavPath, rhubarb) : amplitudeCues(wavPath);
}

function rhubarbCues(wavPath: string, rhubarb: string): MouthCue[] {
  // phonetic recognizer ไม่ผูกกับภาษาอังกฤษ จึงใช้กับเสียงไทยได้
  const out = execFileSync(rhubarb, ["-f", "json", "-r", "phonetic", "--extendedShapes", "GHX", "--quiet", wavPath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const json = JSON.parse(out) as { mouthCues: MouthCue[] };
  return json.mouthCues;
}

const WINDOW = 0.04; // วินาที

function amplitudeCues(wavPath: string): MouthCue[] {
  const wav = readWav(wavPath);
  const step = Math.max(1, Math.round(wav.sampleRate * WINDOW));
  const rms: number[] = [];
  for (let i = 0; i < wav.samples.length; i += step) {
    let sum = 0;
    const end = Math.min(i + step, wav.samples.length);
    for (let j = i; j < end; j++) sum += wav.samples[j] * wav.samples[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }
  // ใช้เปอร์เซ็นไทล์ 95 เป็นระดับ "ดังสุด" เพื่อไม่ให้เสียงพีคตัวเดียวทำให้ปากแคบทั้งไฟล์
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;

  const shapes: MouthShape[] = rms.map((v) => {
    const level = v / loud;
    if (level < 0.12) return "X";
    if (level < 0.3) return "B";
    if (level < 0.6) return "C";
    return "D";
  });

  // ปากที่ค้างรูปเดิมนาน ๆ ดูแข็ง สลับ C/D กับ E/B บ้างให้ดูเป็นธรรมชาติ
  for (let i = 1; i < shapes.length; i++) {
    if (shapes[i] === shapes[i - 1] && i % 3 === 0) {
      if (shapes[i] === "D") shapes[i] = "C";
      else if (shapes[i] === "C") shapes[i] = "E";
    }
  }

  const cues: MouthCue[] = [];
  const total = wavDuration(wav);
  shapes.forEach((value, i) => {
    const start = i * WINDOW;
    const end = Math.min(total, start + WINDOW);
    const last = cues[cues.length - 1];
    if (last && last.value === value) last.end = end;
    else cues.push({ start, end, value });
  });
  return cues;
}
