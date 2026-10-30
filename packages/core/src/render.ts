import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { ROOT } from "./pipeline.js";

// เรียก Remotion CLI เป็น process แยก เพื่อให้ทั้ง CLI และ MCP server ใช้ร่วมกันได้

const REMOTION_CLI = join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");
const ENTRY = join(ROOT, "packages", "renderer", "src", "index.ts");

export type Progress = { rendered: number; total: number };

export class Canceled extends Error {
  constructor() {
    super("ยกเลิกแล้ว");
  }
}

/** แก้ค่าบางอย่างของ timeline เฉพาะงานส่งออกนี้ (เช่น fps หรือปิดซับ) โดยไม่แตะ timeline.json หลัก */
export type PropsOverride = { fps?: number; subtitles?: boolean };

function propsArgs(projectDir: string, override?: PropsOverride): string[] {
  const timeline = join(projectDir, "build", "timeline.json");
  if (!existsSync(timeline)) throw new Error(`ยังไม่มี ${timeline} ให้เตรียมโปรเจกต์ (prepare) ก่อน`);
  let props = timeline;
  if (override && (override.fps || override.subtitles !== undefined)) {
    const t = JSON.parse(readFileSync(timeline, "utf8"));
    if (override.fps) t.fps = override.fps;
    if (override.subtitles !== undefined) t.subtitles = { ...t.subtitles, enabled: override.subtitles };
    props = join(projectDir, "build", `timeline.export-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    writeFileSync(props, JSON.stringify(t));
  }
  return [`--props=${props}`, `--public-dir=${join(projectDir, "build")}`];
}

function run(args: string[], opts: { inherit?: boolean; onLine?: (line: string) => void; signal?: AbortSignal } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Canceled());
    const child = spawn(process.execPath, [REMOTION_CLI, ...args], {
      cwd: ROOT,
      stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const onAbort = () => child.kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const tail: string[] = [];
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        opts.onLine?.(line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new Canceled());
      if (code === 0) resolve();
      else reject(new Error(`Remotion ล้มเหลว (exit ${code}):\n${tail.join("\n")}`));
    });
  });
}

export type RenderOptions = {
  scale?: number;
  codec?: "h264" | "vp8" | "gif" | "mp3" | "wav";
  crf?: number;
  everyNthFrame?: number;
  override?: PropsOverride;
  inherit?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
};

export async function renderVideo(projectDir: string, out: string, opts: RenderOptions = {}): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  const args = ["render", ENTRY, "Main", out, ...propsArgs(projectDir, opts.override)];
  if (opts.scale && opts.scale !== 1) args.push(`--scale=${opts.scale}`);
  if (opts.codec) args.push(`--codec=${opts.codec}`);
  if (opts.crf !== undefined) args.push(`--crf=${opts.crf}`);
  if (opts.everyNthFrame && opts.everyNthFrame > 1) args.push(`--every-nth-frame=${opts.everyNthFrame}`);
  try {
    await run(args, {
      inherit: opts.inherit,
      signal: opts.signal,
      onLine: (line) => {
        const m = /Rendered (\d+)\/(\d+)/.exec(line);
        if (m) opts.onProgress?.({ rendered: Number(m[1]), total: Number(m[2]) });
      },
    });
  } finally {
    // ลบไฟล์ props ชั่วคราวของงานนี้ (ถ้ามี)
    const temp = args.find((a) => a.startsWith("--props=") && a.includes("timeline.export-"));
    if (temp) rmSync(temp.slice("--props=".length), { force: true });
  }
}

export async function renderStill(projectDir: string, frame: number, out: string, scale = 0.5): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  await run(["still", ENTRY, "Main", out, ...propsArgs(projectDir), `--frame=${frame}`, `--scale=${scale}`]);
}

// ---------- ความดังมาตรฐาน (EBU R128 ด้วย ffmpeg loudnorm ที่มากับ Remotion) ----------

type LoudnormStats = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string; output_i: string };

async function loudnorm(args: string[], signal?: AbortSignal): Promise<LoudnormStats> {
  const lines: string[] = [];
  await run(["ffmpeg", "-hide_banner", "-nostats", ...args], { onLine: (l) => lines.push(l), signal });
  const text = lines.join("\n");
  const json = text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1);
  if (!json) throw new Error("อ่านผลวัดความดังไม่ได้");
  return JSON.parse(json) as LoudnormStats;
}

/** วัดความดังรวม (Integrated LUFS) ของไฟล์ */
export async function measureLoudness(file: string): Promise<number> {
  const s = await loudnorm(["-i", file, "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  return Number(s.input_i);
}

// encoder เสียงตามชนิดไฟล์ (ภาพไม่ถูกเข้ารหัสใหม่)
const AUDIO_ENCODE: Record<string, string[]> = {
  ".mp4": ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"],
  ".webm": ["-c:v", "copy", "-c:a", "libopus", "-b:a", "160k", "-ar", "48000"],
  ".mp3": ["-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000"],
  ".wav": ["-vn", "-c:a", "pcm_s16le", "-ar", "48000"],
};

/**
 * ปรับความดังของไฟล์ให้ได้ target LUFS (ค่าเริ่มต้น -14 สำหรับ YouTube/TikTok) แบบ 2 รอบ:
 * วัดก่อน แล้วปรับแบบเส้นตรง (ไม่บีบไดนามิก) ใช้ได้กับ mp4 / webm / mp3 / wav
 */
export async function normalizeLoudness(file: string, target = -14, signal?: AbortSignal): Promise<{ before: number; after: number }> {
  const ext = extname(file).toLowerCase();
  const encode = AUDIO_ENCODE[ext];
  if (!encode) throw new Error(`ปรับความดังไฟล์ ${ext} ไม่ได้`);
  const spec = `I=${target}:TP=-1.5:LRA=11`;
  const m = await loudnorm(["-i", file, "-vn", "-af", `loudnorm=${spec}:print_format=json`, "-f", "null", "-"], signal);
  const before = Number(m.input_i);
  if (!Number.isFinite(before)) return { before, after: before }; // ไม่มีเสียง
  const tmp = file.replace(/(\.[^.]+)$/, ".loudnorm$1");
  const filter = `loudnorm=${spec}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  await loudnorm(["-y", "-i", file, "-af", filter, ...encode, tmp], signal);
  renameSync(tmp, file);
  return { before, after: await measureLoudness(file) };
}

export function openStudio(projectDir: string): Promise<void> {
  return run(["studio", ENTRY, ...propsArgs(projectDir)], { inherit: true });
}
