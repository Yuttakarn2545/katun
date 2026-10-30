import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  CLAUDE_CODE_COMMAND,
  claudeCodeStatus,
  claudeDesktopStatus,
  connectClaudeCode,
  connectClaudeDesktop,
  disconnectClaudeDesktop,
  doctor,
  getSettings,
  installRhubarb,
  MCP_ENTRY,
  updateSettings,
} from "../../core/src/integrations.js";
import { loadProject, outputPath, prepare, ROOT, srtPath } from "../../core/src/pipeline.js";
import {
  createProject,
  duplicateProject,
  generateThumbnail,
  getJob,
  jobView,
  listProjects,
  listTrash,
  previewOutputPath,
  projectDir,
  purgeTrashItem,
  readTimeline,
  requireProject,
  restoreProject,
  saveProject,
  startRender,
  startExport,
  cancelJob,
  listJobs,
  createProjectName,
  ExportOptionsSchema,
  type ExportOptions,
  type RenderJob,
  storeAsset,
  storeVoice,
  thumbnailPath,
  trashProject,
} from "../../core/src/projects.js";
import { renderStill } from "../../core/src/render.js";
import { VoiceSchema } from "../../core/src/schema.js";
import { TEMPLATES } from "../../core/src/templates.js";
import { aiConfigured, directLines, REWRITE_MODES, rewriteLines, scriptToProject, writeScript, type RewriteMode } from "../../core/src/ai.js";
import { exportBundle, importBundle } from "../../core/src/bundle.js";
import { COMPONENT_TEMPLATES } from "../../core/src/componentTemplates.js";
import { ensureSfx, SFX, type SfxId } from "../../core/src/sfx.js";
import { synthesize } from "../../core/src/tts.js";
import { checkMcpHealth } from "../../core/src/mcpHealth.js";
import { syncAppSession, acknowledgeAppCommand } from "../../core/src/appBridge.js";
import { VOICES } from "../../core/src/voices.js";
import { readWav, wavDuration } from "../../core/src/wav.js";

// โปรแกรมหลัก: web server ในเครื่อง (127.0.0.1 เท่านั้น) + หน้าจอ React ที่ build ไว้ใน packages/app/dist

export const DIST = resolve(import.meta.dirname, "..", "dist");
const CACHE = join(ROOT, ".cache", "tts-preview");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".webm": "video/webm",
  ".gif": "image/gif",
  ".katun": "application/zip",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 100 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "ไฟล์ใหญ่เกินไป");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req, 5 * 1024 * 1024);
  try {
    return (body.length ? JSON.parse(body.toString("utf8")) : {}) as T;
  } catch {
    throw new HttpError(400, "JSON ไม่ถูกต้อง");
  }
}

/** ส่งไฟล์ในโฟลเดอร์ base เท่านั้น รองรับ Range เพื่อให้เลื่อนวิดีโอ/เสียงได้ */
function serveFile(req: IncomingMessage, res: ServerResponse, base: string, rel: string): void {
  const abs = normalize(join(base, decodeURIComponent(rel)));
  if (!abs.startsWith(base + sep) || !existsSync(abs) || !statSync(abs).isFile()) {
    throw new HttpError(404, "ไม่พบไฟล์");
  }
  const size = statSync(abs).size;
  const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start < 0) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  createReadStream(abs).pipe(res);
}

function fileUrl(project: string, abs: string): string {
  const rel = abs.slice(projectDir(project).length + 1).split(sep).join("/");
  return `/files/${project}/${rel}?v=${Date.now()}`;
}

function openPath(target: string): void {
  if (process.platform === "win32") spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void> | void;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, pattern: RegExp, handler: Handler) => routes.push({ method, pattern, handler });

const NAME = "([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})";

// สร้างภาพย่อเบื้องหลัง ทีละโปรเจกต์ ไม่ให้ซ้อนกัน
const thumbnailing = new Set<string>();
function refreshThumbnail(name: string): void {
  const thumb = thumbnailPath(projectDir(name));
  // โปรแกรมเตรียมเสียงอัตโนมัติบ่อย จึงสร้างภาพย่อใหม่อย่างมากนาทีละครั้ง
  if (thumbnailing.has(name) || (existsSync(thumb) && Date.now() - statSync(thumb).mtimeMs < 60000)) return;
  thumbnailing.add(name);
  generateThumbnail(name)
    .catch((err: unknown) => console.error(`สร้างภาพย่อ ${name} ไม่สำเร็จ:`, err instanceof Error ? err.message : err))
    .finally(() => thumbnailing.delete(name));
}

route("GET", /^\/api\/projects$/, (_q, res) =>
  send(
    res,
    200,
    listProjects().map((p) => ({
      ...p,
      thumbnailUrl: p.thumbnail ? fileUrl(p.project, p.thumbnail) : undefined,
      exported: !!p.video,
    })),
  ),
);

route("GET", /^\/api\/templates$/, (_q, res) =>
  send(res, 200, TEMPLATES.map(({ id, name, description, format }) => ({ id, name, description, format }))),
);

route("POST", /^\/api\/projects$/, async (req, res) => {
  const { title, format, template } = await readJson<{ title?: string; format?: "16:9" | "9:16" | "1:1"; template?: string }>(req);
  const created = createProject({ title: title?.trim() || "เรื่องใหม่", format, template });
  send(res, 201, { name: created.name });
});

route("POST", new RegExp(`^/api/projects/${NAME}/duplicate$`), (_q, res, [name]) => {
  send(res, 201, { name: duplicateProject(name).name });
});

route("POST", new RegExp(`^/api/projects/${NAME}/rename$`), async (req, res, [name]) => {
  const { title } = await readJson<{ title?: string }>(req);
  if (!title?.trim()) throw new HttpError(400, "ใส่ชื่อเรื่องก่อน");
  const p = loadProject(requireProject(name));
  p.title = title.trim();
  send(res, 200, saveProject(name, p));
});

route("DELETE", new RegExp(`^/api/projects/${NAME}$`), (_q, res, [name]) => {
  trashProject(name);
  send(res, 200, { ok: true });
});

route("GET", /^\/api\/trash$/, (_q, res) => send(res, 200, listTrash()));
route("POST", /^\/api\/trash\/([a-zA-Z0-9_-]+)\/restore$/, (_q, res, [id]) => send(res, 200, { name: restoreProject(id) }));
route("DELETE", /^\/api\/trash\/([a-zA-Z0-9_-]+)$/, (_q, res, [id]) => {
  purgeTrashItem(id);
  send(res, 200, { ok: true });
});

route("GET", new RegExp(`^/api/projects/${NAME}$`), (_q, res, [name]) => {
  const dir = requireProject(name);
  const timeline = readTimeline(dir);
  const video = outputPath(dir);
  const preview = previewOutputPath(name);
  const srt = srtPath(dir);
  send(res, 200, {
    project: loadProject(dir),
    timeline,
    assetBase: `/files/${name}/build`,
    videoUrl: existsSync(video) ? fileUrl(name, video) : undefined,
    previewUrl: existsSync(preview) ? fileUrl(name, preview) : undefined,
    srtUrl: existsSync(srt) ? fileUrl(name, srt) : undefined,
  });
});

route("PUT", new RegExp(`^/api/projects/${NAME}$`), async (req, res, [name]) => {
  requireProject(name);
  const { project, expectedUpdatedAt } = await readJson<{ project: unknown; expectedUpdatedAt?: string }>(req);
  if (expectedUpdatedAt !== undefined && loadProject(requireProject(name)).meta.updatedAt !== expectedUpdatedAt) {
    throw new HttpError(409, "โปรเจกต์ถูกแก้จาก MCP หรืออีกหน้าต่างแล้ว กรุณาเปิดโปรเจกต์ใหม่ก่อนแก้ต่อ เพื่อไม่บันทึกทับงานล่าสุด");
  }
  send(res, 200, saveProject(name, project));
});

route("POST", new RegExp(`^/api/projects/${NAME}/voice$`), async (req, res, [name]) => {
  send(res, 201, storeVoice(name, await readBody(req)));
});

// waveform ของคลิป: ค่า peak 100 จุดต่อวินาที (cache ตามไฟล์ เพราะชื่อไฟล์ใน build/ เปลี่ยนเมื่อเสียงเปลี่ยน)
const peaksCache = new Map<string, { peaks: number[]; duration: number }>();
route("GET", new RegExp(`^/api/projects/${NAME}/peaks$`), (req, res, [name]) => {
  const audio = new URL(req.url ?? "", "http://x").searchParams.get("audio") ?? "";
  if (!/^audio\/[a-zA-Z0-9_.-]+\.wav$/.test(audio)) throw new HttpError(400, "path เสียงไม่ถูกต้อง");
  const file = join(requireProject(name), "build", audio);
  const key = `${name}/${audio}`;
  let hit = peaksCache.get(key);
  if (!hit) {
    if (!existsSync(file)) throw new HttpError(404, "ไม่พบไฟล์เสียง");
    const wav = readWav(file);
    const step = Math.max(1, Math.round(wav.sampleRate / 100));
    const peaks: number[] = [];
    for (let i = 0; i < wav.samples.length; i += step) {
      let p = 0;
      for (let j = i; j < Math.min(i + step, wav.samples.length); j++) p = Math.max(p, Math.abs(wav.samples[j]));
      peaks.push(Math.round(p * 1000) / 1000);
    }
    hit = { peaks, duration: wavDuration(wav) };
    if (peaksCache.size > 300) peaksCache.delete(peaksCache.keys().next().value!);
    peaksCache.set(key, hit);
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=3600" });
  res.end(JSON.stringify(hit));
});

// ตรึงเสียง TTS ที่สร้างแล้วเป็นไฟล์เสียงของโปรเจกต์ (ใช้ตอนแยกคลิป เพื่อให้สองส่วนใช้เสียงเดิมแล้วตัดคนละช่วง)
route("POST", new RegExp(`^/api/projects/${NAME}/freeze$`), async (req, res, [name]) => {
  const { audio } = await readJson<{ audio?: string }>(req);
  if (!audio || !/^audio\/[a-zA-Z0-9_.-]+\.wav$/.test(audio)) throw new HttpError(400, "path เสียงไม่ถูกต้อง");
  const src = join(requireProject(name), "build", audio);
  if (!existsSync(src)) throw new HttpError(404, "ไม่พบไฟล์เสียง ให้เตรียมเสียงใหม่ก่อน");
  send(res, 201, storeVoice(name, readFileSync(src)));
});

route("POST", new RegExp(`^/api/projects/${NAME}/asset$`), async (req, res, [name]) => {
  const ext = new URL(req.url ?? "", "http://x").searchParams.get("ext") ?? "";
  send(res, 201, { path: storeAsset(name, await readBody(req), ext) });
});

route("POST", new RegExp(`^/api/projects/${NAME}/prepare$`), async (_q, res, [name]) => {
  const logs: string[] = [];
  const dir = requireProject(name);
  const timeline = await prepare(dir, (m) => logs.push(m));
  refreshThumbnail(name);
  send(res, 200, { timeline, logs, srtUrl: fileUrl(name, srtPath(dir)) });
});

route("POST", new RegExp(`^/api/projects/${NAME}/still$`), async (req, res, [name]) => {
  const dir = requireProject(name);
  const timeline = readTimeline(dir);
  if (!timeline) throw new HttpError(409, "ยังไม่ได้เตรียมเสียง กด “เตรียมเสียง” ก่อน");
  const { time = 0, scale = 0.5 } = await readJson<{ time?: number; scale?: number }>(req);
  const last = Math.max(0, Math.ceil(timeline.duration * timeline.fps) - 1);
  const frame = Math.min(last, Math.max(0, Math.round(Number(time) * timeline.fps)));
  const out = join(dir, "out", "preview", `frame-${frame}.png`);
  await renderStill(dir, frame, out, Math.min(1, Math.max(0.1, Number(scale))));
  send(res, 200, { frame, url: fileUrl(name, out) });
});

route("POST", new RegExp(`^/api/projects/${NAME}/render$`), async (req, res, [name]) => {
  const { quality = "preview" } = await readJson<{ quality?: "preview" | "final" }>(req);
  send(res, 202, jobView(startRender(name, quality === "final" ? "final" : "preview")));
});

route("POST", new RegExp(`^/api/projects/${NAME}/open-folder$`), (_q, res, [name]) => {
  openPath(requireProject(name));
  send(res, 200, { ok: true });
});

const jobJson = (job: RenderJob) => {
  const view = jobView(job);
  const exists = !!view.output && existsSync(view.output);
  return { ...view, url: exists ? fileUrl(job.project, view.output!) : undefined, title: (() => { try { return loadProject(projectDir(job.project)).title; } catch { return job.project; } })() };
};

route("GET", /^\/api\/jobs\/([a-f0-9-]+)$/, (_q, res, [id]) => {
  const job = getJob(id);
  if (!job) throw new HttpError(404, "ไม่พบงานเรนเดอร์ (โปรแกรมอาจถูกปิดไปแล้ว)");
  send(res, 200, jobJson(job));
});

route("GET", /^\/api\/jobs$/, (_q, res) => send(res, 200, listJobs().slice(0, 50).map(jobJson)));

route("POST", /^\/api\/jobs\/([a-f0-9-]+)\/cancel$/, (_q, res, [id]) => send(res, 200, jobJson(cancelJob(id))));

// ส่งออกพร้อมตัวเลือก (รูปแบบ ความละเอียด คุณภาพ fps ซับ ความดัง) เข้าคิว
route("POST", new RegExp(`^/api/projects/${NAME}/export$`), async (req, res, [name]) => {
  const body = await readJson<Partial<ExportOptions>>(req);
  const parsed = ExportOptionsSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join(", "));
  send(res, 202, jobJson(startExport(name, parsed.data)));
});

// ---------- ไฟล์โปรเจกต์ .katun ----------

route("GET", new RegExp(`^/api/projects/${NAME}/bundle$`), (_q, res, [name]) => {
  const buf = exportBundle(name);
  const title = loadProject(projectDir(name)).title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || name;
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": buf.length,
    "Content-Disposition": `attachment; filename="${name}.katun"; filename*=UTF-8''${encodeURIComponent(title)}.katun`,
  });
  res.end(buf);
});

route("POST", /^\/api\/import$/, async (req, res) => {
  const buf = await readBody(req, 2 * 1024 ** 3);
  if (!buf.length) throw new HttpError(400, "ไม่มีไฟล์");
  send(res, 201, importBundle(buf));
});

// ---------- AI ช่วย (Claude) ----------

route("GET", /^\/api\/ai\/status$/, (_q, res) => send(res, 200, { configured: aiConfigured(), modes: REWRITE_MODES }));

route("POST", /^\/api\/ai\/script$/, async (req, res) => {
  const body = await readJson<{ topic?: string; seconds?: number; characters?: number; format?: "16:9" | "9:16" | "1:1"; language?: string }>(req);
  if (!body.topic?.trim()) throw new HttpError(400, "ใส่หัวข้อก่อน");
  const script = await writeScript({ topic: body.topic.trim(), seconds: body.seconds, characters: body.characters, language: body.language });
  const name = createProjectName();
  saveProject(name, { ...scriptToProject(script, body.format ?? "16:9"), meta: { template: "ai" } });
  send(res, 201, { name, title: script.title });
});

route("POST", new RegExp(`^/api/projects/${NAME}/ai/rewrite$`), async (req, res, [name]) => {
  const { mode, target } = await readJson<{ mode: RewriteMode; target?: string }>(req);
  if (!(mode in REWRITE_MODES)) throw new HttpError(400, "โหมดไม่ถูกต้อง");
  send(res, 200, { lines: await rewriteLines(loadProject(requireProject(name)), mode, target) });
});

route("POST", new RegExp(`^/api/projects/${NAME}/ai/direct$`), async (_q, res, [name]) => {
  send(res, 200, { lines: await directLines(loadProject(requireProject(name))) });
});

// ฟังเสียงตัวอย่างของบรรทัดเดียวโดยไม่ต้องเตรียมทั้งเรื่อง
route("POST", /^\/api\/tts-preview$/, async (req, res) => {
  const { text, voice } = await readJson<{ text: string; voice: unknown }>(req);
  if (!text?.trim()) throw new HttpError(400, "ไม่มีข้อความ");
  const v = VoiceSchema.parse(voice);
  const id = createHash("sha1").update(JSON.stringify([v, text])).digest("hex").slice(0, 16);
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, `${id}.wav`);
  if (!existsSync(out)) await synthesize(text, v, out);
  send(res, 200, { url: `/cache/${id}.wav` });
});

route("GET", /^\/api\/voices$/, (_q, res) => send(res, 200, VOICES));

// ---------- คอมโพเนนต์และ SFX ----------

route("GET", /^\/api\/sfx$/, (_q, res) => send(res, 200, Object.entries(SFX).map(([id, s]) => ({ id, ...s }))));

route("POST", new RegExp(`^/api/projects/${NAME}/sfx$`), async (req, res, [name]) => {
  const { id } = await readJson<{ id: SfxId }>(req);
  send(res, 201, { path: ensureSfx(requireProject(name), id) });
});

route("GET", /^\/api\/component-templates$/, (_q, res) =>
  send(res, 200, COMPONENT_TEMPLATES.map(({ id, name, description }) => ({ id, name, description }))),
);

/** สร้างคอมโพเนนต์จากเทมเพลต (เตรียมไฟล์ SFX ให้) แล้วคืนให้หน้าจอใส่ลงโปรเจกต์เอง เพื่อให้ Undo ได้ */
route("POST", new RegExp(`^/api/projects/${NAME}/component-template$`), async (req, res, [name]) => {
  const { template } = await readJson<{ template: string }>(req);
  const dir = requireProject(name);
  const t = COMPONENT_TEMPLATES.find((x) => x.id === template);
  if (!t) throw new HttpError(404, "ไม่มีเทมเพลตนี้");
  send(res, 200, { component: t.build((id) => ensureSfx(dir, id)) });
});

route("GET", /^\/api\/settings$/, (_q, res) => send(res, 200, getSettings()));

route("PUT", /^\/api\/settings$/, async (req, res) => {
  const body = await readJson<{ azureKey?: string; azureRegion?: string; anthropicKey?: string }>(req);
  const values: Parameters<typeof updateSettings>[0] = {};
  if (body.azureKey !== undefined) values.AZURE_SPEECH_KEY = body.azureKey;
  if (body.azureRegion !== undefined) values.AZURE_SPEECH_REGION = body.azureRegion;
  if (body.anthropicKey !== undefined) values.ANTHROPIC_API_KEY = body.anthropicKey;
  updateSettings(values);
  send(res, 200, getSettings());
});

route("GET", /^\/api\/doctor$/, (_q, res) => send(res, 200, doctor()));

route("GET", /^\/api\/integrations$/, (_q, res) =>
  send(res, 200, {
    claudeDesktop: claudeDesktopStatus(),
    claudeCode: { ...claudeCodeStatus(), command: CLAUDE_CODE_COMMAND },
    mcpEntry: MCP_ENTRY,
    chatgpt: { available: false, note: "ChatGPT ต้องใช้ MCP แบบ remote (HTTPS) ซึ่งอยู่ในเฟสถัดไป" },
  }),
);

route("POST", /^\/api\/integrations\/mcp\/check$/, async (_q, res) => {
  send(res, 200, await checkMcpHealth());
});

route("POST", /^\/api\/app\/sync$/, async (req, res) => {
  send(res, 200, { commands: syncAppSession(await readJson(req), `http://${req.headers.host}`) });
});
route("POST", /^\/api\/app\/ack$/, async (req, res) => {
  const { sessionId, commandId, error } = await readJson<{ sessionId: string; commandId: string; error?: string }>(req);
  acknowledgeAppCommand(sessionId, commandId, error);
  send(res, 200, { ok: true });
});

route("POST", /^\/api\/integrations\/claude-desktop\/connect$/, (_q, res) => send(res, 200, { path: connectClaudeDesktop() }));
route("POST", /^\/api\/integrations\/claude-desktop\/disconnect$/, (_q, res) => {
  disconnectClaudeDesktop();
  send(res, 200, { ok: true });
});
route("POST", /^\/api\/integrations\/claude-code\/connect$/, (_q, res) => send(res, 200, { output: connectClaudeCode() }));
route("POST", /^\/api\/rhubarb\/install$/, (_q, res) => send(res, 200, { output: installRhubarb() }));

export function startApp(port: number): Promise<{ url: string; alreadyRunning: boolean; close: () => Promise<void> }> {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = createServer(async (req, res) => {
    try {
      // กัน DNS rebinding: รับเฉพาะ request ที่เรียกมาที่ localhost จริง
      if (!allowedHosts.has(req.headers.host ?? "")) throw new HttpError(403, "host ไม่ถูกต้อง");
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const method = req.method ?? "GET";

      // กันเว็บอื่นยิง request มาสั่งงาน: ทุกคำสั่งที่แก้ข้อมูลต้องมี header นี้ ซึ่งเว็บข้ามโดเมนส่งเองไม่ได้
      if (method !== "GET" && method !== "HEAD" && req.headers["x-katun"] !== "1") {
        throw new HttpError(403, "ต้องเรียกจากหน้าโปรแกรม");
      }

      if (url.pathname.startsWith("/api/")) {
        for (const r of routes) {
          const m = r.method === method ? r.pattern.exec(url.pathname) : null;
          if (m) return await r.handler(req, res, m.slice(1));
        }
        throw new HttpError(404, "ไม่พบ API");
      }
      if (method !== "GET") throw new HttpError(405, "method ไม่ถูกต้อง");

      const files = new RegExp(`^/files/${NAME}/(.+)$`).exec(url.pathname);
      if (files) return serveFile(req, res, requireProject(files[1]), files[2]);
      const cache = /^\/cache\/([a-f0-9]{16}\.wav)$/.exec(url.pathname);
      if (cache) return serveFile(req, res, CACHE, cache[1]);
      if (!existsSync(join(DIST, "index.html"))) throw new HttpError(503, "ยังไม่ได้ build หน้าจอ ให้รัน npm run build");
      return serveFile(req, res, DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  });

  const url = `http://127.0.0.1:${port}`;
  return new Promise((resolvePromise, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolvePromise({ url, alreadyRunning: true, close: async () => {} });
      else reject(err);
    });
    server.listen(port, "127.0.0.1", () => resolvePromise({ url, alreadyRunning: false, close: () => new Promise<void>((done, fail) => {
      server.close((err) => err ? fail(err) : done());
      server.closeAllConnections();
    }) }));
  });
}

// เปิดเป็นหน้าต่างโปรแกรมของตัวเอง (Edge/Chrome โหมด --app: ไม่มีแถบที่อยู่ ไม่มีแท็บ)
// ใช้โปรไฟล์แยกของ Katun เพื่อให้ process ของหน้าต่างนี้อยู่จนกว่าผู้ใช้จะปิดหน้าต่าง
function findAppBrowser(): string | undefined {
  const env = process.env;
  const candidates =
    process.platform === "win32"
      ? [
          join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
          join(env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
          join(env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
          join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
          join(env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => p && existsSync(p));
}

export function openAppWindow(url: string): import("node:child_process").ChildProcess | undefined {
  const exe = findAppBrowser();
  if (!exe) return undefined;
  const base = process.platform === "win32" ? (process.env.LOCALAPPDATA ?? ROOT) : join(process.env.HOME ?? ROOT, ".katun");
  const profile = join(base, "Katun", "window");
  mkdirSync(profile, { recursive: true });
  return spawn(
    exe,
    [`--app=${url}`, `--user-data-dir=${profile}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--disable-background-mode", "--disable-features=msEdgeStartupBoost"],
    { stdio: "ignore" },
  );
}

export function openBrowser(url: string): void {
  if (process.platform === "win32") spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else openPath(url);
}
