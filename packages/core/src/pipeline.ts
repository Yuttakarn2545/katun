import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { isNeutralFx, processAudio } from "./dsp.js";
import { clipDuration, layoutTimeline, mediaKey, voiceOf, type LineMedia } from "./layout.js";
import { findRhubarb, mouthCues } from "./lipsync.js";
import { FORMAT_SIZE, ProjectSchema, SCHEMA_VERSION, type Project, type Timeline, type Voice } from "./schema.js";
import { synthesize } from "./tts.js";
import { readWav, trimWav, wavDuration, writeWav } from "./wav.js";

export const ROOT = resolve(import.meta.dirname, "..", "..", "..");


export function loadProject(projectDir: string): Project {
  const file = join(projectDir, "project.json");
  if (!existsSync(file)) throw new Error(`ไม่พบ ${file}`);
  // ตัด BOM ที่ Notepad/PowerShell บางเวอร์ชันใส่ไว้หน้าไฟล์
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const raw = JSON.parse(text) as { version?: number };
  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`project.json ไม่ถูกต้อง:\n${issues}`);
  }
  // ย้ายโปรเจกต์รุ่นเก่า: สำรองไฟล์เดิม แล้วบันทึกแบบ v2 (เติม id ให้ทุกบรรทัด) เพื่อให้ id คงที่
  if (raw.version !== SCHEMA_VERSION) {
    copyFileSync(file, join(projectDir, `project.v${raw.version ?? 1}.backup.json`));
    writeFileSync(file, JSON.stringify(parsed.data, null, 2) + "\n");
  }
  return parsed.data;
}

function isColor(bg: string): boolean {
  return /^(#|rgb|hsl|linear-gradient|radial-gradient)/i.test(bg) || /^[a-z]+$/i.test(bg);
}

function hash(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/**
 * เตรียมทุกอย่างที่ renderer ต้องใช้ลงในโฟลเดอร์ build/ ของโปรเจกต์:
 * ไฟล์เสียงทุกบรรทัด, รูปปากตามเวลา, ภาพพื้นหลัง และ timeline.json
 * เสียง TTS ถูก cache ตามข้อความ+เสียง จึงรันซ้ำได้โดยไม่เสียค่า TTS ซ้ำ
 */
export async function prepare(projectDir: string, log = console.log): Promise<Timeline> {
  const project = loadProject(projectDir);
  const buildDir = join(projectDir, "build");
  mkdirSync(join(buildDir, "audio"), { recursive: true });
  mkdirSync(join(buildDir, "bg"), { recursive: true });

  const rhubarb = findRhubarb(ROOT);
  log(rhubarb ? `ปากขยับ: Rhubarb (${rhubarb})` : "ปากขยับ: ตามความดังเสียง (ไม่พบ Rhubarb)");

  // 1) ทำเสียงของทุกบรรทัด (TTS / ไฟล์ผู้ใช้) แล้วตัดหัวท้ายตามที่ลากในไทม์ไลน์
  const media = new Map<string, LineMedia>();
  for (const scene of project.scenes) {
    for (const [i, line] of scene.lines.entries()) {
      const label = `[${scene.id} #${i + 1}] ${project.characters[line.character].name}`;
      let audioName: string;

      if (line.audio) {
        const src = resolve(projectDir, line.audio);
        if (!existsSync(src)) throw new Error(`${label}: ไม่พบไฟล์เสียง ${src}`);
        audioName = `user-${hash(readFileSync(src).toString("base64"))}.wav`;
        copyFileSync(src, join(buildDir, "audio", audioName));
        log(`${label}: ใช้เสียงจากไฟล์ ${line.audio}`);
      } else {
        const voice: Voice = project.characters[line.character].voice ?? project.voice;
        audioName = `tts-${hash(voice.provider, voice.voice, voice.rate ?? "", voice.pitch ?? "", line.text)}.wav`;
        const out = join(buildDir, "audio", audioName);
        if (existsSync(out)) {
          log(`${label}: ใช้เสียงที่ cache ไว้`);
        } else {
          log(`${label}: สร้างเสียง (${voice.provider}/${voice.voice})`);
          await synthesize(line.text, voice, out);
        }
      }

      const sourcePath = join(buildDir, "audio", audioName);
      const wav = readWav(sourcePath);
      const sourceDuration = wavDuration(wav);
      let usedName = audioName;
      if (line.trimStart > 0 || line.trimEnd > 0) {
        // จำกัดการตัดไม่ให้เหลือสั้นกว่า MIN_CLIP แล้วเขียนไฟล์ที่ตัดแล้วแยกต่างหาก (cache ตามค่าที่ตัด)
        const keep = clipDuration(line, sourceDuration);
        const start = Math.min(line.trimStart, sourceDuration - keep);
        const end = sourceDuration - keep - start;
        usedName = `${audioName.replace(/\.wav$/, "")}-t${Math.round(start * 1000)}-${Math.round(end * 1000)}.wav`;
        const trimmedPath = join(buildDir, "audio", usedName);
        if (!existsSync(trimmedPath)) writeWav(trimmedPath, trimWav(wav, start, end), wav.sampleRate);
      }
      if (!isNeutralFx(line.fx)) {
        // เอฟเฟกต์: ประมวลผลจากไฟล์ที่ตัดแล้ว เขียนเป็นไฟล์ใหม่ (cache ตามค่าเอฟเฟกต์)
        const fxName = `${usedName.replace(/\.wav$/, "")}-fx${hash(JSON.stringify(line.fx)).slice(0, 10)}.wav`;
        const fxPath = join(buildDir, "audio", fxName);
        if (!existsSync(fxPath)) {
          const base = readWav(join(buildDir, "audio", usedName));
          log(`${label}: ใส่เอฟเฟกต์เสียง`);
          writeWav(fxPath, processAudio(base.samples, base.sampleRate, line.fx), base.sampleRate);
        }
        usedName = fxName;
      }
      const usedPath = join(buildDir, "audio", usedName);
      media.set(line.id, {
        audio: `audio/${usedName}`,
        sourceDuration,
        duration: wavDuration(readWav(usedPath)),
        key: mediaKey(line, voiceOf(project, line)),
        cues: mouthCues(usedPath, rhubarb),
      });
    }
  }

  // 2) จัดเวลา (ใช้ฟังก์ชันเดียวกับที่หน้าจอใช้ประมาณระหว่างลาก)
  const layout = layoutTimeline(project, (line) => media.get(line.id));
  for (const scene of layout.scenes) {
    if (isColor(scene.background)) continue;
    const src = resolve(projectDir, scene.background);
    if (!existsSync(src)) throw new Error(`ฉาก ${scene.id}: ไม่พบภาพพื้นหลัง ${src}`);
    scene.background = `bg/${hash(src)}${extname(src)}`;
    copyFileSync(src, join(buildDir, scene.background));
  }

  // ไฟล์ภาพ/เสียงในคอมโพเนนต์: คัดลอกไป build/ ที่ path เดิม ตัวเรนเดอร์จึงอ้างด้วย path เดียวกับใน project.json
  for (const [cid, comp] of Object.entries(project.components)) {
    for (const layer of comp.layers) {
      if (layer.type !== "image" && layer.type !== "audio") continue;
      const src = resolve(projectDir, layer.src);
      if (!existsSync(src)) throw new Error(`คอมโพเนนต์ ${comp.name} (${cid}) เลเยอร์ "${layer.name}": ไม่พบไฟล์ ${layer.src}`);
      const dest = join(buildDir, layer.src);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) copyFileSync(src, dest);
    }
  }

  const timeline: Timeline = {
    title: project.title,
    fps: project.fps,
    ...FORMAT_SIZE[project.format],
    ...layout,
    subtitles: project.subtitles,
    components: project.components,
  };
  const t = timeline.duration;

  if (project.music) {
    const src = resolve(projectDir, project.music.file);
    if (!existsSync(src)) throw new Error(`ไม่พบไฟล์เพลง ${src}`);
    const name = `music-${hash(src, String(statSync(src).mtimeMs))}${extname(src)}`;
    copyFileSync(src, join(buildDir, name));
    const master = project.mix.master;
    timeline.music = { src: name, volume: project.music.volume * master, duckTo: project.music.duckTo * master, ramp: project.mix.duckFade };
  }

  writeFileSync(join(buildDir, "timeline.json"), JSON.stringify(timeline, null, 2));
  const srt = srtPath(projectDir);
  mkdirSync(dirname(srt), { recursive: true });
  writeFileSync(srt, toSrt(timeline));
  writeFileSync(srt.replace(/\.srt$/, ".vtt"), toVtt(timeline));
  log(`ซับไตเติล: ${srt}`);
  log(`เตรียมเสร็จ: ${timeline.lines.length} บรรทัด ยาว ${t.toFixed(1)} วินาที → ${join(buildDir, "timeline.json")}`);
  return timeline;
}

export function outputPath(projectDir: string): string {
  return join(projectDir, "out", `${basename(resolve(projectDir))}.mp4`);
}

export function srtPath(projectDir: string): string {
  return join(projectDir, "out", `${basename(resolve(projectDir))}.srt`);
}

function srtTime(s: number): string {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** ซับไตเติลแบบ SRT สำหรับอัปโหลดขึ้น YouTube/TikTok หรือใช้ในโปรแกรมตัดต่ออื่น */
export function toSrt(timeline: Timeline): string {
  return timeline.lines
    .map((l, i) => {
      const name = timeline.subtitles.showName ? `${timeline.characters[l.character]?.name ?? l.character}: ` : "";
      return `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.start + l.duration)}\n${name}${l.text}\n`;
    })
    .join("\n");
}

/** ซับไตเติลแบบ WebVTT (เว็บ / เครื่องเล่น HTML5) */
export function toVtt(timeline: Timeline): string {
  const t = (s: number) => srtTime(s).replace(",", ".");
  const cues = timeline.lines.map((l) => {
    const name = timeline.subtitles.showName ? `<v ${timeline.characters[l.character]?.name ?? l.character}>` : "";
    return `${t(l.start)} --> ${t(l.start + l.duration)}\n${name}${l.text}\n`;
  });
  return `WEBVTT\n\n${cues.join("\n")}`;
}
