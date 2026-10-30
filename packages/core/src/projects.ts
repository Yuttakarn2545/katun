import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadProject, outputPath, ROOT } from "./pipeline.js";
import { Canceled, normalizeLoudness, renderStill, renderVideo, type Progress, type RenderOptions } from "./render.js";
import { ProjectSchema, type Project, type Timeline } from "./schema.js";
import { TEMPLATES } from "./templates.js";
import { readWav, wavDuration } from "./wav.js";

// งานจัดการโปรเจกต์ที่ทั้งโปรแกรม (app), MCP server และ CLI ใช้ร่วมกัน

export const PROJECTS = join(ROOT, "projects");

export const ProjectName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, "ใช้ได้เฉพาะ a-z 0-9 - _ (ไม่เกิน 64 ตัว)")
  .describe("ชื่อโฟลเดอร์โปรเจกต์ใน projects/ เช่น my-story");

export function projectDir(name: string): string {
  ProjectName.parse(name);
  return join(PROJECTS, name);
}

export function requireProject(name: string): string {
  const dir = projectDir(name);
  if (!existsSync(join(dir, "project.json"))) throw new Error(`ไม่มีโปรเจกต์ "${name}"`);
  return dir;
}

export function validateProject(data: unknown): Project {
  const parsed = ProjectSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return parsed.data;
}

export function saveProject(name: string, data: unknown): Project {
  const project = validateProject(data);
  const dir = projectDir(name);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  project.meta = { ...project.meta, createdAt: project.meta.createdAt ?? now, updatedAt: now };
  writeFileSync(join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n");
  return project;
}

export function readTimeline(dir: string): Timeline | undefined {
  const file = join(dir, "build", "timeline.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Timeline) : undefined;
}

export type ProjectSummary = {
  project: string;
  title: string;
  format?: string;
  valid: boolean;
  prepared: boolean;
  durationSeconds?: number;
  video?: string;
  previewVideo?: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnail?: string; // path ใน out/ ถ้ามี
  firstBackground?: string; // ใช้วาดภาพย่อชั่วคราวเมื่อยังไม่มี thumbnail
  colors?: string[];
};

export function thumbnailPath(dir: string): string {
  return join(dir, "out", "thumbnail.png");
}

function summarize(n: string): ProjectSummary {
  const dir = join(PROJECTS, n);
  const summary: ProjectSummary = { project: n, title: n, valid: true, prepared: false };
  try {
    const p = loadProject(dir);
    Object.assign(summary, {
      title: p.title,
      format: p.format,
      createdAt: p.meta.createdAt ?? statSync(join(dir, "project.json")).birthtime.toISOString(),
      updatedAt: p.meta.updatedAt ?? statSync(join(dir, "project.json")).mtime.toISOString(),
      firstBackground: p.scenes[0]?.background,
      colors: Object.values(p.characters).map((c) => c.color),
    });
  } catch {
    summary.valid = false;
  }
  const timeline = readTimeline(dir);
  const preview = previewOutputPath(n);
  if (timeline) {
    summary.prepared = true;
    summary.durationSeconds = Number(timeline.duration.toFixed(1));
  }
  if (existsSync(outputPath(dir))) summary.video = outputPath(dir);
  if (existsSync(preview)) summary.previewVideo = preview;
  if (existsSync(thumbnailPath(dir))) summary.thumbnail = thumbnailPath(dir);
  return summary;
}

export function listProjects(): ProjectSummary[] {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS)
    .filter((n) => ProjectName.safeParse(n).success && existsSync(join(PROJECTS, n, "project.json")))
    .map(summarize)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function previewOutputPath(name: string): string {
  return join(projectDir(name), "out", `${name}-preview.mp4`);
}

/** ชื่อโฟลเดอร์อัตโนมัติ เช่น p-20261029-k3f9 ผู้ใช้ไม่ต้องตั้งเอง */
export function createProjectName(): string {
  return autoName();
}

function autoName(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  let name: string;
  do name = `p-${date}-${Math.random().toString(36).slice(2, 6)}`;
  while (existsSync(join(PROJECTS, name)));
  return name;
}

/** สร้างโปรเจกต์ใหม่จากเทมเพลต (ไม่ระบุชื่อโฟลเดอร์ = ตั้งให้อัตโนมัติ) */
export function createProject(opts: {
  name?: string;
  title: string;
  format?: Project["format"];
  template?: string;
}): { name: string; project: Project } {
  const name = opts.name ?? autoName();
  if (existsSync(join(projectDir(name), "project.json"))) throw new Error(`มีโปรเจกต์ "${name}" อยู่แล้ว`);
  const template = TEMPLATES.find((t) => t.id === (opts.template ?? "blank"));
  if (!template) throw new Error(`ไม่มีเทมเพลต "${opts.template}" (มี: ${TEMPLATES.map((t) => t.id).join(", ")})`);
  const azure = !!process.env.AZURE_SPEECH_KEY;
  const project = saveProject(name, {
    ...template.build(),
    title: opts.title,
    format: opts.format ?? template.format,
    fps: 30,
    meta: { template: template.id },
    voice: azure
      ? { provider: "azure", voice: "th-TH-PremwadeeNeural" }
      : { provider: "system", voice: "Microsoft Zira Desktop" },
  });
  return { name, project };
}

/** ทำสำเนาโปรเจกต์ (ไม่รวม build/ และ out/ ซึ่งสร้างใหม่ได้) */
export function duplicateProject(name: string): { name: string; project: Project } {
  const src = requireProject(name);
  const copy = autoName();
  const dest = join(PROJECTS, copy);
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => !/[\\/](build|out)([\\/]|$)/.test(p.slice(src.length)) && !/backup\.json$/.test(p),
  });
  const p = loadProject(dest);
  p.title = `${p.title} (สำเนา)`;
  p.meta = { template: p.meta.template };
  return { name: copy, project: saveProject(copy, p) };
}

/** ภาพย่อสำหรับหน้าแรก: เฟรมกลางบทพูดแรก ย่อ 1/4 (ต้อง prepare ก่อน) */
export async function generateThumbnail(name: string): Promise<string | undefined> {
  const dir = requireProject(name);
  const timeline = readTimeline(dir);
  if (!timeline) return undefined;
  const first = timeline.lines[0];
  const t = first ? first.start + first.duration / 2 : 0;
  const frame = Math.min(Math.max(0, Math.ceil(timeline.duration * timeline.fps) - 1), Math.round(t * timeline.fps));
  const out = thumbnailPath(dir);
  await renderStill(dir, frame, out, timeline.width > timeline.height ? 0.25 : 0.3);
  return out;
}

// ถังขยะ: ย้ายไป projects/.trash/<ชื่อ>__<เวลา> กู้คืนได้ ลบถาวรอัตโนมัติเมื่อครบ 30 วัน

const TRASH = join(PROJECTS, ".trash");
const TRASH_DAYS = 30;

export type TrashItem = { id: string; project: string; title: string; deletedAt: string };

export function trashProject(name: string): void {
  const dir = requireProject(name);
  mkdirSync(TRASH, { recursive: true });
  renameSync(dir, join(TRASH, `${name}__${Date.now()}`));
}

export function listTrash(): TrashItem[] {
  if (!existsSync(TRASH)) return [];
  const items: TrashItem[] = [];
  for (const id of readdirSync(TRASH)) {
    const m = /^(.+)__(\d+)$/.exec(id);
    if (!m) continue;
    const deleted = Number(m[2]);
    if (Date.now() - deleted > TRASH_DAYS * 86400000) {
      rmSync(join(TRASH, id), { recursive: true, force: true });
      continue;
    }
    let title = m[1];
    try {
      title = (JSON.parse(readFileSync(join(TRASH, id, "project.json"), "utf8")) as { title: string }).title;
    } catch {
      // project.json เสีย ก็ยังกู้คืนโฟลเดอร์ได้
    }
    items.push({ id, project: m[1], title, deletedAt: new Date(deleted).toISOString() });
  }
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function restoreProject(id: string): string {
  const m = /^([a-z0-9][a-z0-9_-]{0,63})__(\d+)$/i.exec(id);
  if (!m || !existsSync(join(TRASH, id))) throw new Error("ไม่พบรายการนี้ในถังขยะ");
  const name = existsSync(join(PROJECTS, m[1])) ? autoName() : m[1];
  renameSync(join(TRASH, id), join(PROJECTS, name));
  return name;
}

export function purgeTrashItem(id: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}__\d+$/i.test(id) || !existsSync(join(TRASH, id))) throw new Error("ไม่พบรายการนี้ในถังขยะ");
  rmSync(join(TRASH, id), { recursive: true, force: true });
}

/**
 * ช่องลงเสียง: เก็บไฟล์ WAV ลง voices/ ของโปรเจกต์ แล้วคืน path ที่ใส่ใน lines[].audio ได้
 * ตั้งชื่อตามเนื้อไฟล์ ไฟล์เดียวกันอัปโหลดซ้ำจะได้ path เดิม
 */
export function storeVoice(name: string, wav: Buffer): { path: string; duration: number } {
  const dir = requireProject(name);
  mkdirSync(join(dir, "voices"), { recursive: true });
  const rel = `voices/${createHash("sha1").update(wav).digest("hex").slice(0, 16)}.wav`;
  const abs = join(dir, rel);
  writeFileSync(abs, wav);
  try {
    return { path: rel, duration: wavDuration(readWav(abs)) };
  } catch (err) {
    throw new Error(`ไฟล์เสียงใช้ไม่ได้: ${err instanceof Error ? err.message : err}`);
  }
}

export const ASSET_TYPES = { image: ["png", "jpg", "jpeg", "webp"], music: ["mp3", "wav", "m4a", "ogg"] } as const;

/** เก็บภาพพื้นหลังหรือเพลงลง assets/ ของโปรเจกต์ แล้วคืน path ที่ใส่ใน project.json ได้ */
export function storeAsset(name: string, data: Buffer, ext: string): string {
  const dir = requireProject(name);
  const e = ext.toLowerCase().replace(/^\./, "");
  const allowed: readonly string[] = [...ASSET_TYPES.image, ...ASSET_TYPES.music];
  if (!allowed.includes(e)) throw new Error(`รองรับเฉพาะไฟล์ ${allowed.join(", ")}`);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const rel = `assets/${createHash("sha1").update(data).digest("hex").slice(0, 16)}.${e}`;
  writeFileSync(join(dir, rel), data);
  return rel;
}

// ---------- ส่งออก: ตัวเลือก + คิวงาน (ทีละงาน เพราะการเรนเดอร์ใช้ CPU เต็มเครื่อง) ----------

export const ExportOptionsSchema = z.object({
  format: z.enum(["mp4", "webm", "gif", "mp3", "wav"]).default("mp4"),
  // preview = ครึ่งความละเอียด (เร็ว), ที่เหลือเทียบด้านสั้นของวิดีโอ 1080
  resolution: z.enum(["preview", "720p", "1080p", "4k"]).default("1080p"),
  quality: z.enum(["draft", "standard", "high"]).default("standard"),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).optional(), // ไม่ใส่ = ตามโปรเจกต์
  subtitles: z.boolean().optional(), // ฝังซับในภาพ (ไม่ใส่ = ตามโปรเจกต์)
  normalize: z.boolean().optional(), // ปรับความดังมาตรฐาน (ไม่ใส่ = ตามมิกซ์ของโปรเจกต์)
});
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

const RES_SCALE = { preview: 0.5, "720p": 2 / 3, "1080p": 1, "4k": 2 } as const;
const CRF = { mp4: { draft: 28, standard: 20, high: 15 }, webm: { draft: 40, standard: 28, high: 18 } } as const;
const EXT = { mp4: "mp4", webm: "webm", gif: "gif", mp3: "mp3", wav: "wav" } as const;

export function exportOutputPath(name: string, o: ExportOptions): string {
  const dir = projectDir(name);
  // ไฟล์จริงมาตรฐาน (MP4 1080p) ใช้ชื่อเดิม เพื่อให้ปุ่มเปิด/ป้าย "ส่งออกแล้ว" ยังทำงานเหมือนเดิม
  if (o.format === "mp4" && o.resolution === "1080p" && !o.fps) return outputPath(dir);
  if (o.format === "mp4" && o.resolution === "preview") return previewOutputPath(name);
  const audioOnly = o.format === "mp3" || o.format === "wav";
  const tag = audioOnly ? "audio" : `${o.resolution}${o.fps ? `-${o.fps}fps` : ""}`;
  return join(dir, "out", `${name}-${tag}.${EXT[o.format]}`);
}

export type RenderJob = {
  id: string;
  project: string;
  options: ExportOptions;
  quality: "preview" | "final"; // ไว้ให้เครื่องมือเก่าอ่าน
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress?: Progress;
  output: string;
  error?: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  stage?: "render" | "loudness";
  loudness?: { before: number; after: number; target: number };
  abort: AbortController;
};

const jobs = new Map<string, RenderJob>();
let pumping = false;

/** เรนเดอร์แล้วปรับความดังรวมตามค่ามิกซ์ของโปรเจกต์ (ใช้ทั้งงานเบื้องหลังและ CLI) */
export async function renderWithMix(
  dir: string,
  output: string,
  opts: RenderOptions & { onStage?: (s: "render" | "loudness") => void; normalize?: boolean } = {},
): Promise<{ before: number; after: number; target: number } | undefined> {
  opts.onStage?.("render");
  await renderVideo(dir, output, opts);
  const mix = loadProject(dir).mix;
  if (!(opts.normalize ?? mix.normalize) || opts.codec === "gif") return undefined;
  opts.onStage?.("loudness");
  return { ...(await normalizeLoudness(output, mix.targetLufs, opts.signal)), target: mix.targetLufs };
}

export function renderOptionsFor(o: ExportOptions): RenderOptions {
  switch (o.format) {
    case "gif":
      // GIF ใหญ่มาก: ย่อไม่เกินครึ่ง และเก็บทุก 2 เฟรม
      return { codec: "gif", scale: Math.min(RES_SCALE[o.resolution], 0.5), everyNthFrame: 2, override: { fps: o.fps, subtitles: o.subtitles } };
    case "mp3":
    case "wav":
      return { codec: o.format, override: { fps: o.fps } };
    default:
      return {
        codec: o.format === "webm" ? "vp8" : "h264",
        scale: RES_SCALE[o.resolution],
        crf: CRF[o.format][o.quality],
        override: { fps: o.fps, subtitles: o.subtitles },
      };
  }
}

/** เพิ่มงานส่งออกเข้าคิว (งานเดิมของโปรเจกต์+ตัวเลือกเดียวกันที่ยังไม่เสร็จ = คืนงานเดิม) */
export function startExport(name: string, input: Partial<ExportOptions> = {}): RenderJob {
  const dir = requireProject(name);
  if (!readTimeline(dir)) throw new Error("ยังไม่ได้เตรียมเสียง (prepare) ของโปรเจกต์นี้");
  const options = ExportOptionsSchema.parse(input);
  const output = exportOutputPath(name, options);
  const same = [...jobs.values()].find((j) => j.output === output && (j.status === "queued" || j.status === "running"));
  if (same) return same;
  const job: RenderJob = {
    id: randomUUID().slice(0, 8),
    project: name,
    options,
    quality: options.resolution === "preview" ? "preview" : "final",
    status: "queued",
    output,
    queuedAt: Date.now(),
    abort: new AbortController(),
  };
  jobs.set(job.id, job);
  void pump();
  return job;
}

/** ทางลัดของเครื่องมือเดิม: preview = MP4 ครึ่งความละเอียด, final = MP4 1080p */
export function startRender(name: string, quality: "preview" | "final"): RenderJob {
  return startExport(name, { format: "mp4", resolution: quality === "preview" ? "preview" : "1080p" });
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const job = [...jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.queuedAt - b.queuedAt)[0];
      if (!job) break;
      job.status = "running";
      job.startedAt = Date.now();
      try {
        job.loudness = await renderWithMix(projectDir(job.project), job.output, {
          ...renderOptionsFor(job.options),
          normalize: job.options.normalize,
          signal: job.abort.signal,
          onProgress: (p) => (job.progress = p),
          onStage: (s) => (job.stage = s),
        });
        job.status = "done";
      } catch (err) {
        job.status = err instanceof Canceled ? "canceled" : "failed";
        if (job.status === "failed") job.error = err instanceof Error ? err.message : String(err);
      } finally {
        job.finishedAt = Date.now();
      }
    }
  } finally {
    pumping = false;
  }
}

export function cancelJob(id: string): RenderJob {
  const job = jobs.get(id);
  if (!job) throw new Error(`ไม่พบงาน ${id}`);
  if (job.status === "queued") {
    job.status = "canceled";
    job.finishedAt = Date.now();
  } else if (job.status === "running") job.abort.abort();
  return job;
}

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id);
}

export function listJobs(): RenderJob[] {
  return [...jobs.values()].sort((a, b) => b.queuedAt - a.queuedAt);
}

export function jobView(job: RenderJob) {
  const queued = [...jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.queuedAt - b.queuedAt);
  return {
    job_id: job.id,
    project: job.project,
    options: job.options,
    quality: job.quality,
    status: job.status,
    queuePosition: job.status === "queued" ? queued.indexOf(job) + 1 : undefined,
    rendered: job.progress?.rendered,
    total: job.progress?.total,
    elapsedSeconds: job.startedAt ? Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000) : 0,
    output: job.status === "done" ? job.output : undefined,
    error: job.error,
    stage: job.stage,
    loudness: job.loudness,
  };
}
