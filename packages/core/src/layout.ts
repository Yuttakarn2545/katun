import type { MouthCue, Project, Timeline, TimelineLine, TimelinePlacement, TimelineScene } from "./schema.js";

// จัดวางเวลาของทั้งเรื่องจาก project + ความยาวเสียงของแต่ละบรรทัด
// ใช้ทั้งใน pipeline (ความยาวจริงจากไฟล์) และในหน้าจอ (ประมาณทันทีระหว่างลากคลิป ก่อนเสียงใหม่จะพร้อม)

export const MIN_CLIP = 0.1; // คลิปสั้นสุดที่ยอมให้ตัดเหลือ (วินาที)

type Line = Project["scenes"][number]["lines"][number];

/** duration = ความยาวหลังตัดและใส่เอฟเฟกต์แล้ว (ถ้ารู้); ไม่มีก็คำนวณจาก source/ตัด/ความเร็ว */
export type LineMedia = { audio: string; sourceDuration: number; cues: MouthCue[]; duration?: number; key?: string };

/** ตัวระบุเสียงของบรรทัด: เปลี่ยนเมื่อต้นทาง (ไฟล์/ข้อความ+เสียง TTS) การตัด หรือเอฟเฟกต์เปลี่ยน */
export function mediaKey(line: Line, voice: Project["voice"]): string {
  const src = line.audio ?? `${voice.provider}|${voice.voice}|${voice.rate ?? ""}|${voice.pitch ?? ""}|${line.text}`;
  return JSON.stringify([src, line.trimStart ?? 0, line.trimEnd ?? 0, line.fx ?? null]);
}

export const voiceOf = (project: Project, line: Line) => project.characters[line.character]?.voice ?? project.voice;

/** ความยาวโดยประมาณของบทที่ยังไม่มีเสียง (ราว 13 ตัวอักษรต่อวินาที) */
export function estimateSpeech(text: string): number {
  return Math.min(15, Math.max(0.8, text.trim().length * 0.075));
}

export function clipDuration(line: Pick<Line, "trimStart" | "trimEnd">, sourceDuration: number): number {
  return Math.max(MIN_CLIP, sourceDuration - (line.trimStart ?? 0) - (line.trimEnd ?? 0));
}

export type Layout = Pick<Timeline, "scenes" | "lines" | "duration" | "characters"> & { placements: TimelinePlacement[] };

export function layoutTimeline(project: Project, media: (line: Line) => LineMedia | undefined): Layout {
  const tracks = project.tracks ?? {};
  const anySolo = Object.values(tracks).some((t) => t.solo);
  const scenes: TimelineScene[] = [];
  const lines: TimelineLine[] = [];

  let t = 0;
  for (const scene of project.scenes) {
    const sceneStart = t;
    t += scene.holdStart ?? 0.5;
    scene.lines.forEach((line, i) => {
      const m = media(line);
      const source = m?.sourceDuration ?? estimateSpeech(line.text);
      const duration = m?.duration ?? Math.max(MIN_CLIP, clipDuration(line, source) / (line.fx?.speed ?? 1));
      const state = tracks[line.character];
      lines.push({
        id: line.id,
        sceneId: scene.id,
        character: line.character,
        text: line.text,
        audio: m?.audio ?? "",
        start: t,
        duration,
        sourceDuration: source,
        trimStart: line.trimStart ?? 0,
        trimEnd: line.trimEnd ?? 0,
        muted: !!state?.muted || (anySolo && !state?.solo),
        volume: (state?.volume ?? 1) * (project.mix?.master ?? 1),
        emotion: line.emotion,
        gesture: line.gesture,
        camera: line.camera,
        key: m?.key,
        cues: m?.cues ?? [],
      });
      // บรรทัดสุดท้ายของฉากไม่ต้องเว้น pauseAfter เพราะมี holdEnd ของฉากแล้ว
      t += duration + (i < scene.lines.length - 1 ? line.pauseAfter : 0);
    });
    t += scene.holdEnd ?? 0.5;
    const cast = scene.cast ?? [...new Set(scene.lines.map((l) => l.character))];
    scenes.push({
      id: scene.id,
      background: scene.background,
      cast,
      start: sceneStart,
      duration: t - sceneStart,
      transition: scene.transition,
      autoFocus: scene.autoFocus,
      layout: scene.layout,
    });
  }

  const characters = Object.fromEntries(
    Object.entries(project.characters).map(([id, c]) => [id, { name: c.name, color: c.color, hidden: !!tracks[id]?.hidden }]),
  );

  // คอมโพเนนต์ที่วางในเรื่อง: เวลาจริง = ต้นฉาก + offset (เลื่อนตามฉากเมื่อบทเปลี่ยน)
  const placements: TimelinePlacement[] = [];
  for (const pl of project.placements ?? []) {
    const scene = scenes.find((s) => s.id === pl.sceneId);
    const comp = project.components?.[pl.component];
    if (!scene || !comp) continue;
    placements.push({ ...pl, start: scene.start + pl.offset, duration: pl.duration ?? comp.duration });
  }
  // เรื่องยาวอย่างน้อยถึงคอมโพเนนต์ตัวสุดท้ายจบ
  const duration = Math.max(t, ...placements.map((p) => p.start + p.duration));
  return { scenes, lines, duration, characters, placements };
}
