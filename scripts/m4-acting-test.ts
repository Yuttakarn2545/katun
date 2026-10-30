import { createTestProject } from "./test-fixture";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { layoutTimeline } from "../packages/core/src/layout";
import { loadProject, prepare } from "../packages/core/src/pipeline";
import { saveProject } from "../packages/core/src/projects";
import { renderStill } from "../packages/core/src/render";
import { EMOTIONS, GESTURES, ProjectSchema, TRANSITIONS } from "../packages/core/src/schema";
import { karaokeWords } from "../packages/renderer/src/Video";

// ทดสอบ M4 การแสดง: อารมณ์ ท่าทาง กล้อง ทรานสิชัน ตำแหน่งตัวละคร สไตล์ซับ + คาราโอเกะ
// รัน: npm run test:acting   (ภาพตัวอย่างเก็บไว้ที่ projects/test-m4b-*/out/stills/ ถ้าใส่ --keep)

const keep = process.argv.includes("--keep");
let failed = 0;
function check(cond: unknown, msg: string): void {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failed++;
}

// ---------- คาราโอเกะ: ตัดคำไทย ----------
const words = karaokeWords("สวัสดีค่ะพี่หมี วันนี้อากาศดีมาก", 3);
check(words.length >= 5 && words.map((w) => w.text).join("") === "สวัสดีค่ะพี่หมี วันนี้อากาศดีมาก", `ตัดคำไทยได้ ${words.length} ช่วง และต่อกันได้ข้อความเดิม (${words.map((w) => w.text).join("|")})`);
check(words[0].start === 0 && Math.abs(words[words.length - 1].end - 3) < 1e-9 && words.every((w, i) => i === 0 || w.start === words[i - 1].end), "เวลาของคำเรียงต่อกันตั้งแต่ 0 ถึงความยาวบท");

// ---------- schema / layout ----------
const p0 = ProjectSchema.parse({
  title: "t",
  voice: { provider: "system", voice: "x" },
  characters: { a: { name: "A" } },
  scenes: [{ id: "s1", lines: [{ character: "a", text: "hi" }] }],
});
check(p0.scenes[0].lines[0].emotion === "neutral" && p0.scenes[0].transition.type === "fade" && p0.subtitles.style === "classic", "ค่าเริ่มต้น: อารมณ์ปกติ ทรานสิชันจาง ซับแบบกล่อง (โปรเจกต์เก่าเปิดได้ไม่ต้องแก้)");
const lay = layoutTimeline({ ...p0, scenes: [{ ...p0.scenes[0], autoFocus: true, layout: { a: { x: 0.3, scale: 1.2, facing: -1, enter: "pop" } }, lines: [{ ...p0.scenes[0].lines[0], emotion: "happy", gesture: "wave", camera: "punch" }] }] }, () => undefined);
check(lay.lines[0].emotion === "happy" && lay.lines[0].gesture === "wave" && lay.scenes[0].layout?.a.x === 0.3 && lay.scenes[0].autoFocus, "การแสดงและตำแหน่งตัวละครถูกส่งต่อให้ตัวเรนเดอร์");

// ---------- เรนเดอร์จริงทุกแบบ ----------
const { dir, name, cleanup } = createTestProject("m4b", keep);
{
  const p = loadProject(dir);
  const [l1, l2] = p.scenes[0].lines;
  Object.assign(l1, { emotion: "happy", gesture: "wave", camera: "punch" });
  Object.assign(l2, { emotion: "surprised", gesture: "jump", camera: "shake" });
  Object.assign(p.scenes[0], { autoFocus: true, layout: { nok: { x: 0.3, scale: 1, facing: 0, enter: "left" }, mee: { x: 0.72, scale: 1.15, facing: 0, enter: "pop" } } });
  Object.assign(p.scenes[1], { transition: { type: "iris", duration: 0.8 } });
  Object.assign(p.scenes[1].lines[0], { emotion: "laugh", gesture: "point" });
  p.subtitles = { ...p.subtitles, style: "bubble", karaoke: true, font: "Kanit" };
  saveProject(name, p);
  const tl = await prepare(dir, () => {});
  const out = join(dir, "out", "stills");
  mkdirSync(out, { recursive: true });
  const fps = tl.fps;
  const [a, b, c] = tl.lines;
  const shots: [string, number][] = [
    ["1-happy-wave-punch", a.start + 0.6],
    ["2-surprised-jump-shake", b.start + 0.25],
    ["3-iris-transition", tl.scenes[1].start + 0.4],
    ["4-laugh-point", c.start + c.duration * 0.6],
  ];
  let ok = true;
  for (const [name, t] of shots) {
    try {
      await renderStill(dir, Math.round(t * fps), join(out, `${name}.png`), 0.35);
    } catch (err) {
      ok = false;
      console.log(String(err).slice(0, 600));
    }
  }
  check(ok, "เรนเดอร์ภาพนิ่งทุกฉากทดสอบสำเร็จ (อารมณ์ ท่าทาง กล้อง ทรานสิชัน ซับฟองคำพูด + คาราโอเกะ)");

  // ลองทุกอารมณ์/ท่าทาง/ทรานสิชันรวมกันในเฟรมเดียว เพื่อให้แน่ใจว่าไม่มีค่าไหนทำให้เรนเดอร์พัง
  let all = true;
  for (let i = 0; i < Math.max(EMOTIONS.length, GESTURES.length, TRANSITIONS.length); i++) {
    const q = loadProject(dir);
    Object.assign(q.scenes[0].lines[0], { emotion: EMOTIONS[i % EMOTIONS.length], gesture: GESTURES[i % GESTURES.length] });
    q.scenes[0].transition = { type: TRANSITIONS[i % TRANSITIONS.length], duration: 0.4 };
    q.subtitles.style = (["classic", "minimal", "bold", "bubble"] as const)[i % 4];
    saveProject(name, q);
    const t2 = await prepare(dir, () => {});
    try {
      await renderStill(dir, Math.round((t2.lines[0].start + 0.3) * fps), join(out, `all-${i}.png`), 0.2);
    } catch (err) {
      all = false;
      console.log(`ชุดที่ ${i}:`, String(err).slice(0, 400));
    }
  }
  check(all, `ทุกอารมณ์ (${EMOTIONS.length}) ท่าทาง (${GESTURES.length}) ทรานสิชัน (${TRANSITIONS.length}) และสไตล์ซับ (4) เรนเดอร์ได้`);
  if (keep) {
    const scratch = process.env.KATUN_STILLS;
    if (scratch) for (const [n] of shots) copyFileSync(join(out, `${n}.png`), join(scratch, `${n}.png`));
  } else cleanup();
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทุกข้อ");
process.exit(failed ? 1 : 0);
