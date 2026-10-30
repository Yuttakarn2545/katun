import { Check, Loader2, Play, RotateCcw, Square, Trash2, Wand2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { NEUTRAL_FX, isNeutralFx } from "../../../../core/src/dsp";
import { mediaKey, voiceOf } from "../../../../core/src/layout";
import type { AudioFx, Project } from "../../../../core/src/schema";
import { applyFxToCharacter, patchFx, removeTake, setLineAudio, setTrackState } from "../lib/ops";
import { useEditor } from "../lib/store";
import { toast, toastError } from "./ui";

// แผงเสียง: เอฟเฟกต์ของคลิป, เทคเสียง, มิกเซอร์ของทั้งเรื่อง

type Line = Project["scenes"][number]["lines"][number];

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  coalesce,
  neutral,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number, coalesce: string) => void;
  coalesce: string;
  neutral?: number;
}) {
  const changed = neutral !== undefined && Math.abs(value - neutral) > 1e-6;
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center text-[12px] text-muted">
        {label}
        <span className="flex-1" />
        <span className={`font-mono text-[11px] ${changed ? "text-accent" : "text-faint"}`}>{format(value)}</span>
        {changed && (
          <button type="button" className="ml-1 text-faint hover:text-fg" title="คืนค่าเดิม" onClick={() => onChange(neutral!, `${coalesce}:reset`)}>
            <RotateCcw size={11} />
          </button>
        )}
      </span>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value), coalesce)} onDoubleClick={() => neutral !== undefined && onChange(neutral, `${coalesce}:reset`)} />
    </label>
  );
}

function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? "chip-on h-6 px-2.5" : "chip h-6 px-2.5"} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px]" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5 rounded-lg bg-app/60 p-3">
      <div className="text-[11px] font-semibold tracking-wide text-faint">{title}</div>
      {children}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => `${v.toFixed(2)} วิ`;
const dbf = (v: number) => `${v > 0 ? "+" : ""}${v} dB`;

/** เอฟเฟกต์เสียงของคลิป (ไม่ทำลายไฟล์ต้นฉบับ) */
export function FxPanel({ line }: { line: Line }) {
  const fx = line.fx;
  const set = (patch: Partial<AudioFx>, coalesce?: string) => patchFx(line.id, patch, coalesce && `${coalesce}:${line.id}`);
  const [listening, setListening] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ฟังผล: รอให้ server ประมวลผลเสียงล่าสุดเสร็จ แล้วเล่นคลิปนี้คลิปเดียว
  const listen = async () => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setListening(false);
      return;
    }
    setListening(true);
    try {
      const st = useEditor.getState();
      await st.prepareNow();
      const s = useEditor.getState();
      const cur = s.project?.scenes.flatMap((x) => x.lines).find((l) => l.id === line.id);
      const served = s.timeline?.lines.find((l) => l.id === line.id);
      if (!cur || !served || served.key !== mediaKey(cur, voiceOf(s.project!, cur))) throw new Error(s.prep.error ?? "เสียงยังไม่พร้อม ลองอีกครั้ง");
      const a = new Audio(`${s.assetBase}/${served.audio}`);
      audioRef.current = a;
      a.onended = () => setListening(false);
      await a.play();
    } catch (err) {
      setListening(false);
      toastError(err);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className="btn h-7 flex-1 text-[12px]" onClick={listen}>
          {listening ? <Square size={12} /> : <Play size={13} />} {listening ? "หยุด" : "ฟังผล"}
        </button>
        <button
          className="btn h-7 text-[12px]"
          title="ใช้เอฟเฟกต์ชุดนี้กับทุกบทของตัวละครนี้"
          onClick={() => toast(`คัดลอกเอฟเฟกต์ไป ${applyFxToCharacter(line.id)} บรรทัด`)}
        >
          <Wand2 size={13} /> ใช้กับทั้งตัวละคร
        </button>
        {!isNeutralFx(fx) && (
          <button className="btn-icon h-7 w-7" title="ล้างเอฟเฟกต์ทั้งหมด" onClick={() => set(structuredClone(NEUTRAL_FX))}>
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      <Group title="พื้นฐาน">
        <Slider label="ความดัง" value={fx.gain} min={0} max={2} step={0.01} format={pct} neutral={1} coalesce="gain" onChange={(v, c) => set({ gain: v }, c)} />
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Fade เข้า" value={fx.fadeIn} min={0} max={2} step={0.05} format={sec} neutral={0} coalesce="fi" onChange={(v, c) => set({ fadeIn: v }, c)} />
          <Slider label="Fade ออก" value={fx.fadeOut} min={0} max={2} step={0.05} format={sec} neutral={0} coalesce="fo" onChange={(v, c) => set({ fadeOut: v }, c)} />
        </div>
        <Slider label="ความเร็ว (เสียงไม่เพี้ยน)" value={fx.speed} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} neutral={1} coalesce="speed" onChange={(v, c) => set({ speed: v }, c)} />
        <Slider label="ระดับเสียง (ความยาวเท่าเดิม)" value={fx.pitch} min={-12} max={12} step={1} format={(v) => `${v > 0 ? "+" : ""}${v} st`} neutral={0} coalesce="pitch" onChange={(v, c) => set({ pitch: v }, c)} />
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["ตัวการ์ตูน", 7],
              ["เด็ก", 4],
              ["ปกติ", 0],
              ["ผู้ใหญ่", -3],
              ["ยักษ์", -6],
            ] as const
          ).map(([label, st]) => (
            <button key={label} className={fx.pitch === st ? "chip-on h-6 px-2.5" : "chip h-6 px-2.5"} onClick={() => set({ pitch: st })}>
              {label}
            </button>
          ))}
        </div>
        <Toggle label="กลับด้านเสียง" on={fx.reverse} onChange={(v) => set({ reverse: v })} />
      </Group>

      <Group title="ทำความสะอาดเสียง">
        <Slider label="ลดเสียงรบกวน (พัดลม แอร์ เสียงซ่า)" value={fx.denoise} min={0} max={1} step={0.05} format={pct} neutral={0} coalesce="dn" onChange={(v, c) => set({ denoise: v }, c)} />
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="ปรับความดังอัตโนมัติ" on={fx.normalize} onChange={(v) => set({ normalize: v })} hint="ทำให้คลิปนี้ดังพอ ๆ กับคลิปอื่น" />
          <Toggle label="คอมเพรสเซอร์" on={fx.compressor} onChange={(v) => set({ compressor: v })} hint="เสียงพูดสม่ำเสมอ ฟังชัด" />
          <Toggle label="ตัดเสียงต่ำ/ลม" on={fx.highpass} onChange={(v) => set({ highpass: v })} />
        </div>
      </Group>

      <Group title="EQ">
        <Slider label="เสียงต่ำ (เบส)" value={fx.eq.low} min={-12} max={12} step={1} format={dbf} neutral={0} coalesce="eql" onChange={(v, c) => set({ eq: { ...fx.eq, low: v } }, c)} />
        <Slider label="เสียงกลาง" value={fx.eq.mid} min={-12} max={12} step={1} format={dbf} neutral={0} coalesce="eqm" onChange={(v, c) => set({ eq: { ...fx.eq, mid: v } }, c)} />
        <Slider label="เสียงแหลม" value={fx.eq.high} min={-12} max={12} step={1} format={dbf} neutral={0} coalesce="eqh" onChange={(v, c) => set({ eq: { ...fx.eq, high: v } }, c)} />
      </Group>

      <Group title="เสียงพิเศษ">
        <Chips
          value={fx.voice}
          onChange={(v) => set({ voice: v })}
          options={[
            ["none", "ไม่มี"],
            ["radio", "วิทยุ"],
            ["phone", "โทรศัพท์"],
            ["megaphone", "โทรโข่ง"],
            ["robot", "หุ่นยนต์"],
            ["underwater", "ใต้น้ำ"],
          ]}
        />
        <Slider label="เสียงสะท้อน (Echo)" value={fx.echo} min={0} max={1} step={0.05} format={pct} neutral={0} coalesce="echo" onChange={(v, c) => set({ echo: v }, c)} />
        <div className="text-[12px] text-muted">ห้องก้อง</div>
        <Chips
          value={fx.reverb}
          onChange={(v) => set({ reverb: v })}
          options={[
            ["none", "ไม่มี"],
            ["room", "ห้องเล็ก"],
            ["hall", "ห้องโถง"],
            ["cave", "ถ้ำ"],
          ]}
        />
      </Group>
    </div>
  );
}

/** รายการเทคเสียงของบรรทัด: ฟัง เลือก ลบ */
export function TakesList({ line }: { line: Line }) {
  const name = useEditor((s) => s.name);
  const takes = line.takes ?? [];
  if (takes.length < 2 && !(takes.length === 1 && takes[0] !== line.audio)) return null;
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-faint">เทคเสียง ({takes.length})</div>
      {takes.map((t, i) => {
        const active = t === line.audio;
        return (
          <div key={t} className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${active ? "bg-accent/15" : "bg-app/60"}`}>
            <button className="btn-icon h-6 w-6" title="ฟังเทคนี้" onClick={() => void new Audio(`/files/${name}/${t}`).play()}>
              <Play size={12} />
            </button>
            <span className={`flex-1 text-[12px] ${active ? "text-accent" : ""}`}>เทค {i + 1}</span>
            {active ? (
              <Check size={13} className="text-accent" />
            ) : (
              <button className="btn-ghost h-6 px-2 text-[11px]" onClick={() => setLineAudio(line.id, t)}>
                ใช้เทคนี้
              </button>
            )}
            <button className="btn-icon h-6 w-6 text-faint hover:text-danger" title="ลบเทคนี้ออกจากรายการ" onClick={() => removeTake(line.id, t)}>
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** มิกเซอร์ของทั้งเรื่อง: master, ความดังรายแทร็ก, ducking, ความดังมาตรฐานตอนส่งออก */
export function MixerSection() {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const prep = useEditor((s) => s.prep);
  const mix = project.mix;
  return (
    <div className="space-y-3">
      <Slider label="Master" value={mix.master} min={0} max={1} step={0.01} format={pct} neutral={1} coalesce="master" onChange={(v, c) => update((p) => void (p.mix.master = v), c)} />
      {Object.entries(project.characters).map(([id, c]) => {
        const t = project.tracks[id];
        return (
          <div key={id} className="flex items-end gap-2">
            <span className="mb-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
            <div className="flex-1">
              <Slider label={c.name} value={t?.volume ?? 1} min={0} max={1} step={0.01} format={pct} neutral={1} coalesce={`tv:${id}`} onChange={(v, c) => setTrackState(id, { volume: v }, c)} />
            </div>
            <button
              className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${t?.muted ? "bg-danger/20 text-danger" : "text-faint hover:bg-panel-3"}`}
              title={t?.muted ? "เปิดเสียง" : "ปิดเสียง"}
              onClick={() => setTrackState(id, { muted: !t?.muted })}
            >
              M
            </button>
            <button
              className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${t?.solo ? "bg-accent/20 text-accent" : "text-faint hover:bg-panel-3"}`}
              title="ฟังเดี่ยว"
              onClick={() => setTrackState(id, { solo: !t?.solo })}
            >
              S
            </button>
          </div>
        );
      })}
      {project.music && (
        <Slider label="เพลง: ความเร็วที่ค่อย ๆ เบาลงรอบช่วงพูด" value={mix.duckFade} min={0.05} max={2} step={0.05} format={sec} neutral={0.3} coalesce="duck" onChange={(v, c) => update((p) => void (p.mix.duckFade = v), c)} />
      )}
      <div className="rounded-lg bg-app/60 p-3">
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={mix.normalize} onChange={(e) => update((p) => void (p.mix.normalize = e.target.checked))} />
          ปรับความดังรวมตอนส่งออก
        </label>
        {mix.normalize && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            เป้า
            <select className="input h-7 w-auto" value={mix.targetLufs} onChange={(e) => update((p) => void (p.mix.targetLufs = Number(e.target.value)))}>
              <option value={-14}>-14 LUFS (YouTube, TikTok, Spotify)</option>
              <option value={-16}>-16 LUFS (Apple, พอดแคสต์)</option>
              <option value={-23}>-23 LUFS (ทีวี EBU R128)</option>
            </select>
          </div>
        )}
      </div>
      {prep.status === "running" && (
        <div className="flex items-center gap-1.5 text-[11px] text-faint">
          <Loader2 size={11} className="animate-spin" /> กำลังอัปเดตเสียง…
        </div>
      )}
    </div>
  );
}
