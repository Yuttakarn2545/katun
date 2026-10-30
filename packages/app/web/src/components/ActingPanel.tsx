import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { CameraMove, Emotion, Gesture, Project } from "../../../../core/src/schema";
import { FONT_NAMES } from "../../../../renderer/src/fonts";
import { patchLine } from "../lib/ops";
import { useEditor } from "../lib/store";

// การแสดง (อารมณ์/ท่าทาง/กล้อง), สไตล์ฉาก (ทรานสิชัน/กล้อง/ตำแหน่งตัวละคร) และสไตล์ซับ

type Line = Project["scenes"][number]["lines"][number];
type Scene = Project["scenes"][number];

export const EMOTION_LABEL: Record<Emotion, string> = {
  neutral: "😐 ปกติ",
  happy: "😊 ดีใจ",
  laugh: "😆 หัวเราะ",
  surprised: "😮 ตกใจ",
  sad: "😢 เศร้า",
  angry: "😠 โกรธ",
  confused: "😕 งง",
  shy: "😳 เขิน",
};
const GESTURE_LABEL: Record<Gesture, string> = { none: "ไม่มี", wave: "👋 โบกมือ", nod: "พยักหน้า", shake: "ส่ายหัว", jump: "กระโดด", point: "👉 ชี้", tremble: "สั่น" };
const CAMERA_LABEL: Record<CameraMove, string> = { none: "ไม่มี", zoomIn: "ค่อย ๆ ซูมเข้า", punch: "ซูมกระแทก", shake: "กล้องสั่น" };

function Chips<T extends string>({ value, labels, onChange }: { value: T; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.entries(labels) as [T, string][]).map(([v, label]) => (
        <button key={v} type="button" className={value === v ? "chip-on h-6 px-2.5" : "chip h-6 px-2.5"} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

export function LineActing({ line }: { line: Line }) {
  return (
    <div className="space-y-3">
      <Row label="สีหน้า (คงอยู่จนกว่าตัวละครนี้จะพูดบทถัดไป)">
        <Chips value={line.emotion} labels={EMOTION_LABEL} onChange={(v) => patchLine(line.id, { emotion: v })} />
      </Row>
      <Row label="ท่าทางระหว่างพูด">
        <Chips value={line.gesture} labels={GESTURE_LABEL} onChange={(v) => patchLine(line.id, { gesture: v })} />
      </Row>
      <Row label="กล้อง">
        <Chips value={line.camera} labels={CAMERA_LABEL} onChange={(v) => patchLine(line.id, { camera: v })} />
      </Row>
    </div>
  );
}

const TRANSITION_LABEL = { none: "ตัดทันที", fade: "จาง", slideLeft: "เลื่อนจากขวา", slideUp: "เลื่อนขึ้น", wipe: "เช็ด", zoom: "ซูม", iris: "วงกลม" } as const;
const ENTER_LABEL = { none: "อยู่แล้ว", left: "เดินจากซ้าย", right: "เดินจากขวา", bottom: "โผล่จากล่าง", pop: "เด้งออกมา" } as const;

export function SceneStyle({ scene }: { scene: Scene }) {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const index = project.scenes.findIndex((s) => s.id === scene.id);
  const set = (fn: (s: Scene) => void, coalesce?: string) =>
    update((p) => {
      const s = p.scenes.find((x) => x.id === scene.id);
      if (s) fn(s);
    }, coalesce && `${coalesce}:${scene.id}`);
  const cast = scene.cast ?? [...new Set(scene.lines.map((l) => l.character))];

  return (
    <div className="space-y-4">
      <Row label={index === 0 ? "ทรานสิชันเปิดเรื่อง (จากจอดำ)" : "ทรานสิชันเข้าฉากนี้"}>
        <Chips value={scene.transition.type} labels={TRANSITION_LABEL} onChange={(v) => set((s) => (s.transition.type = v))} />
        {scene.transition.type !== "none" && (
          <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            ความยาว
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.05}
              className="flex-1"
              value={scene.transition.duration}
              onChange={(e) => set((s) => (s.transition.duration = Number(e.target.value)), "trd")}
            />
            <span className="w-12 text-right font-mono text-[11px]">{scene.transition.duration.toFixed(2)} วิ</span>
          </label>
        )}
      </Row>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={scene.autoFocus} onChange={(e) => set((s) => (s.autoFocus = e.target.checked))} />
        กล้องซูมเข้าหาคนที่กำลังพูดอัตโนมัติ
      </label>
      <Row label="ตัวละครในฉาก (ลากบนจอวิดีโอเพื่อย้ายได้)">
        <div className="space-y-2">
          {cast.map((id) => {
            const c = project.characters[id];
            const l = scene.layout[id];
            return (
              <div key={id} className="space-y-1.5 rounded-lg bg-app/60 p-2">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c?.color }} />
                  <span className="flex-1">{c?.name}</span>
                  {l && (
                    <button className="text-faint hover:text-fg" title="จัดอัตโนมัติ" onClick={() => set((s) => void delete s.layout[id])}>
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-muted">
                  <label>
                    ขนาด {Math.round((l?.scale ?? 1) * 100)}%
                    <input
                      type="range"
                      min={0.4}
                      max={2}
                      step={0.05}
                      className="w-full"
                      value={l?.scale ?? 1}
                      onChange={(e) => set((s) => castPatch(s, id, { scale: Number(e.target.value) }), `cs:${id}`)}
                    />
                  </label>
                  <label>
                    หันหน้า
                    <select
                      className="input h-7"
                      value={l?.facing ?? 0}
                      onChange={(e) => set((s) => castPatch(s, id, { facing: Number(e.target.value) as 0 | 1 | -1 }))}
                    >
                      <option value={0}>อัตโนมัติ</option>
                      <option value={1}>ขวา</option>
                      <option value={-1}>ซ้าย</option>
                    </select>
                  </label>
                </div>
                <select
                  className="input h-7 text-[12px]"
                  value={l?.enter ?? "none"}
                  onChange={(e) => set((s) => castPatch(s, id, { enter: e.target.value as keyof typeof ENTER_LABEL }))}
                >
                  {Object.entries(ENTER_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      เข้าฉาก: {label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </Row>
    </div>
  );
}

const SUB_STYLE_LABEL = { classic: "กล่องดำ", minimal: "มินิมอล", bold: "ตัวหนา TikTok", bubble: "ฟองคำพูด" } as const;

export function SubtitleStyle() {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const s = project.subtitles;
  const set = (fn: (sub: Project["subtitles"]) => void, coalesce?: string) => update((p) => fn(p.subtitles), coalesce);
  return (
    <div className="space-y-3">
      <Row label="สไตล์">
        <Chips value={s.style} labels={SUB_STYLE_LABEL} onChange={(v) => set((x) => (x.style = v))} />
      </Row>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={s.karaoke} onChange={(e) => set((x) => (x.karaoke = e.target.checked))} />
        คาราโอเกะ: ไฮไลต์ทีละคำตามเวลาพูด
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="label">ฟอนต์</span>
          <select className="input" value={s.font} onChange={(e) => set((x) => (x.font = e.target.value))}>
            {FONT_NAMES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">สีตัวอักษร</span>
          <input type="color" className="h-8 w-full cursor-pointer rounded border border-line bg-app" value={s.color} onChange={(e) => set((x) => (x.color = e.target.value), "subc")} />
        </label>
        <label className="block">
          <span className="label">สีไฮไลต์</span>
          <input type="color" className="h-8 w-full cursor-pointer rounded border border-line bg-app" value={s.highlight} onChange={(e) => set((x) => (x.highlight = e.target.value), "subh")} />
        </label>
      </div>
    </div>
  );
}

/** แก้ตำแหน่ง/ขนาด/ทิศ/การเข้าฉากของตัวละครในฉาก (เติมค่าเริ่มต้นให้ครบ) */
export function castPatch(s: Scene, id: string, patch: Partial<Scene["layout"][string]>): void {
  s.layout[id] = Object.assign({ scale: 1, facing: 0, enter: "none" }, s.layout[id], patch) as Scene["layout"][string];
}
