import { z } from "zod";

// project.json: ไฟล์ที่คน (หรือ AI ผ่าน MCP ในเฟส 2) เขียนเพื่อบรรยายวิดีโอหนึ่งเรื่อง

export const VoiceSchema = z.object({
  // azure = Azure Neural TTS (มีเสียงไทย), system = เสียงในตัว Windows (ใช้ทดสอบแบบออฟไลน์)
  provider: z.enum(["azure", "system"]),
  voice: z.string(),
  rate: z.string().optional(), // เช่น "+10%", "-5%" (เฉพาะ azure)
  pitch: z.string().optional(), // เช่น "+2st" (เฉพาะ azure)
});

export const CharacterSchema = z.object({
  name: z.string(),
  color: z.string().default("#f4a261"), // สีตัว
  voice: VoiceSchema.optional(), // ไม่ใส่ = ใช้ voice ของโปรเจกต์
});

export const SCHEMA_VERSION = 2;

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// เอฟเฟกต์เสียงของคลิป (ไม่ทำลายไฟล์ต้นฉบับ: ประมวลผลใหม่ลง build/ ทุกครั้งที่ค่าเปลี่ยน)
export const VOICE_PRESETS = ["none", "radio", "phone", "robot", "megaphone", "underwater"] as const;
export const REVERBS = ["none", "room", "hall", "cave"] as const;

export const AudioFxSchema = z.object({
  gain: z.number().min(0).max(2).default(1), // 0–200%
  fadeIn: z.number().min(0).max(5).default(0), // วินาที
  fadeOut: z.number().min(0).max(5).default(0),
  speed: z.number().min(0.5).max(2).default(1), // เร็ว/ช้า โดยเสียงไม่เพี้ยน
  pitch: z.number().min(-12).max(12).default(0), // semitone โดยความยาวไม่เปลี่ยน
  reverse: z.boolean().default(false),
  denoise: z.number().min(0).max(1).default(0), // ลดเสียงรบกวน 0–100%
  normalize: z.boolean().default(false), // ปรับความดังคลิปให้สม่ำเสมอ
  compressor: z.boolean().default(false),
  highpass: z.boolean().default(false), // ตัดเสียงต่ำ/เสียงลมต่ำกว่า ~90Hz
  eq: z
    .object({
      low: z.number().min(-12).max(12).default(0), // dB
      mid: z.number().min(-12).max(12).default(0),
      high: z.number().min(-12).max(12).default(0),
    })
    .prefault({}),
  voice: z.enum(VOICE_PRESETS).default("none"),
  echo: z.number().min(0).max(1).default(0),
  reverb: z.enum(REVERBS).default("none"),
});

// การแสดงต่อบทพูด
export const EMOTIONS = ["neutral", "happy", "laugh", "surprised", "sad", "angry", "confused", "shy"] as const;
export const GESTURES = ["none", "wave", "nod", "shake", "jump", "point", "tremble"] as const;
export const CAMERA_MOVES = ["none", "zoomIn", "punch", "shake"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type Gesture = (typeof GESTURES)[number];
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const LineSchema = z.object({
  id: z.string().default(() => newId("l")), // id ถาวร ใช้เลือก/อ้างอิงบรรทัดในโปรแกรมและ MCP
  character: z.string(),
  text: z.string().min(1),
  // ไฟล์เสียงที่อัดเองหรืออัปโหลด (WAV) ใส่แล้วจะไม่เรียก TTS; path อิงจากโฟลเดอร์โปรเจกต์
  audio: z.string().optional(),
  pauseAfter: z.number().min(0).default(0.35), // วินาที
  // ตัดหัว/ท้ายเสียง (วินาที) จากการลากขอบคลิปในไทม์ไลน์ ไฟล์ต้นฉบับไม่ถูกแก้
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).default(0),
  fx: AudioFxSchema.prefault({}),
  takes: z.array(z.string()).default([]), // เทคเสียงที่เคยอัด/อัปโหลดของบรรทัดนี้ (audio = เทคที่เลือก)
  emotion: z.enum(EMOTIONS).default("neutral"), // สีหน้าของคนพูดระหว่างบรรทัดนี้
  gesture: z.enum(GESTURES).default("none"), // ท่าทางระหว่างพูด
  camera: z.enum(CAMERA_MOVES).default("none"), // กล้องระหว่างบรรทัดนี้
});

// ตัวละครในฉาก: ตำแหน่ง ขนาด ทิศหน้า และการเข้าฉาก (ไม่ใส่ = จัดให้อัตโนมัติ)
export const CastPlacementSchema = z.object({
  x: z.number().min(-0.5).max(1.5).optional(), // 0–1 ของความกว้างจอ
  scale: z.number().min(0.2).max(3).default(1),
  facing: z.union([z.literal(1), z.literal(-1), z.literal(0)]).default(0), // 0 = หันเข้าหากลางจออัตโนมัติ
  enter: z.enum(["none", "left", "right", "bottom", "pop"]).default("none"),
});

export const TRANSITIONS = ["none", "fade", "slideLeft", "slideUp", "wipe", "zoom", "iris"] as const;
export const TransitionSchema = z.object({
  type: z.enum(TRANSITIONS).default("fade"), // ทรานสิชันตอนเข้าฉากนี้ (ฉากแรก = เข้าจากจอดำ)
  duration: z.number().min(0.05).max(3).default(0.4),
});

export const SceneSchema = z.object({
  id: z.string(),
  background: z.string().default("#bde0fe"), // สี CSS หรือ path รูปในโฟลเดอร์โปรเจกต์
  cast: z.array(z.string()).optional(), // ตัวละครที่อยู่บนฉาก ไม่ใส่ = ทุกตัวที่พูดในฉาก
  holdStart: z.number().min(0).default(0.5), // ช่วงว่างก่อนบทแรกของฉาก (วินาที)
  holdEnd: z.number().min(0).default(0.5), // ช่วงว่างหลังบทสุดท้ายของฉาก
  lines: z.array(LineSchema).min(1),
  transition: TransitionSchema.prefault({}),
  autoFocus: z.boolean().default(false), // กล้องค่อย ๆ ซูมเข้าหาคนที่กำลังพูด
  layout: z.record(z.string(), CastPlacementSchema).default({}),
});

// สถานะแทร็กของตัวละครในไทม์ไลน์: ปิดเสียง / ฟังเดี่ยว / ล็อก / ซ่อนตัวละครในวิดีโอ
export const TrackStateSchema = z.object({
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(1), // ความดังของแทร็ก (มิกเซอร์)
});

export const MixSchema = z.object({
  master: z.number().min(0).max(1).default(1),
  duckFade: z.number().min(0.05).max(2).default(0.3), // วินาทีที่เพลงค่อย ๆ เบาลง/ดังขึ้นรอบช่วงพูด
  normalize: z.boolean().default(true), // ปรับความดังรวมตอนส่งออก
  targetLufs: z.number().min(-24).max(-9).default(-14), // YouTube/TikTok ≈ -14 LUFS
});

export const MarkerSchema = z.object({
  id: z.string().default(() => newId("m")),
  time: z.number().min(0),
  label: z.string().default(""),
});

export const SubtitleSchema = z.object({
  enabled: z.boolean().default(true), // แสดงซับในวิดีโอ (ไฟล์ .srt สร้างให้เสมอ)
  position: z.enum(["bottom", "top"]).default("bottom"),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  showName: z.boolean().default(true), // แสดงชื่อคนพูดหน้าซับ
  style: z.enum(["classic", "minimal", "bold", "bubble"]).default("classic"),
  karaoke: z.boolean().default(false), // ไฮไลต์ทีละคำตามเวลาพูด
  font: z.string().default("Sarabun"),
  color: z.string().default("#ffffff"),
  highlight: z.string().default("#ffd166"), // สีคำที่กำลังพูด (คาราโอเกะ) / ชื่อคนพูด
});

export const MusicSchema = z.object({
  file: z.string().describe("path ไฟล์เพลง (mp3/wav/m4a/ogg) อิงจากโฟลเดอร์โปรเจกต์"),
  volume: z.number().min(0).max(1).default(0.25),
  duckTo: z.number().min(0).max(1).default(0.08).describe("ความดังเพลงระหว่างตัวละครพูด"),
});

// ---------- คอมโพเนนต์ (แบบ precomp ของ After Effects) ----------

export const ANIM_PROPS = ["x", "y", "scale", "rotation", "opacity"] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];
export const EASES = ["linear", "easeIn", "easeOut", "easeInOut", "bounce", "hold"] as const;

export const KeyframeSchema = z.object({
  t: z.number().min(0), // วินาทีภายในเลเยอร์ (0 = ต้นเลเยอร์)
  v: z.number(),
  ease: z.enum(EASES).default("easeInOut"), // การเคลื่อนจากคีย์นี้ไปคีย์ถัดไป
});

const LayerBase = {
  id: z.string().default(() => newId("ly")),
  name: z.string().default(""),
  start: z.number().min(0).default(0), // วินาทีภายในคอมโพเนนต์
  duration: z.number().min(0.05).default(3),
  x: z.number().default(0), // จุดกึ่งกลางเลเยอร์ (พิกเซลในคอมโพเนนต์)
  y: z.number().default(0),
  scale: z.number().default(1),
  rotation: z.number().default(0), // องศา
  opacity: z.number().min(0).max(1).default(1),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  keyframes: z.partialRecord(z.enum(ANIM_PROPS), z.array(KeyframeSchema)).default({}),
};

export const LayerSchema = z.discriminatedUnion("type", [
  z.object({
    ...LayerBase,
    type: z.literal("text"),
    text: z.string().default("ข้อความ"),
    font: z.string().default("Kanit"),
    size: z.number().min(4).max(600).default(72),
    color: z.string().default("#ffffff"),
    weight: z.number().min(100).max(900).default(700),
    align: z.enum(["left", "center", "right"]).default("center"),
    strokeColor: z.string().default("#000000"),
    strokeWidth: z.number().min(0).max(40).default(0),
    box: z.string().optional(), // สีพื้นหลังกล่องข้อความ (ไม่ใส่ = ไม่มีกล่อง)
    boxRadius: z.number().min(0).default(16),
    boxPadding: z.number().min(0).default(20),
    maxWidth: z.number().min(40).optional(),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("shape"),
    shape: z.enum(["rect", "ellipse", "star", "bubble"]).default("rect"),
    w: z.number().min(1).default(300),
    h: z.number().min(1).default(200),
    fill: z.string().default("#ffd166"),
    strokeColor: z.string().default("#000000"),
    strokeWidth: z.number().min(0).max(60).default(0),
    radius: z.number().min(0).default(24),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("image"),
    src: z.string(), // path ใน assets/ ของโปรเจกต์
    w: z.number().min(1).default(400),
    h: z.number().min(1).default(400),
    fit: z.enum(["contain", "cover"]).default("contain"),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("character"),
    character: z.string(), // id ตัวละครในโปรเจกต์
    size: z.number().min(20).default(420), // ความสูงพิกเซล
    talking: z.boolean().default(false), // ขยับปากเหมือนพูดตลอดเลเยอร์
    facing: z.union([z.literal(1), z.literal(-1)]).default(1),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("audio"),
    src: z.string(), // path ใน assets/ (SFX ในตัวหรือไฟล์ที่อัปโหลด)
    volume: z.number().min(0).max(1).default(1),
  }),
  z.object({
    ...LayerBase,
    type: z.literal("component"),
    component: z.string(), // id คอมโพเนนต์ที่ซ้อน
  }),
]);

export const ComponentSchema = z.object({
  name: z.string().default("คอมโพเนนต์"),
  width: z.number().int().min(16).max(4096).default(1920),
  height: z.number().int().min(16).max(4096).default(1080),
  duration: z.number().min(0.1).max(600).default(3),
  layers: z.array(LayerSchema).default([]), // ลำดับในอาร์เรย์ = ล่างขึ้นบน (ตัวท้ายอยู่บนสุด)
});

// การวางคอมโพเนนต์ลงเรื่องหลัก: ยึดกับฉาก (เวลาจากต้นฉาก) เพื่อให้เลื่อนตามเมื่อบทเปลี่ยน
export const PlacementSchema = z.object({
  id: z.string().default(() => newId("pl")),
  component: z.string(),
  sceneId: z.string(),
  offset: z.number().min(0).default(0), // วินาทีจากต้นฉาก
  duration: z.number().min(0.05).optional(), // ไม่ใส่ = ความยาวคอมโพเนนต์
  x: z.number().default(0.5), // ตำแหน่งกึ่งกลางบนวิดีโอ (0–1 ของความกว้าง/สูง) ใช้ได้กับทุกขนาดวิดีโอ
  y: z.number().default(0.5),
  scale: z.number().min(0.01).default(1), // 1 = ความกว้างคอมโพเนนต์เท่าความกว้างวิดีโอ
  opacity: z.number().min(0).max(1).default(1),
  volume: z.number().min(0).max(1).default(1), // ความดังของเสียงในคอมโพเนนต์
  loop: z.boolean().default(false), // เล่นวนเมื่อ duration ยาวกว่าคอมโพเนนต์
});

export const MetaSchema = z.object({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  template: z.string().optional(),
});

export const ProjectSchema = z
  .object({
    version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    meta: MetaSchema.prefault({}),
    title: z.string(),
    format: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    fps: z.number().int().min(12).max(60).default(30),
    voice: VoiceSchema,
    characters: z.record(z.string(), CharacterSchema),
    scenes: z.array(SceneSchema).min(1),
    subtitles: SubtitleSchema.prefault({}),
    music: MusicSchema.optional(),
    tracks: z.record(z.string(), TrackStateSchema).default({}),
    markers: z.array(MarkerSchema).default([]),
    mix: MixSchema.prefault({}),
    components: z.record(z.string(), ComponentSchema).default({}),
    placements: z.array(PlacementSchema).default([]),
  })
  .superRefine((p, ctx) => {
    p.scenes.forEach((s, si) => {
      const ids = [...(s.cast ?? []), ...s.lines.map((l) => l.character)];
      for (const id of ids) {
        if (!p.characters[id]) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", si],
            message: `ไม่มีตัวละคร "${id}" ใน characters`,
          });
        }
      }
    });
    // คอมโพเนนต์: อ้างถึงสิ่งที่มีอยู่จริง และซ้อนกันไม่วนกลับมาที่ตัวเอง
    for (const [cid, comp] of Object.entries(p.components)) {
      comp.layers.forEach((l, li) => {
        const path = ["components", cid, "layers", li];
        if (l.type === "component" && !p.components[l.component]) ctx.addIssue({ code: "custom", path, message: `ไม่มีคอมโพเนนต์ "${l.component}"` });
        if (l.type === "character" && !p.characters[l.character]) ctx.addIssue({ code: "custom", path, message: `ไม่มีตัวละคร "${l.character}"` });
      });
      if (componentCycle(p.components, cid)) ctx.addIssue({ code: "custom", path: ["components", cid], message: `คอมโพเนนต์ "${cid}" ซ้อนวนกลับมาที่ตัวเอง` });
    }
    p.placements.forEach((pl, i) => {
      if (!p.components[pl.component]) ctx.addIssue({ code: "custom", path: ["placements", i], message: `ไม่มีคอมโพเนนต์ "${pl.component}"` });
      if (!p.scenes.some((s) => s.id === pl.sceneId)) ctx.addIssue({ code: "custom", path: ["placements", i], message: `ไม่มีฉาก "${pl.sceneId}"` });
    });
  });

/** true ถ้าคอมโพเนนต์ id ซ้อนตัวเองทางตรงหรือทางอ้อม */
export function componentCycle(components: Record<string, { layers: { type: string; component?: string }[] }>, id: string): boolean {
  const visit = (cur: string, seen: Set<string>): boolean => {
    for (const l of components[cur]?.layers ?? []) {
      if (l.type !== "component" || !l.component) continue;
      if (l.component === id || seen.has(l.component)) return true;
      if (visit(l.component, new Set([...seen, l.component]))) return true;
    }
    return false;
  };
  return visit(id, new Set());
}

export type Voice = z.infer<typeof VoiceSchema>;
export type TrackState = z.infer<typeof TrackStateSchema>;
export type AudioFx = z.infer<typeof AudioFxSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Placement = z.infer<typeof PlacementSchema>;

/** การวางคอมโพเนนต์ที่คำนวณเวลาจริงแล้ว (ส่งให้ตัวเรนเดอร์) */
export type TimelinePlacement = Placement & { start: number; duration: number };
export type Project = z.infer<typeof ProjectSchema>;

// timeline.json: ผลลัพธ์จาก pipeline ที่ส่งให้ renderer (เวลาเป็นวินาที)

export type MouthShape = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

export type MouthCue = { start: number; end: number; value: MouthShape };

export type TimelineLine = {
  id?: string; // id ของบรรทัดใน project.json (timeline เก่าอาจไม่มี)
  sceneId?: string;
  character: string;
  text: string;
  audio: string; // path อิงจาก public dir (โฟลเดอร์ build)
  start: number;
  duration: number; // ความยาวหลังตัดหัวท้ายแล้ว
  sourceDuration?: number; // ความยาวไฟล์เสียงก่อนตัด
  trimStart?: number;
  trimEnd?: number;
  muted?: boolean; // จากสถานะแทร็ก (ปิดเสียง / มีแทร็กอื่นฟังเดี่ยว)
  volume?: number; // ความดังแทร็ก × master (0–1)
  emotion?: Emotion;
  gesture?: Gesture;
  camera?: CameraMove;
  key?: string; // ตัวระบุเสียงที่ใช้ (ต้นทาง+ตัด+เอฟเฟกต์) ให้หน้าจอรู้ว่าความยาวยังใช้ได้ไหม
  cues: MouthCue[];
};

export type TimelineScene = {
  id: string;
  background: string;
  cast: string[];
  start: number;
  duration: number;
  transition?: z.infer<typeof TransitionSchema>;
  autoFocus?: boolean;
  layout?: Record<string, z.infer<typeof CastPlacementSchema>>;
};

export type Timeline = {
  title: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  characters: Record<string, { name: string; color: string; hidden?: boolean }>;
  scenes: TimelineScene[];
  lines: TimelineLine[];
  subtitles: z.infer<typeof SubtitleSchema>;
  music?: { src: string; volume: number; duckTo: number; ramp?: number };
  components?: Record<string, Component>;
  placements?: TimelinePlacement[];
};

export const FORMAT_SIZE: Record<Project["format"], { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};
