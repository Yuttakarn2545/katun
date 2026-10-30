import { createTestProject } from "./test-fixture";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPreset, ease, removeKeyframe, setKeyframe, valueAt } from "../packages/core/src/anim";
import { blankComponent, COMPONENT_TEMPLATES } from "../packages/core/src/componentTemplates";
import { layoutTimeline } from "../packages/core/src/layout";
import { loadProject, prepare } from "../packages/core/src/pipeline";
import { saveProject } from "../packages/core/src/projects";
import { renderStill } from "../packages/core/src/render";
import { LayerSchema, ProjectSchema, type Layer } from "../packages/core/src/schema";
import { ensureSfx, SFX, synthSfx, type SfxId } from "../packages/core/src/sfx";
import { readWav } from "../packages/core/src/wav";

// ทดสอบระบบคอมโพเนนต์: คีย์เฟรม, พรีเซต, การซ้อน, การวางในเรื่อง, SFX, pipeline และเรนเดอร์จริง
// รัน: npm run test:components

let failed = 0;
function check(cond: unknown, msg: string): void {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failed++;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---------- คีย์เฟรม ----------
const layer = LayerSchema.parse({ type: "text", x: 100, duration: 2 }) as Layer;
check(valueAt(layer, "x", 1) === 100, "ไม่มีคีย์เฟรม = ใช้ค่าคงที่ของเลเยอร์");
setKeyframe(layer, "x", 0, 0, "linear");
setKeyframe(layer, "x", 1, 200, "linear");
check(near(valueAt(layer, "x", 0.5), 100) && valueAt(layer, "x", -1) === 0 && valueAt(layer, "x", 5) === 200, "คีย์เฟรม linear: กลางทาง = ครึ่ง, ก่อน/หลังคีย์ = ค่าคีย์ขอบ");
setKeyframe(layer, "x", 1.005, 300);
check(layer.keyframes.x!.length === 2 && layer.keyframes.x![1].v === 300, "ใส่คีย์ห่างไม่เกิน 1/60 วิ = แก้คีย์เดิม ไม่สร้างซ้ำ");
removeKeyframe(layer, "x", 1);
removeKeyframe(layer, "x", 0);
check(layer.keyframes.x === undefined, "ลบคีย์สุดท้ายแล้ว prop กลับไปใช้ค่าคงที่");
check(ease("easeOut", 0.5) > 0.5 && ease("easeIn", 0.5) < 0.5 && near(ease("bounce", 1), 1) && ease("hold", 0.9) === 0, "easing: easeOut เร็วก่อน easeIn ช้าก่อน bounce จบที่ 1 hold ค้าง");

const pop = LayerSchema.parse({ type: "shape", scale: 1, duration: 3 }) as Layer;
applyPreset(pop, "popIn", 1920, 1080);
applyPreset(pop, "fadeOut", 1920, 1080);
check(valueAt(pop, "scale", 0) === 0 && near(valueAt(pop, "scale", 1.5), 1) && valueAt(pop, "opacity", 3) === 0 && near(valueAt(pop, "opacity", 1.5), 1), "พรีเซต popIn + fadeOut: เริ่มจาก 0 กลางเลเยอร์ปกติ จบจางหาย");

// ---------- schema: การซ้อนและการอ้างอิง ----------
const base = {
  title: "t",
  voice: { provider: "system", voice: "x" },
  characters: { a: { name: "A" } },
  scenes: [{ id: "s1", lines: [{ id: "l1", character: "a", text: "hello" }] }, { id: "s2", lines: [{ id: "l2", character: "a", text: "bye" }] }],
};
const cyc = ProjectSchema.safeParse({
  ...base,
  components: { A: { layers: [{ type: "component", component: "B" }] }, B: { layers: [{ type: "component", component: "A" }] } },
});
check(!cyc.success && cyc.error.issues.some((i) => i.message.includes("ซ้อนวน")), "คอมโพเนนต์ซ้อนวน A→B→A ถูกปฏิเสธ");
const nest = ProjectSchema.safeParse({ ...base, components: { A: { layers: [{ type: "component", component: "B" }] }, B: { layers: [] } } });
check(nest.success, "ซ้อนคอมโพเนนต์ปกติ (A มี B) ใช้ได้");
const badRef = ProjectSchema.safeParse({ ...base, components: { A: { layers: [{ type: "character", character: "zzz" }] } }, placements: [{ component: "nope", sceneId: "s1" }] });
check(!badRef.success && badRef.error.issues.length >= 2, "อ้างตัวละคร/คอมโพเนนต์ที่ไม่มี ถูกปฏิเสธ");

// ---------- เวลาในเรื่องหลัก ----------
const proj = ProjectSchema.parse({ ...base, components: { T: { duration: 2 } }, placements: [{ component: "T", sceneId: "s2", offset: 0.5 }, { component: "T", sceneId: "s2", offset: 10 }] });
const lay = layoutTimeline(proj, () => ({ audio: "", sourceDuration: 1, cues: [] }));
const s2 = lay.scenes[1];
check(near(lay.placements[0].start, s2.start + 0.5) && lay.placements[0].duration === 2, "การวางยึดกับฉาก: เวลาจริง = ต้นฉาก + offset, ความยาว = ความยาวคอมโพเนนต์");
check(near(lay.duration, s2.start + 12), "คอมโพเนนต์ที่เลยท้ายเรื่อง ทำให้เรื่องยาวพอแสดงจนจบ");

// ---------- SFX และเทมเพลต ----------
let sfxOk = true;
for (const id of Object.keys(SFX) as SfxId[]) {
  const x = synthSfx(id);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (!(x.length > 1000 && peak > 0.05 && x.every(Number.isFinite))) sfxOk = false;
}
check(sfxOk, `SFX ในตัวทั้ง ${Object.keys(SFX).length} เสียง สร้างได้และมีเสียงจริง`);
const dingA = synthSfx("ding");
const dingB = synthSfx("ding");
check(dingA.length === dingB.length && dingA.every((v, i) => v === dingB[i]), "SFX สร้างซ้ำได้ผลเหมือนเดิมทุกครั้ง");
let tplOk = true;
for (const t of COMPONENT_TEMPLATES) {
  const c = t.build((id) => `assets/sfx-${id}.wav`);
  if (!c.layers.length || !ProjectSchema.safeParse({ ...base, components: { x: c } }).success) tplOk = false;
}
check(tplOk, `เทมเพลตคอมโพเนนต์ทั้ง ${COMPONENT_TEMPLATES.length} แบบ ผ่าน schema`);

// ---------- pipeline + เรนเดอร์จริง ----------
const { dir, name, cleanup } = createTestProject("m4");
{
  const p = loadProject(dir);
  p.components.title = COMPONENT_TEMPLATES.find((t) => t.id === "title-pop")!.build((id) => ensureSfx(dir, id));
  const sticker = blankComponent("กล่องแดง", 400, 400);
  sticker.layers.push(LayerSchema.parse({ type: "shape", shape: "rect", x: 200, y: 200, w: 400, h: 400, fill: "#ff0000", radius: 0, duration: 3 }));
  p.components.sticker = sticker;
  p.components.title.layers.push(LayerSchema.parse({ type: "component", component: "sticker", x: 200, y: 200, start: 0, duration: 3 }));
  p.placements = [{ id: "pl1", component: "title", sceneId: p.scenes[0].id, offset: 0.2, x: 0.5, y: 0.5, scale: 1, opacity: 1, volume: 1, loop: false }];
  saveProject(name, p);
  const tl = await prepare(dir, () => {});
  check(tl.placements?.length === 1 && !!tl.components?.title && existsSync(join(dir, "build", "assets", "sfx-pop.wav")), "pipeline ส่งคอมโพเนนต์ให้ตัวเรนเดอร์ และคัดลอกไฟล์ SFX ไป build/");
  check(readWav(join(dir, "build", "assets", "sfx-pop.wav")).samples.length > 1000, "ไฟล์ SFX ใน build อ่านได้");

  // เฟรมกลางคอมโพเนนต์: กล่องสีแดง (คอมโพเนนต์ซ้อน) อยู่มุมซ้ายบนของคอมโพเนนต์ = มุมซ้ายบนของจอ
  const out = join(dir, "out", "comp.png");
  await renderStill(dir, Math.round((0.2 + 1.5) * tl.fps), out, 0.25);
  const png = readFileSync(out);
  check(png.subarray(1, 4).toString() === "PNG" && png.length > 5000, "เรนเดอร์เฟรมที่มีคอมโพเนนต์ (ฟอนต์ไทย + ซ้อน 2 ชั้น) สำเร็จ");
  cleanup();
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทุกข้อ");
process.exit(failed ? 1 : 0);
