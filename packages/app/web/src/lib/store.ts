import { useMemo } from "react";
import { create } from "zustand";
import { layoutTimeline, mediaKey, voiceOf, type Layout } from "../../../../core/src/layout";
import type { Project, Timeline } from "../../../../core/src/schema";
import { api, type ProjectResponse, type VoiceOption } from "./api";

// สถานะของหน้าตัดต่อ: โปรเจกต์ที่เปิดอยู่, สิ่งที่เลือก, ประวัติ Undo/Redo, การบันทึกและการเตรียมพรีวิว

export type Selection =
  | { kind: "project" }
  | { kind: "scene"; id: string }
  | { kind: "line"; id: string }
  | { kind: "character"; id: string }
  | { kind: "placement"; id: string }
  | { kind: "component"; id: string }
  | { kind: "layer"; component: string; id: string };

type SaveState = { status: "saved" | "pending" | "saving" | "error"; error?: string };
type PrepState = { status: "idle" | "pending" | "running" | "ready" | "error"; error?: string };

type EditorState = {
  name: string;
  project: Project | null;
  timeline: Timeline | null;
  assetBase: string;
  videoUrl?: string;
  previewUrl?: string;
  srtUrl?: string;
  diskUpdatedAt?: string;
  selection: Selection;
  past: Project[];
  future: Project[];
  save: SaveState;
  prep: PrepState;
  voices: VoiceOption[];
  /** เฟรมปัจจุบันของ Player (ไทม์ไลน์ใช้วาดเส้นเวลา) และคำสั่ง seek จากไทม์ไลน์ */
  frame: number;
  seekRequest: { frame: number; at: number } | null;
  /** ค่าของไทม์ไลน์: ripple = เลื่อนคลิปถัดไปตาม, snap = ดูดเข้าขอบ, pps = พิกเซลต่อวินาที, rate = ความเร็วเล่น (J/K/L) */
  ripple: boolean;
  snap: boolean;
  pps: number;
  rate: number;
  setPrefs: (p: Partial<Pick<EditorState, "ripple" | "snap" | "pps" | "rate">>) => void;
  /** โหมดแก้คอมโพเนนต์ (null = แก้เรื่องหลัก) และเฟรมของ Player คอมโพเนนต์ */
  editing: string | null;
  compFrame: number;
  compSeek: { frame: number; at: number } | null;
  setEditing: (id: string | null) => void;
  setCompFrame: (f: number) => void;
  seekComp: (f: number) => void;

  load: (name: string) => Promise<void>;
  refreshExternal: () => Promise<boolean>;
  /** แก้โปรเจกต์ผ่าน draft (สำเนา) แล้วเก็บประวัติ; coalesce = รวมการพิมพ์ต่อเนื่องเป็น Undo ครั้งเดียว */
  update: (fn: (draft: Project) => void, coalesce?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  flush: () => Promise<boolean>;
  prepareNow: () => Promise<void>;
  setFrame: (f: number) => void;
  seek: (f: number) => void;
  setOutputs: (o: Partial<Pick<EditorState, "videoUrl" | "previewUrl" | "srtUrl">>) => void;
};

const HISTORY_LIMIT = 200;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let prepTimer: ReturnType<typeof setTimeout> | undefined;
let lastCoalesce: { key: string; at: number } | null = null;
let saving: Promise<boolean> = Promise.resolve(true);
let prepRun = 0;
let loadRun = 0;

export const useEditor = create<EditorState>((set, get) => {
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    set({ save: { status: "pending" }, prep: { status: "pending" } });
    saveTimer = setTimeout(() => void get().flush(), 600);
  };

  const schedulePrepare = () => {
    clearTimeout(prepTimer);
    prepTimer = setTimeout(() => void get().prepareNow(), 900);
  };

  return {
    name: "",
    project: null,
    timeline: null,
    assetBase: "",
    selection: { kind: "project" },
    past: [],
    future: [],
    save: { status: "saved" },
    prep: { status: "idle" },
    voices: [],
    frame: 0,
    seekRequest: null,
    ripple: true,
    snap: true,
    pps: 60,
    rate: 1,
    setPrefs: (p) => set(p),
    editing: null,
    compFrame: 0,
    compSeek: null,
    setEditing: (editing) => set({ editing, compFrame: 0, selection: editing ? { kind: "component", id: editing } : { kind: "project" } }),
    setCompFrame: (compFrame) => set({ compFrame }),
    seekComp: (frame) => set({ compSeek: { frame, at: Date.now() } }),

    async load(name) {
      const request = ++loadRun;
      ++prepRun;
      clearTimeout(saveTimer);
      clearTimeout(prepTimer);
      const [data, voices] = await Promise.all([
        api<ProjectResponse>(`/api/projects/${name}`),
        get().voices.length ? Promise.resolve(get().voices) : api<VoiceOption[]>("/api/voices"),
      ]);
      if (request !== loadRun) return;
      set({
        name,
        project: data.project,
        diskUpdatedAt: data.project.meta.updatedAt,
        timeline: data.timeline ?? null,
        assetBase: data.assetBase,
        videoUrl: data.videoUrl,
        previewUrl: data.previewUrl,
        srtUrl: data.srtUrl,
        voices,
        selection: { kind: "project" },
        editing: null,
        compFrame: 0,
        past: [],
        future: [],
        save: { status: "saved" },
        prep: { status: data.timeline ? "ready" : "idle" },
        frame: 0,
      });
      // เตรียมเสียงทุกครั้งที่เปิด (TTS ถูก cache จึงเร็ว) เพื่อให้พรีวิวตรงกับบทล่าสุด
      void get().prepareNow();
    },

    async refreshExternal() {
      const { name, project, save } = get();
      if (!project || save.status !== "saved") return false;
      const data = await api<ProjectResponse>(`/api/projects/${name}`);
      if (get().name !== name || get().project !== project || get().save.status !== "saved") return false;
      const changed = JSON.stringify(data.project) !== JSON.stringify(project);
      const timelineChanged = JSON.stringify(data.timeline ?? null) !== JSON.stringify(get().timeline);
      set({
        ...(changed ? { project: data.project, diskUpdatedAt: data.project.meta.updatedAt, past: [], future: [], selection: { kind: "project" } as Selection, editing: null } : {}),
        ...(timelineChanged ? { timeline: data.timeline ?? null } : {}),
        videoUrl: data.videoUrl, previewUrl: data.previewUrl, srtUrl: data.srtUrl,
      });
      if (changed) {
        ++prepRun;
        void get().prepareNow();
      }
      return changed;
    },

    update(fn, coalesce) {
      const { project, past } = get();
      if (!project) return;
      const draft = structuredClone(project);
      fn(draft);
      const now = Date.now();
      const merge = coalesce && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 1500;
      lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
      set({
        project: draft,
        past: merge ? past : [...past.slice(-HISTORY_LIMIT + 1), project],
        future: [],
      });
      scheduleSave();
    },

    undo() {
      const { past, project, future } = get();
      if (!past.length || !project) return;
      lastCoalesce = null;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
      scheduleSave();
    },

    redo() {
      const { past, project, future } = get();
      if (!future.length || !project) return;
      lastCoalesce = null;
      set({ project: future[0], future: future.slice(1), past: [...past, project] });
      scheduleSave();
    },

    select: (selection) => set({ selection }),

    flush() {
      clearTimeout(saveTimer);
      const run = async () => {
        const { name, project, save, diskUpdatedAt } = get();
        if (!project || save.status === "saved") return true;
        set({ save: { status: "saving" } });
        try {
          const saved = await api<Project>(`/api/projects/${name}`, { method: "PUT", body: { project, expectedUpdatedAt: diskUpdatedAt } });
          // เก็บ meta ที่ server เติมให้ โดยไม่ทับสิ่งที่ผู้ใช้แก้ระหว่างรอ
          if (get().name !== name) return true;
          const changed = get().project !== project;
          set((s) => ({ project: s.project ? { ...s.project, meta: saved.meta } : s.project, diskUpdatedAt: saved.meta.updatedAt, save: { status: changed ? "pending" : "saved" } }));
          if (changed) scheduleSave();
          else schedulePrepare();
          return true;
        } catch (err) {
          if (get().name === name) set({ save: { status: "error", error: (err as Error).message }, prep: { status: "error", error: "บันทึกไม่สำเร็จ ตรวจข้อความด้านบนก่อน" } });
          return false;
        }
      };
      saving = saving.then(run);
      return saving;
    },

    async prepareNow() {
      const run = ++prepRun;
      if (!(await get().flush())) return;
      set({ prep: { status: "running" } });
      try {
        const res = await api<{ timeline: Timeline; srtUrl: string }>(`/api/projects/${get().name}/prepare`, { method: "POST" });
        // ถ้ามีการแก้ใหม่ระหว่างเตรียม ผลนี้เก่าแล้ว ให้รอบถัดไปจัดการ
        if (run !== prepRun) return;
        set({ timeline: res.timeline, srtUrl: res.srtUrl, prep: { status: get().save.status === "saved" ? "ready" : "pending" } });
      } catch (err) {
        if (run === prepRun) set({ prep: { status: "error", error: (err as Error).message } });
      }
    },

    setFrame: (frame) => set({ frame }),
    seek: (frame) => set({ seekRequest: { frame, at: Date.now() } }),
    setOutputs: (o) => set(o),
  };
});

/**
 * เวลาของทุกคลิปตาม project ล่าสุด (คำนวณทันทีด้วย layout เดียวกับ server)
 * ใช้ความยาวเสียงจริงจาก timeline ที่ server เตรียมไว้ บรรทัดที่ยังไม่มีเสียงใช้ค่าประมาณ
 */
export function computeLayout(project: Project, timeline: Timeline | null): Layout {
  const media = new Map((timeline?.lines ?? []).filter((l) => l.id).map((l) => [l.id!, l]));
  return layoutTimeline(project, (line) => {
    const m = media.get(line.id);
    if (!m) return undefined;
    const source = { audio: m.audio, sourceDuration: m.sourceDuration ?? m.duration, cues: m.cues };
    // เสียงยังเป็นตัวเดิมทั้งต้นทาง การตัด และเอฟเฟกต์ → ใช้ความยาวจริง
    if (m.key === mediaKey(line, voiceOf(project, line))) return { ...source, duration: m.duration, key: m.key };
    // ต้นทางเดิมแต่ตัด/เอฟเฟกต์เปลี่ยน → ใช้ความยาวต้นฉบับคำนวณใหม่; ต้นทางเปลี่ยน (TTS ข้อความใหม่) → ประมาณจากข้อความ
    const sameSource = m.key ? JSON.parse(m.key)[0] === JSON.parse(mediaKey(line, voiceOf(project, line)))[0] : line.audio || m.text === line.text;
    return sameSource ? source : undefined;
  });
}

export function useLayout(): Layout | null {
  const project = useEditor((s) => s.project);
  const timeline = useEditor((s) => s.timeline);
  return useMemo(() => (project ? computeLayout(project, timeline) : null), [project, timeline]);
}

export const currentLayout = (): Layout | null => {
  const { project, timeline } = useEditor.getState();
  return project ? computeLayout(project, timeline) : null;
};

export function useCurrent() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const line =
    selection.kind === "line"
      ? project?.scenes.flatMap((s) => s.lines.map((l) => ({ scene: s, line: l }))).find((x) => x.line.id === selection.id)
      : undefined;
  const scene = selection.kind === "scene" ? project?.scenes.find((s) => s.id === selection.id) : line?.scene;
  return { project, selection, line: line?.line, scene };
}
