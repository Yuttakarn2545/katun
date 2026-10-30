import { MIN_CLIP } from "../../../../core/src/layout";
import { LineSchema, newId, SceneSchema, type AudioFx, type Project, type TrackState } from "../../../../core/src/schema";
import { api } from "./api";
import { computeLayout, useEditor } from "./store";

// คำสั่งแก้โปรเจกต์ที่แผงต่าง ๆ ใช้ร่วมกัน (ทุกคำสั่ง Undo ได้)

type Line = Project["scenes"][number]["lines"][number];

const update = (fn: (p: Project) => void) => useEditor.getState().update(fn);
const select = useEditor.getState().select;

export const CHARACTER_COLORS = ["#f4a261", "#8ecae6", "#90be6d", "#f28482", "#cdb4db", "#ffd166", "#a2d2ff", "#ffafcc"];

function findLine(p: Project, lineId: string) {
  for (const scene of p.scenes) {
    const index = scene.lines.findIndex((l) => l.id === lineId);
    if (index >= 0) return { scene, index };
  }
  return undefined;
}

export function addLine(sceneId: string, afterLineId?: string): void {
  const id = newId("l");
  update((p) => {
    const scene = p.scenes.find((s) => s.id === sceneId) ?? p.scenes[p.scenes.length - 1];
    const at = afterLineId ? scene.lines.findIndex((l) => l.id === afterLineId) + 1 : scene.lines.length;
    const prev = scene.lines[at - 1];
    const ids = Object.keys(p.characters);
    // สลับคนพูดให้อัตโนมัติ เพราะบทสนทนาส่วนใหญ่คุยกันสลับไปมา
    const character = ids.find((c) => c !== prev?.character) ?? ids[0];
    scene.lines.splice(at, 0, blankLine(id, character));
  });
  select({ kind: "line", id });
}

export function duplicateLine(lineId: string): void {
  const id = newId("l");
  update((p) => {
    const found = findLine(p, lineId);
    if (found) found.scene.lines.splice(found.index + 1, 0, { ...structuredClone(found.scene.lines[found.index]), id });
  });
  select({ kind: "line", id });
}

export function deleteLine(lineId: string): void {
  const p = useEditor.getState().project;
  const found = p && findLine(p, lineId);
  if (!found) return;
  if (found.scene.lines.length === 1) {
    if (p.scenes.length === 1) throw new Error("เรื่องต้องมีบทพูดอย่างน้อย 1 บรรทัด");
    return deleteScene(found.scene.id);
  }
  const next = found.scene.lines[found.index + 1] ?? found.scene.lines[found.index - 1];
  update((d) => {
    const f = findLine(d, lineId)!;
    f.scene.lines.splice(f.index, 1);
  });
  select({ kind: "line", id: next.id });
}

export function moveLine(lineId: string, delta: -1 | 1): void {
  update((p) => {
    const f = findLine(p, lineId);
    if (!f) return;
    const to = f.index + delta;
    if (to >= 0 && to < f.scene.lines.length) {
      const [l] = f.scene.lines.splice(f.index, 1);
      f.scene.lines.splice(to, 0, l);
      return;
    }
    // เลื่อนข้ามไปฉากก่อน/ถัดไป
    const si = p.scenes.indexOf(f.scene);
    const target = p.scenes[si + delta];
    if (!target || f.scene.lines.length === 1) return;
    const [l] = f.scene.lines.splice(f.index, 1);
    if (delta < 0) target.lines.push(l);
    else target.lines.unshift(l);
  });
}

export function patchLine(lineId: string, patch: Partial<Line>, coalesce?: string): void {
  useEditor.getState().update((p) => {
    const f = findLine(p, lineId);
    if (f) Object.assign(f.scene.lines[f.index], patch);
  }, coalesce);
}

export function addScene(afterSceneId?: string): void {
  const p = useEditor.getState().project;
  if (!p) return;
  let n = p.scenes.length + 1;
  while (p.scenes.some((s) => s.id === `scene${n}`)) n++;
  const sceneId = `scene${n}`;
  const lineId = newId("l");
  update((d) => {
    const at = afterSceneId ? d.scenes.findIndex((s) => s.id === afterSceneId) + 1 : d.scenes.length;
    d.scenes.splice(at, 0, {
      ...SceneSchema.parse({ id: sceneId, lines: [{ character: "-", text: "-" }] }),
      id: sceneId,
      background: "linear-gradient(#ffe5ec, #fff1e6)",
      holdStart: 0.5,
      holdEnd: 0.5,
      lines: [blankLine(lineId, Object.keys(d.characters)[0])],
    });
  });
  select({ kind: "scene", id: sceneId });
}

export function deleteScene(sceneId: string): void {
  const p = useEditor.getState().project;
  if (!p) return;
  if (p.scenes.length === 1) throw new Error("เรื่องต้องมีอย่างน้อย 1 ฉาก");
  update((d) => {
    d.scenes = d.scenes.filter((s) => s.id !== sceneId);
  });
  select({ kind: "project" });
}

export function moveScene(sceneId: string, delta: -1 | 1): void {
  update((p) => {
    const i = p.scenes.findIndex((s) => s.id === sceneId);
    const to = i + delta;
    if (i < 0 || to < 0 || to >= p.scenes.length) return;
    const [s] = p.scenes.splice(i, 1);
    p.scenes.splice(to, 0, s);
  });
}

export function addCharacter(): void {
  const p = useEditor.getState().project;
  if (!p) return;
  const count = Object.keys(p.characters).length;
  let n = count + 1;
  while (p.characters[`char${n}`]) n++;
  const id = `char${n}`;
  update((d) => {
    d.characters[id] = { name: `ตัวละคร ${n}`, color: CHARACTER_COLORS[count % CHARACTER_COLORS.length] };
  });
  select({ kind: "character", id });
}

export function deleteCharacter(id: string): void {
  const p = useEditor.getState().project;
  if (!p) return;
  if (p.scenes.some((s) => s.lines.some((l) => l.character === id) || s.cast?.includes(id))) {
    throw new Error("ตัวละครนี้ยังมีบทพูดอยู่ เปลี่ยนคนพูดหรือลบบทของเขาก่อน");
  }
  if (Object.keys(p.characters).length === 1) throw new Error("ต้องมีตัวละครอย่างน้อย 1 ตัว");
  update((d) => {
    delete d.characters[id];
  });
  select({ kind: "project" });
}

/** ฉากที่คำสั่งเกี่ยวกับฉากควรใช้: ฉากที่เลือก หรือฉากของบรรทัดที่เลือก หรือฉากแรก */
export function activeSceneId(): string | undefined {
  const { project, selection } = useEditor.getState();
  if (!project) return undefined;
  if (selection.kind === "scene") return selection.id;
  if (selection.kind === "line") return project.scenes.find((s) => s.lines.some((l) => l.id === selection.id))?.id;
  return project.scenes[0]?.id;
}

// ---------- คำสั่งของไทม์ไลน์ ----------

/** ช่องว่างก่อนบรรทัด: pauseAfter ของบรรทัดก่อนหน้า หรือ holdStart ของฉากถ้าเป็นบรรทัดแรก */
function gapBefore(p: Project, lineId: string): { get: () => number; set: (v: number) => void } {
  const f = findLine(p, lineId)!;
  const prev = f.scene.lines[f.index - 1];
  return prev
    ? { get: () => prev.pauseAfter, set: (v) => (prev.pauseAfter = Math.max(0, v)) }
    : { get: () => f.scene.holdStart, set: (v) => (f.scene.holdStart = Math.max(0, v)) };
}

/** ช่องว่างหลังบรรทัด: pauseAfter ของมันเอง หรือ holdEnd ของฉากถ้าเป็นบรรทัดสุดท้าย */
function gapAfter(p: Project, lineId: string): { get: () => number; set: (v: number) => void } {
  const f = findLine(p, lineId)!;
  const line = f.scene.lines[f.index];
  return f.index < f.scene.lines.length - 1
    ? { get: () => line.pauseAfter, set: (v) => (line.pauseAfter = Math.max(0, v)) }
    : { get: () => f.scene.holdEnd, set: (v) => (f.scene.holdEnd = Math.max(0, v)) };
}

const startOf = (p: Project, lineId: string) =>
  computeLayout(p, useEditor.getState().timeline).lines.find((l) => l.id === lineId)!;

/**
 * ย้ายคลิปบทพูดไปเริ่มที่เวลา `time` (และเปลี่ยนคนพูดถ้าลากไปแทร็กอื่น)
 * ถ้าข้ามคลิปอื่นจะสลับลำดับให้ ripple เปิด = คลิปถัดไปเลื่อนตาม, ปิด = คลิปอื่นอยู่ที่เดิม
 */
export function moveLineTo(lineId: string, time: number, character?: string): void {
  const { ripple, project } = useEditor.getState();
  if (!project) return;
  update((p) => {
    const before = startOf(p, lineId);
    const from = findLine(p, lineId)!;
    const line = from.scene.lines[from.index];
    if (character && p.characters[character]) line.character = character;

    // หาฉากและตำแหน่งใหม่จากเวลา (เทียบกับคลิปอื่นที่ไม่ใช่ตัวมันเอง)
    const lay = computeLayout(p, useEditor.getState().timeline);
    // บทเดียวของฉากย้ายออกไม่ได้ (ฉากจะว่าง) จึงให้อยู่ในฉากเดิม แค่ขยับเวลา/เปลี่ยนคนพูด
    const target =
      from.scene.lines.length === 1
        ? lay.scenes.find((s) => s.id === from.scene.id)!
        : (lay.scenes.find((s) => time < s.start + s.duration) ?? lay.scenes[lay.scenes.length - 1]);
    const others = lay.lines.filter((l) => l.sceneId === target.id && l.id !== lineId);
    const nextOther = others.find((l) => l.start + l.duration / 2 > time);
    const sameSpot =
      target.id === from.scene.id &&
      (nextOther ? from.scene.lines[from.index + 1]?.id === nextOther.id : from.index === from.scene.lines.length - 1);

    if (!sameSpot) {
      // ปิด ripple: เติมช่องที่คลิปออกไป เพื่อให้คลิปหลังจากนั้นอยู่ที่เดิม
      if (!ripple) gapBefore(p, lineId).set(gapBefore(p, lineId).get() + before.duration + gapAfter(p, lineId).get());
      from.scene.lines.splice(from.index, 1);
      const scene = p.scenes.find((s) => s.id === target.id)!;
      const at = nextOther ? scene.lines.findIndex((l) => l.id === nextOther.id) : scene.lines.length;
      scene.lines.splice(at, 0, line);
    }

    // ปรับช่องว่างก่อนคลิปให้คลิปเริ่มตรงเวลาที่ปล่อย
    const now = startOf(p, lineId);
    const gap = gapBefore(p, lineId);
    const wanted = Math.max(0, gap.get() + (time - now.start));
    const delta = wanted - gap.get();
    gap.set(wanted);
    if (!ripple) gapAfter(p, lineId).set(gapAfter(p, lineId).get() - delta);
  });
}

/** ลากขอบคลิปเพื่อตัดหัว (start) หรือท้าย (end) */
export function trimLine(lineId: string, edge: "start" | "end", trim: number): void {
  const { ripple } = useEditor.getState();
  update((p) => {
    const f = findLine(p, lineId);
    if (!f) return;
    const line = f.scene.lines[f.index];
    const info = startOf(p, lineId);
    const source = info.sourceDuration ?? info.duration;
    const other = edge === "start" ? line.trimEnd : line.trimStart;
    const value = Math.max(0, Math.min(trim, source - other - MIN_CLIP));
    const delta = value - (edge === "start" ? line.trimStart : line.trimEnd);
    if (edge === "start") {
      line.trimStart = value;
      // ปิด ripple: ขอบซ้ายขยับตามเมาส์ ส่วนท้ายคลิปอยู่ที่เดิม
      if (!ripple) gapBefore(p, lineId).set(gapBefore(p, lineId).get() + delta);
    } else {
      line.trimEnd = value;
      if (!ripple) gapAfter(p, lineId).set(gapAfter(p, lineId).get() + delta);
    }
  });
}

/** ตัวอักษรไทยที่ต้องติดกับพยัญชนะหน้า (สระบน/ล่าง วรรณยุกต์) ห้ามแยกตรงนั้น */
const COMBINING = /[ัิ-ฺ็-๎]/;

function splitText(text: string, ratio: number): [string, string] {
  let i = Math.round(text.length * ratio);
  // หาช่องว่างใกล้ ๆ ก่อน (ภาษาอังกฤษ / ไทยที่เว้นวรรค)
  const window = Math.max(3, Math.round(text.length * 0.2));
  for (let d = 0; d <= window; d++) {
    if (text[i - d] === " ") {
      i = i - d;
      break;
    }
    if (text[i + d] === " ") {
      i = i + d;
      break;
    }
  }
  while (i < text.length && COMBINING.test(text[i])) i++;
  const a = text.slice(0, i).trim();
  const b = text.slice(i).trim();
  return [a || text, b || "…"];
}

/** แยกคลิปที่เวลา `time` เป็นสองบรรทัด (เสียง TTS ถูกตรึงเป็นไฟล์ก่อน เพื่อให้ตัดคนละช่วงได้) */
export async function splitLine(lineId: string, time: number): Promise<void> {
  const st = useEditor.getState();
  if (!st.project) return;
  const info = startOf(st.project, lineId);
  const offset = time - info.start;
  if (offset < MIN_CLIP || info.duration - offset < MIN_CLIP) throw new Error("วางเส้นเวลาไว้กลางคลิปที่จะแยก");
  const found = findLine(st.project, lineId)!;
  let audio = found.scene.lines[found.index].audio;
  if (!audio) {
    const served = st.timeline?.lines.find((l) => l.id === lineId);
    if (!served?.audio || served.text !== info.text) throw new Error("รอให้เตรียมเสียงเสร็จก่อนแยกคลิป");
    const source = served.audio.replace(/-t\d+-\d+\.wav$/, ".wav");
    audio = (await api<{ path: string }>(`/api/projects/${st.name}/freeze`, { method: "POST", body: { audio: source } })).path;
  }
  const secondId = newId("l");
  update((p) => {
    const f = findLine(p, lineId)!;
    const line = f.scene.lines[f.index];
    const cut = line.trimStart + offset;
    const source = info.sourceDuration ?? info.duration;
    const [ta, tb] = splitText(line.text, offset / info.duration);
    const second = { ...structuredClone(line), id: secondId, text: tb, audio, trimStart: cut };
    Object.assign(line, { text: ta, audio, trimEnd: source - cut, pauseAfter: 0 });
    f.scene.lines.splice(f.index + 1, 0, second);
  });
  select({ kind: "line", id: secondId });
}

export function setSceneHold(sceneId: string, edge: "start" | "end", value: number): void {
  update((p) => {
    const s = p.scenes.find((x) => x.id === sceneId);
    if (s) s[edge === "start" ? "holdStart" : "holdEnd"] = Math.max(0, Math.round(value * 100) / 100);
  });
}

export function setTrackState(character: string, patch: Partial<TrackState>, coalesce?: string): void {
  useEditor.getState().update((p) => {
    const base: TrackState = { muted: false, solo: false, locked: false, hidden: false, volume: 1 };
    p.tracks[character] = Object.assign(base, p.tracks[character], patch);
  }, coalesce);
}

export function isLocked(character: string): boolean {
  return !!useEditor.getState().project?.tracks[character]?.locked;
}

export function addMarker(time: number): void {
  update((p) => {
    p.markers.push({ id: newId("m"), time: Math.max(0, time), label: `จุดที่ ${p.markers.length + 1}` });
    p.markers.sort((a, b) => a.time - b.time);
  });
}

export function moveMarker(id: string, time: number): void {
  update((p) => {
    const m = p.markers.find((x) => x.id === id);
    if (m) m.time = Math.max(0, time);
    p.markers.sort((a, b) => a.time - b.time);
  });
}

export function renameMarker(id: string, label: string): void {
  update((p) => {
    const m = p.markers.find((x) => x.id === id);
    if (m) m.label = label;
  });
}

export function removeMarker(id: string): void {
  update((p) => {
    p.markers = p.markers.filter((x) => x.id !== id);
  });
}

// ---------- เสียง ----------

/** ใส่ไฟล์เสียงให้บรรทัด และเก็บเป็นเทคหนึ่งในรายการเทค */
export function setLineAudio(lineId: string, path: string): void {
  update((p) => {
    const f = findLine(p, lineId);
    if (!f) return;
    const line = f.scene.lines[f.index];
    line.audio = path;
    line.takes = [...new Set([...(line.takes ?? []), path])];
    // เสียงใหม่ความยาวต่างจากเดิม การตัดเก่าจึงไม่มีความหมายแล้ว
    line.trimStart = 0;
    line.trimEnd = 0;
  });
}

export function removeTake(lineId: string, path: string): void {
  update((p) => {
    const f = findLine(p, lineId);
    if (!f) return;
    const line = f.scene.lines[f.index];
    line.takes = line.takes.filter((t) => t !== path);
    if (line.audio === path) line.audio = line.takes[line.takes.length - 1];
  });
}

export function patchFx(lineId: string, patch: Partial<AudioFx>, coalesce?: string): void {
  useEditor.getState().update((p) => {
    const f = findLine(p, lineId);
    if (!f) return;
    const line = f.scene.lines[f.index];
    line.fx = { ...line.fx, ...patch, eq: { ...line.fx.eq, ...patch.eq } };
  }, coalesce);
}

/** คัดลอกเอฟเฟกต์ของบรรทัดนี้ไปทุกบรรทัดของตัวละครเดียวกัน */
export function applyFxToCharacter(lineId: string): number {
  let count = 0;
  update((p) => {
    const f = findLine(p, lineId);
    if (!f) return;
    const src = f.scene.lines[f.index];
    for (const s of p.scenes)
      for (const l of s.lines)
        if (l.character === src.character && l.id !== src.id) {
          l.fx = structuredClone(src.fx);
          count++;
        }
  });
  return count;
}

/** วางไฟล์เสียงลงไทม์ไลน์: สร้างบทพูดใหม่ของตัวละครนั้นที่เวลาที่ปล่อย */
export function insertAudioLine(character: string, time: number, path: string, label: string): string {
  const id = newId("l");
  const { project, timeline } = useEditor.getState();
  if (!project) return id;
  const lay = computeLayout(project, timeline);
  const scene = lay.scenes.find((s) => time < s.start + s.duration) ?? lay.scenes[lay.scenes.length - 1];
  update((p) => {
    const s = p.scenes.find((x) => x.id === scene.id)!;
    s.lines.push(blankLine(id, character, { text: label, audio: path, takes: [path] }));
  });
  moveLineTo(id, time);
  select({ kind: "line", id });
  return id;
}

export async function uploadVoice(name: string, wav: Blob): Promise<{ path: string; duration: number }> {
  return api<{ path: string; duration: number }>(`/api/projects/${name}/voice`, { method: "POST", raw: wav });
}

export async function uploadAsset(name: string, file: Blob, ext: string): Promise<string> {
  const res = await api<{ path: string }>(`/api/projects/${name}/asset?ext=${encodeURIComponent(ext)}`, { method: "POST", raw: file });
  return res.path;
}

/** บทพูดใหม่ที่มีค่าเริ่มต้นครบตาม schema (ข้อความว่างให้ผู้ใช้พิมพ์) */
export function blankLine(id: string, character: string, patch: Partial<Line> = {}): Line {
  return { ...LineSchema.parse({ id, character, text: "-" }), text: "", ...patch };
}
