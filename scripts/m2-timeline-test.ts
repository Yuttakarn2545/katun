import { createTestProject } from "./test-fixture";
import { join } from "node:path";
import { clipDuration, layoutTimeline } from "../packages/core/src/layout";
import { loadProject, prepare } from "../packages/core/src/pipeline";
import { saveProject } from "../packages/core/src/projects";
import { ProjectSchema, type Project } from "../packages/core/src/schema";
import { readWav, wavDuration } from "../packages/core/src/wav";
import { moveLineTo, setTrackState, trimLine } from "../packages/app/web/src/lib/ops";
import { computeLayout, useEditor } from "../packages/app/web/src/lib/store";

// ทดสอบตรรกะไทม์ไลน์ M2: layout, ย้าย/สลับลำดับ/เปลี่ยนคนพูด, ripple, ตัดหัวท้าย, สถานะแทร็ก และ pipeline ตัดเสียงจริง
// รัน: npx tsx scripts/m2-timeline-test.ts

let failed = 0;
function check(cond: unknown, msg: string): void {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failed++;
}
const near = (a: number, b: number, eps = 0.011) => Math.abs(a - b) < eps;

// ---------- 1) layout ----------
const base = ProjectSchema.parse({
  title: "t",
  voice: { provider: "system", voice: "x" },
  characters: { a: { name: "A" }, b: { name: "B" } },
  scenes: [
    { id: "s1", holdStart: 0.5, holdEnd: 0.5, lines: [{ id: "l1", character: "a", text: "one", pauseAfter: 0.2 }, { id: "l2", character: "b", text: "two", pauseAfter: 0.3 }] },
    { id: "s2", lines: [{ id: "l3", character: "a", text: "three" }] },
  ],
});
const durations: Record<string, number> = { l1: 2, l2: 3, l3: 1.5 };
const media = (l: { id: string }) => ({ audio: `audio/${l.id}.wav`, sourceDuration: durations[l.id], cues: [] });
let lay = layoutTimeline(base, media);
check(near(lay.lines[0].start, 0.5) && near(lay.lines[1].start, 2.7), "บรรทัดเริ่มหลัง holdStart และเว้น pauseAfter");
check(near(lay.scenes[0].duration, 0.5 + 2 + 0.2 + 3 + 0.5), "บรรทัดสุดท้ายของฉากไม่บวก pauseAfter ซ้ำกับ holdEnd");
check(near(lay.duration, 6.2 + 0.5 + 1.5 + 0.5), "ความยาวรวมถูกต้อง");
check(near(clipDuration({ trimStart: 0.5, trimEnd: 0.4 }, 2), 1.1) && near(clipDuration({ trimStart: 5, trimEnd: 5 }, 2), 0.1), "clipDuration ตัดได้และไม่ต่ำกว่า MIN_CLIP");

// ---------- 2) ops ในหน้าจอ (ใช้ store จริงแบบไม่ต้องมีเบราว์เซอร์) ----------
const timeline = { ...layoutTimeline(base, media), title: "t", fps: 30, width: 1920, height: 1080, subtitles: base.subtitles };
const reset = (ripple: boolean) => {
  useEditor.setState({ project: structuredClone(base), timeline, ripple, save: { status: "saved" } });
};
const L = () => computeLayout(useEditor.getState().project as Project, useEditor.getState().timeline).lines;
const byId = (id: string) => L().find((l) => l.id === id)!;
const order = () => (useEditor.getState().project as Project).scenes.map((s) => s.lines.map((l) => l.id).join(",")).join(" | ");

// ไม่ให้ store บันทึก/เตรียมเสียงจริงระหว่างทดสอบ
useEditor.setState({ flush: async () => true, prepareNow: async () => {} });

reset(true);
moveLineTo("l2", 4);
check(near(byId("l2").start, 4) && order() === "l1,l2 | l3", "ลากเลื่อนเวลาในตำแหน่งเดิม: คลิปเริ่มตรงจุดที่ปล่อย");
check(near(byId("l3").start, lay.lines[2].start + (4 - 2.7)), "ripple เปิด: คลิปถัดไปเลื่อนตาม");

reset(false);
moveLineTo("l2", 3.0); // เลื่อน 0.3 วิ ภายในช่องว่างท้ายฉาก (holdEnd 0.5)
check(near(byId("l2").start, 3.0) && near(byId("l3").start, lay.lines[2].start), "ripple ปิด: คลิปถัดไปอยู่ที่เดิม");

reset(false);
moveLineTo("l2", 4);
check(near(byId("l3").start, lay.lines[2].start + (4 - 2.7) - 0.5), "ripple ปิด แต่ลากเกินช่องว่าง: ดันคลิปถัดไปเท่าที่จำเป็น (ไม่ซ้อนกัน)");

reset(true);
moveLineTo("l2", 0.6);
check(order() === "l2,l1 | l3" && near(byId("l2").start, 0.6), "ลากข้ามคลิปก่อนหน้า: สลับลำดับแล้วเริ่มตรงจุดที่ปล่อย");

reset(true);
const dropAt = byId("l3").start + 0.2; // ปล่อยที่ครึ่งแรกของ l3 = แทรกก่อน l3
moveLineTo("l1", dropAt, "b");
check(
  order() === "l2 | l1,l3" && (useEditor.getState().project as Project).scenes[1].lines[0].character === "b" && near(byId("l1").start, dropAt),
  "ลากไปฉากถัดไป + เปลี่ยนแทร็กคนพูด: แทรกก่อนคลิปที่ปล่อยทับครึ่งแรก",
);

reset(true);
moveLineTo("l1", byId("l3").start + 1.2);
check(order() === "l2 | l3,l1", "ปล่อยที่ครึ่งหลังของคลิป: แทรกหลังคลิปนั้น");

reset(true);
const s2Start = timeline.scenes[1].start;
moveLineTo("l3", 0.6, "b");
check(
  order() === "l1,l2 | l3" && near(byId("l3").start, s2Start) && (useEditor.getState().project as Project).scenes[1].lines[0].character === "b",
  "บทเดียวของฉากลากเลยขอบ: อยู่ฉากเดิม ชิดต้นฉาก และยังเปลี่ยนคนพูดได้",
);

reset(true);
trimLine("l1", "end", 0.5);
check(near(byId("l1").duration, 1.5) && near(byId("l2").start, 2.2), "ตัดท้าย + ripple: คลิปถัดไปเลื่อนเข้ามา");

reset(false);
trimLine("l1", "start", 0.5);
check(near(byId("l1").start, 1.0) && near(byId("l2").start, 2.7), "ตัดหัว ripple ปิด: ขอบซ้ายตามเมาส์ คลิปถัดไปอยู่ที่เดิม");

reset(true);
trimLine("l1", "end", 99);
check(near(byId("l1").duration, 0.1), "ตัดเกินความยาว: เหลือขั้นต่ำ 0.1 วิ");

reset(true);
setTrackState("b", { solo: true });
const lay2 = layoutTimeline(useEditor.getState().project as Project, media);
check(lay2.lines.find((l) => l.id === "l1")!.muted && !lay2.lines.find((l) => l.id === "l2")!.muted, "ฟังเดี่ยวแทร็ก b: แทร็กอื่นถูกปิดเสียง");

const before = useEditor.getState().past.length;
useEditor.getState().undo();
check(!(useEditor.getState().project as Project).tracks.b?.solo && useEditor.getState().past.length === before - 1, "Undo ย้อนสถานะแทร็กได้");

// ---------- 3) pipeline ตัดเสียงจริง ----------
const { dir, name, cleanup } = createTestProject("m2");
{
  const p = loadProject(dir);
  const first = p.scenes[0].lines[0];
  first.trimStart = 0.3;
  first.trimEnd = 0.2;
  p.tracks = { mee: { muted: true, solo: false, locked: false, hidden: true, volume: 1 } };
  p.markers = [{ id: "m1", time: 1.5, label: "จุด" }];
  saveProject(name, p);
  const tl = await prepare(dir, () => {});
  const line = tl.lines.find((l) => l.id === first.id)!;
  const fileDur = wavDuration(readWav(join(dir, "build", line.audio)));
  check(line.audio.includes("-t300-200.wav"), "pipeline เขียนไฟล์เสียงที่ตัดแล้วแยกต่างหาก");
  check(near(fileDur, line.sourceDuration! - 0.5, 0.02) && near(line.duration, fileDur, 0.02), "ไฟล์ที่ตัดยาวเท่า source - ตัดหัว - ตัดท้าย");
  check(tl.lines.filter((l) => l.character === "mee").every((l) => l.muted) && tl.characters.mee.hidden, "แทร็กปิดเสียง/ซ่อน ถูกส่งไปตัวเรนเดอร์");
  check(loadProject(dir).markers[0]?.label === "จุด", "marker ถูกบันทึกใน project.json");
  cleanup();
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทุกข้อ");
process.exit(failed ? 1 : 0);
