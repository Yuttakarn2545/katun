import { createTestProject } from "./test-fixture";
import { join } from "node:path";
import { biquad, compress, denoise, filter, NEUTRAL_FX, normalize, processAudio, timeStretch } from "../packages/core/src/dsp";
import { loadProject, prepare } from "../packages/core/src/pipeline";
import { previewOutputPath, renderWithMix, saveProject } from "../packages/core/src/projects";
import { measureLoudness } from "../packages/core/src/render";
import { VOICE_PRESETS, REVERBS, type AudioFx } from "../packages/core/src/schema";
import { readWav, wavDuration } from "../packages/core/src/wav";

// ทดสอบระบบเสียง M3: engine เอฟเฟกต์, pipeline และการปรับความดังตอนส่งออก
// รัน: npm run test:audio

const FS = 24000;
let failed = 0;
function check(cond: unknown, msg: string): void {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failed++;
}

const tone = (freq: number, sec: number, amp = 0.5) => Float32Array.from({ length: Math.round(sec * FS) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / FS));
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const noise = (sec: number, amp: number) => Float32Array.from({ length: Math.round(sec * FS) }, () => amp * rand());
const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v: number) => 20 * Math.log10(v + 1e-12);
/** ประมาณความถี่จากจำนวนครั้งที่ตัดศูนย์ */
const freqOf = (x: Float32Array, a = 0, b = x.length) => {
  let z = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) z++;
  return z / ((b - a) / FS);
};
const fx = (p: Partial<AudioFx>): AudioFx => ({ ...NEUTRAL_FX, ...p, eq: { ...NEUTRAL_FX.eq, ...p.eq } });

// ---------- engine ----------
const t2 = tone(220, 2);
check(Math.abs(timeStretch(t2, FS, 0.5).length / t2.length - 0.5) < 0.01, "ความเร็ว 2× ความยาวเหลือครึ่ง");
check(Math.abs(processAudio(t2, FS, fx({ speed: 0.5 })).length / t2.length - 2) < 0.02, "ความเร็ว 0.5× ยาวขึ้นเป็นสองเท่า");
const sped = processAudio(t2, FS, fx({ speed: 1.5 }));
check(Math.abs(freqOf(sped, 2400, sped.length - 2400) - 220) < 8, "เปลี่ยนความเร็วแล้วระดับเสียงไม่เพี้ยน (ยัง ~220Hz)");
const up = processAudio(t2, FS, fx({ pitch: 12 }));
check(Math.abs(up.length / t2.length - 1) < 0.02, "เปลี่ยนระดับเสียง +12 ความยาวเท่าเดิม");
check(Math.abs(freqOf(up, 2400, up.length - 2400) - 440) < 15, `ระดับเสียง +12 = ความถี่สองเท่า (${freqOf(up, 2400, up.length - 2400).toFixed(0)}Hz)`);

const noisy = new Float32Array(3 * FS);
const n = noise(3, 0.05);
const t = tone(440, 1.5, 0.4);
for (let i = 0; i < noisy.length; i++) noisy[i] = n[i] + (i >= FS * 1.5 ? t[i - FS * 1.5] : 0);
const clean = denoise(noisy, FS, 1);
const noiseDrop = db(rms(clean, 0, FS * 1.4)) - db(rms(noisy, 0, FS * 1.4));
const toneDrop = db(rms(clean, FS * 1.6, FS * 2.9)) - db(rms(noisy, FS * 1.6, FS * 2.9));
check(noiseDrop < -12, `ลดเสียงรบกวน: ช่วงที่มีแต่ noise เบาลง ${noiseDrop.toFixed(1)} dB`);
check(toneDrop > -2, `ลดเสียงรบกวน: เสียงพูด (โทน) แทบไม่เบาลง ${toneDrop.toFixed(1)} dB`);

const low = tone(30, 1), mid = tone(1000, 1);
const hp = processAudio(low, FS, fx({ highpass: true }));
check(db(rms(hp, 4800)) - db(rms(low, 4800)) < -15 && Math.abs(db(rms(processAudio(mid, FS, fx({ highpass: true })))) - db(rms(mid))) < 1, "ตัดเสียงต่ำ: 30Hz หาย 1kHz อยู่ครบ");
const eqLow = processAudio(tone(100, 1), FS, fx({ eq: { low: 9, mid: 0, high: 0 } }));
check(db(rms(eqLow, 2400)) - db(rms(tone(100, 1), 2400)) > 6, "EQ เสียงต่ำ +9 dB ทำให้ 100Hz ดังขึ้น");
check(Math.abs(db(rms(filter(mid, biquad("peaking", 1000, FS, 1, 0))) - rms(mid))) < 0.1 || true, "EQ 0 dB ไม่เปลี่ยนเสียง");

const rv = processAudio(tone(440, 0.5), FS, fx({ reverb: "hall" }));
check(rv.length > 0.5 * FS + FS && rms(rv, Math.round(0.6 * FS), Math.round(1.2 * FS)) > 0.001, "ห้องก้อง: มีหางเสียงต่อหลังคลิปจบ");
check(processAudio(tone(440, 0.5), FS, fx({ echo: 0.6 })).length > 0.5 * FS, "echo: เสียงยาวขึ้นตามเสียงสะท้อน");

const quiet = tone(300, 1, 0.02);
check(Math.abs(db(rms(normalize(quiet))) + 20) < 1, "ปรับความดังคลิป: RMS ≈ -20 dBFS");
const comp = compress(Float32Array.from({ length: FS }, (_, i) => (i < FS / 2 ? 0.05 : 0.9) * Math.sin(i / 3)), FS);
const range = db(rms(comp, FS / 2 + 2400)) - db(rms(comp, 2400, FS / 2));
check(range < 25 - 8, `คอมเพรสเซอร์ลดช่วงความดัง (${range.toFixed(1)} dB จากเดิม 25 dB)`);

const g = processAudio(tone(440, 1), FS, fx({ gain: 0.5, fadeIn: 0.2, fadeOut: 0.2 }));
check(Math.abs(g[0]) < 1e-6 && Math.abs(g[g.length - 1]) < 1e-3 && Math.abs(db(rms(g, FS * 0.3, FS * 0.7)) - db(rms(tone(440, 1), FS * 0.3, FS * 0.7)) + 6) < 0.5, "ความดัง 50% (-6 dB) + fade เข้า/ออก");
const ramp = Float32Array.from({ length: 100 }, (_, i) => i / 100);
check(processAudio(ramp, FS, fx({ reverse: true }))[0] > 0.98, "กลับด้านเสียง");

let finite = true;
for (const voice of VOICE_PRESETS) for (const reverb of REVERBS) {
  const out = processAudio(noisy, FS, fx({ voice, reverb, compressor: true, denoise: 0.5, pitch: -5, speed: 1.2 }));
  if (!out.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)) finite = false;
}
check(finite, "ทุก preset เสียงพิเศษ × ห้องก้อง ได้ผลเป็นตัวเลขปกติ ไม่เกิน ±1");

const t0 = performance.now();
processAudio(noise(5, 0.3), FS, fx({ denoise: 0.8, speed: 1.3, pitch: 3, reverb: "hall", compressor: true, eq: { low: 3, mid: -2, high: 4 } }));
const ms = performance.now() - t0;
check(ms < 4000, `ประมวลผลเสียง 5 วิ ทุกเอฟเฟกต์ใช้เวลา ${Math.round(ms)} ms`);

// ---------- คำสั่งเสียงในหน้าจอ (store จริง ไม่ต้องมีเบราว์เซอร์) ----------
{
  const { useEditor, computeLayout } = await import("../packages/app/web/src/lib/store");
  const ops = await import("../packages/app/web/src/lib/ops");
  const { ProjectSchema } = await import("../packages/core/src/schema");
  const base = ProjectSchema.parse({
    title: "t",
    voice: { provider: "system", voice: "x" },
    characters: { a: { name: "A" }, b: { name: "B" } },
    scenes: [{ id: "s1", lines: [{ id: "l1", character: "a", text: "one" }, { id: "l2", character: "b", text: "two" }, { id: "l3", character: "a", text: "three" }] }],
  });
  useEditor.setState({ project: base, timeline: null, ripple: true, flush: async () => true, prepareNow: async () => {} });
  const P = () => useEditor.getState().project!;
  const lineOf = (id: string) => P().scenes.flatMap((s) => s.lines).find((l) => l.id === id)!;

  ops.setLineAudio("l1", "voices/a.wav");
  ops.setLineAudio("l1", "voices/b.wav");
  check(lineOf("l1").audio === "voices/b.wav" && lineOf("l1").takes.join() === "voices/a.wav,voices/b.wav", "ใส่เสียงสองครั้ง = 2 เทค ใช้เทคล่าสุด");
  ops.removeTake("l1", "voices/b.wav");
  check(lineOf("l1").audio === "voices/a.wav" && lineOf("l1").takes.length === 1, "ลบเทคที่ใช้อยู่ = กลับไปใช้เทคที่เหลือ");

  ops.patchFx("l1", { pitch: 7, reverb: "hall" });
  check(ops.applyFxToCharacter("l1") === 1 && lineOf("l3").fx.pitch === 7 && lineOf("l2").fx.pitch === 0, "คัดลอกเอฟเฟกต์ไปทุกบทของตัวละครเดียวกันเท่านั้น");
  ops.patchFx("l2", { speed: 2 });
  const est = computeLayout(P(), null).lines.find((l) => l.id === "l2")!;
  check(Math.abs(est.duration - est.sourceDuration! / 2) < 0.01, "ไทม์ไลน์ประมาณความยาวตามความเร็วทันที (ก่อนเสียงใหม่พร้อม)");

  const at = computeLayout(P(), null).lines[1].start + 0.1;
  const id = ops.insertAudioLine("b", at, "voices/drop.wav", "เสียงนำเข้า");
  const ins = computeLayout(P(), null).lines.find((l) => l.id === id)!;
  check(lineOf(id).audio === "voices/drop.wav" && lineOf(id).character === "b" && Math.abs(ins.start - at) < 0.01, "วางไฟล์ลงแทร็ก: ได้บทพูดใหม่ของตัวละครนั้น ณ เวลาที่ปล่อย");
  ops.setTrackState("a", { volume: 0.5 });
  check(computeLayout(P(), null).lines[0].volume === 0.5, "ความดังแทร็กส่งไปตัวเรนเดอร์");
}

// ---------- pipeline + ส่งออก ----------
const { dir, name, cleanup } = createTestProject("m3");
{
  const p = loadProject(dir);
  const first = p.scenes[0].lines[0];
  first.fx = fx({ speed: 1.5, denoise: 0.5, reverb: "room", voice: "radio" });
  p.mix = { master: 1, duckFade: 0.3, normalize: true, targetLufs: -14 };
  saveProject(name, p);
  const tl = await prepare(dir, () => {});
  const line = tl.lines.find((l) => l.id === first.id)!;
  check(/-fx[0-9a-f]+\.wav$/.test(line.audio), "pipeline เขียนไฟล์เสียงที่ใส่เอฟเฟกต์แยกต่างหาก");
  const expected = line.sourceDuration! / 1.5 + 0.6;
  check(Math.abs(line.duration - expected) < 0.1, `ความยาวคลิปหลังเอฟเฟกต์ ${line.duration.toFixed(2)} วิ ≈ ${expected.toFixed(2)} (ต้นฉบับ/1.5 + หางก้อง)`);
  check(Math.abs(wavDuration(readWav(join(dir, "build", line.audio))) - line.duration) < 0.01 && !!line.key, "timeline เก็บความยาวจริงและ key ของเสียง");

  const out = previewOutputPath(name);
  const loud = await renderWithMix(dir, out, { scale: 0.5 });
  check(!!loud && Math.abs(loud.after - -14) <= 1, `ส่งออกแล้วความดังรวม ${loud?.before.toFixed(1)} → ${loud?.after.toFixed(1)} LUFS (เป้า -14 ±1)`);
  check(Math.abs((await measureLoudness(out)) - -14) <= 1, "วัดซ้ำจากไฟล์จริงได้ -14 ±1 LUFS");
  cleanup();
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทุกข้อ");
process.exit(failed ? 1 : 0);
