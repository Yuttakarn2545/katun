import { createTestProject } from "./test-fixture";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { aiConfigured, scriptToProject, writeScript } from "../packages/core/src/ai";
import { exportBundle, importBundle, readZip, writeZip } from "../packages/core/src/bundle";
import { loadProject, prepare } from "../packages/core/src/pipeline";
import { cancelJob, exportOutputPath, getJob, listJobs, renderOptionsFor, saveProject, startExport, type RenderJob } from "../packages/core/src/projects";
import { measureLoudness } from "../packages/core/src/render";
import { ProjectSchema } from "../packages/core/src/schema";

// ทดสอบ M5: zip/.katun, ส่งออกทุกรูปแบบผ่านคิว, ยกเลิกงาน, ซับ VTT และตัวแปลงบทจาก AI
// รัน: npm run test:export

const ROOT = resolve(import.meta.dirname, "..");
let failed = 0;
function check(cond: unknown, msg: string): void {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failed++;
}
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---------- zip ----------
const bin = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
const zip = writeZip([
  { name: "project.json", data: Buffer.from('{"a":1}') },
  { name: "voices/เสียงอัด.wav", data: bin },
]);
const back = readZip(zip);
check(back.length === 2 && back[1].name === "voices/เสียงอัด.wav" && back[1].data.equals(bin), "zip: เขียนแล้วอ่านกลับได้ครบ (ไฟล์ binary + ชื่อไฟล์ไทย)");
const broken = Buffer.from(zip);
broken[30 + "project.json".length + 2] ^= 0xff; // ทำข้อมูลไฟล์แรกเสีย (หลัง local header 30 ไบต์ + ชื่อไฟล์)
check(throws(() => readZip(broken)), "zip: ไฟล์เสียหายถูกตรวจพบ (CRC)");
for (const bad of ["../evil.txt", "C:/Windows/x", "/abs/x", "a/../../b"]) {
  check(throws(() => readZip(writeZip([{ name: bad, data: Buffer.from("x") }]))), `zip: ปฏิเสธ path อันตราย ${bad}`);
}

// ---------- ตัวแปลงบทจาก AI (ไม่เรียก API จริง) ----------
const proj = scriptToProject(
  {
    title: "ทดสอบ",
    characters: [
      { id: "nok", name: "น้องนก", gender: "female" },
      { id: "mee", name: "พี่หมี", gender: "male" },
    ],
    scenes: [
      { id: "s1", background: "garden", lines: [{ character: "nok", text: "สวัสดี", emotion: "happy", gesture: "wave" }, { character: "ghost", text: "ใครเอ่ย", emotion: "surprised", gesture: "none" }] },
      { id: "empty", background: "sky", lines: [] },
    ],
  },
  "9:16",
);
const parsed = ProjectSchema.safeParse(proj);
check(parsed.success && parsed.data.scenes.length === 1 && parsed.data.scenes[0].lines[1].character === "nok" && parsed.data.scenes[0].lines[0].emotion === "happy", "AI: บทที่ได้แปลงเป็นโปรเจกต์ที่ถูกต้อง (ตัดฉากว่าง แก้ตัวละครที่ไม่มีอยู่)");
{
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalToken = process.env.ANTHROPIC_AUTH_TOKEN;
  let msg = "";
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    check(!aiConfigured(), "AI: จำลองสถานะไม่มี key โดยไม่เรียกบริการภายนอก");
    await writeScript({ topic: "x" }).catch((e: Error) => (msg = e.message));
  } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = originalToken;
  }
  check(msg.includes("API key"), "AI: ไม่มี key ได้ข้อความบอกให้ใส่ key (ไม่พัง)");
}

// ---------- ชื่อไฟล์และตัวเลือกเรนเดอร์ ----------
check(renderOptionsFor({ format: "gif", resolution: "4k", quality: "high" }).scale === 0.5, "GIF ย่อไม่เกินครึ่งแม้เลือก 4K");
check(renderOptionsFor({ format: "webm", resolution: "720p", quality: "draft" }).codec === "vp8", "WebM ใช้ codec vp8");

// ---------- .katun + ส่งออกจริง ----------
const { dir, name, cleanup } = createTestProject("m5");
{
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "logo.png"), bin);
  const p = loadProject(dir);
  p.title = "ทดสอบส่งออก";
  saveProject(name, p);

  // .katun: ส่งออกแล้วนำเข้าเป็นโปรเจกต์ใหม่
  const bundle = exportBundle(name);
  const entries = readZip(bundle).map((e) => e.name);
  check(entries.includes("katun.json") && entries.includes("project.json") && entries.includes("assets/logo.png") && !entries.some((n) => n.startsWith("build/") || n.startsWith("out/")), ".katun มี manifest + project + สื่อ และไม่รวม build/ out/");
  const imported = importBundle(bundle, name);
  const impDir = join(ROOT, "projects", imported.name);
  check(imported.name !== name && JSON.stringify(loadProject(impDir)) === JSON.stringify(loadProject(dir)) && readFileSync(join(impDir, "assets", "logo.png")).equals(bin), "นำเข้า .katun: ได้โปรเจกต์ใหม่ (ชื่อไม่ชนของเดิม) เนื้อหาเหมือนเดิมทุกไฟล์");
  rmSync(impDir, { recursive: true, force: true });
  check(throws(() => importBundle(writeZip([{ name: "project.json", data: Buffer.from("{}") }]))), "ไฟล์ zip ที่ไม่ใช่ .katun ถูกปฏิเสธ");

  const tl = await prepare(dir, () => {});
  const vtt = join(dir, "out", `${name}.vtt`);
  check(existsSync(vtt) && readFileSync(vtt, "utf8").startsWith("WEBVTT") && readFileSync(vtt, "utf8").includes("-->"), "เตรียมเสียงแล้วได้ซับ .vtt");

  // ส่งออกหลายรูปแบบพร้อมกัน: ต้องทำทีละงาน
  const opts = [
    { format: "mp4", resolution: "720p", quality: "draft", fps: 24 },
    { format: "webm", resolution: "preview", quality: "draft" },
    { format: "gif", resolution: "preview", quality: "draft" },
    { format: "mp3", resolution: "1080p", quality: "standard" },
    { format: "wav", resolution: "1080p", quality: "standard" },
  ] as const;
  const jobs: RenderJob[] = opts.map((o) => startExport(name, o));
  let maxRunning = 0;
  for (let i = 0; i < 1200 && jobs.some((j) => j.status === "queued" || j.status === "running"); i++) {
    maxRunning = Math.max(maxRunning, listJobs().filter((j) => j.status === "running").length);
    await new Promise((r) => setTimeout(r, 250));
  }
  check(maxRunning === 1, "คิว: เรนเดอร์ทีละงาน");
  for (const j of jobs) if (j.status !== "done") console.log(`  ${j.options.format}: ${j.status} ${j.error?.slice(0, 300) ?? ""}`);
  check(jobs.every((j) => j.status === "done"), "ส่งออกครบทั้ง 5 รูปแบบ");

  const magic = (f: string, n = 12) => (existsSync(f) ? readFileSync(f).subarray(0, n) : Buffer.alloc(0));
  const [mp4, webm, gif, mp3, wav] = jobs.map((j) => j.output);
  check(magic(mp4).subarray(4, 8).toString() === "ftyp", "MP4 เป็นไฟล์ MP4 จริง");
  check(magic(webm).readUInt32BE(0) === 0x1a45dfa3, "WebM เป็นไฟล์ WebM (EBML) จริง");
  check(magic(gif).subarray(0, 4).toString() === "GIF8", "GIF เป็นไฟล์ GIF จริง");
  check(magic(mp3).subarray(0, 3).toString() === "ID3" || (magic(mp3)[0] === 0xff && (magic(mp3)[1] & 0xe0) === 0xe0), "MP3 เป็นไฟล์ MP3 จริง");
  check(magic(wav).subarray(0, 4).toString() === "RIFF", "WAV เป็นไฟล์ WAV จริง");

  const probe = spawnSync(process.execPath, [join(ROOT, "node_modules/@remotion/cli/remotion-cli.js"), "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", mp4], { encoding: "utf8" });
  check(/1280,720,24\/1/.test(probe.stdout), `MP4 720p ที่ 24fps (${probe.stdout.trim()})`);
  check(Math.abs((await measureLoudness(mp3)) - -14) <= 1, "MP3 ปรับความดังแล้ว -14 ±1 LUFS");
  check(exportOutputPath(name, { format: "mp3", resolution: "1080p", quality: "standard" }).endsWith(`${name}-audio.mp3`), "ตั้งชื่อไฟล์ตามรูปแบบ");

  // ยกเลิก: งานที่กำลังทำ และงานที่ยังรอคิว
  const a = startExport(name, { format: "mp4", resolution: "1080p", quality: "high" });
  const b = startExport(name, { format: "webm", resolution: "1080p", quality: "high" });
  for (let i = 0; i < 400 && a.status !== "running"; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1500));
  cancelJob(b.id);
  cancelJob(a.id);
  for (let i = 0; i < 300 && (getJob(a.id)!.status === "running" || getJob(b.id)!.status === "running"); i++) await new Promise((r) => setTimeout(r, 100));
  check(getJob(a.id)!.status === "canceled" && getJob(b.id)!.status === "canceled", "ยกเลิกงานที่กำลังเรนเดอร์และงานที่รอคิวได้");
  check(!existsSync(join(dir, "build")) || !readFileSync(join(dir, "build", "timeline.json"), "utf8").includes('"fps": 24'), "ตัวเลือก fps ของงานส่งออกไม่ไปแก้ timeline หลัก");
  void tl;
  cleanup();
}

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทุกข้อ");
process.exit(failed ? 1 : 0);
