import { ArrowDown, ArrowUp, Copy, Mic, Music, Play, Square, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Project, Voice } from "../../../../core/src/schema";
import { api, type VoiceOption } from "../lib/api";
import { startRecording, toWav } from "../lib/audio";
import { deleteCharacter, deleteLine, deleteScene, duplicateLine, moveLine, moveScene, patchLine, setLineAudio, uploadAsset } from "../lib/ops";
import { FxPanel, MixerSection, TakesList } from "./AudioPanel";
import { ComponentSettings, LayerInspector, PlacementInspector } from "./CompInspector";
import { LineActing, SceneStyle, SubtitleStyle } from "./ActingPanel";
import { useCurrent, useEditor, useLayout } from "../lib/store";
import { AsyncButton, toast, toastError } from "./ui";

// แผงขวา: ปรับค่าของสิ่งที่เลือก (บทพูด / ฉาก / ตัวละคร / ทั้งเรื่อง)

export function Inspector() {
  const { project, selection, line, scene } = useCurrent();
  const editing = useEditor((s) => s.editing);
  if (!project) return null;
  return (
    <div className="h-full overflow-auto">
      {selection.kind === "layer" && project.components[selection.component] ? (
        <LayerInspector component={selection.component} id={selection.id} />
      ) : selection.kind === "placement" ? (
        <PlacementInspector id={selection.id} />
      ) : selection.kind === "component" || editing ? (
        <ComponentSettings id={selection.kind === "component" ? selection.id : editing!} />
      ) : selection.kind === "line" && line && scene ? (
        <LineInspector line={line} sceneId={scene.id} />
      ) : selection.kind === "scene" && scene ? (
        <SceneInspector sceneId={scene.id} />
      ) : selection.kind === "character" && project.characters[selection.id] ? (
        <CharacterInspector id={selection.id} />
      ) : (
        <ProjectInspector />
      )}
    </div>
  );
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-b border-line p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="flex-1" />
        {actions}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

const voiceKey = (v: { provider: string; voice: string }) => `${v.provider}|${v.voice}`;

function VoiceSelect({ value, onChange, inherit }: { value?: Voice; onChange: (v: Voice | undefined) => void; inherit?: boolean }) {
  const voices = useEditor((s) => s.voices);
  const options: VoiceOption[] = [...voices];
  if (value && !options.some((o) => voiceKey(o) === voiceKey(value))) options.push({ ...value, label: value.voice, lang: "" });
  return (
    <select
      className="input"
      value={value ? voiceKey(value) : ""}
      onChange={(e) => {
        if (!e.target.value) return onChange(undefined);
        const [provider, voice] = e.target.value.split("|");
        onChange({ ...value, provider: provider as Voice["provider"], voice });
      }}
    >
      {inherit && <option value="">ใช้เสียงหลักของเรื่อง</option>}
      <optgroup label="Azure (ต้องมี key)">
        {options.filter((o) => o.provider === "azure").map((o) => (
          <option key={voiceKey(o)} value={voiceKey(o)}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="เสียงในเครื่อง">
        {options.filter((o) => o.provider === "system").map((o) => (
          <option key={voiceKey(o)} value={voiceKey(o)}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

type Line = Project["scenes"][number]["lines"][number];

function LineInspector({ line, sceneId }: { line: Line; sceneId: string }) {
  const project = useEditor((s) => s.project)!;
  const t = useLayout()?.lines.find((l) => l.id === line.id);
  return (
    <>
      <Section
        title="บทพูด"
        actions={
          <>
            <button className="btn-icon h-7 w-7" title="เลื่อนขึ้น" onClick={() => moveLine(line.id, -1)}>
              <ArrowUp size={14} />
            </button>
            <button className="btn-icon h-7 w-7" title="เลื่อนลง" onClick={() => moveLine(line.id, 1)}>
              <ArrowDown size={14} />
            </button>
            <button className="btn-icon h-7 w-7" title="ทำสำเนา" onClick={() => duplicateLine(line.id)}>
              <Copy size={14} />
            </button>
            <button
              className="btn-icon h-7 w-7 text-danger"
              title="ลบบทพูด (Delete)"
              onClick={() => {
                try {
                  deleteLine(line.id);
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        }
      >
        <Field label="คนพูด">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(project.characters).map(([id, c]) => (
              <button
                key={id}
                onClick={() => patchLine(line.id, { character: id })}
                className={line.character === id ? "chip-on" : "chip"}
              >
                <span className="mr-1.5 h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="ข้อความ">
          <textarea
            className="input h-auto min-h-24 resize-y py-2 leading-relaxed"
            value={line.text}
            placeholder="พิมพ์บทพูด…"
            onChange={(e) => patchLine(line.id, { text: e.target.value }, `text:${line.id}`)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="เว้นหลังพูด (วินาที)">
            <input
              className="input"
              type="number"
              min={0}
              step={0.05}
              value={line.pauseAfter}
              onChange={(e) => patchLine(line.id, { pauseAfter: Math.max(0, Number(e.target.value) || 0) }, `pause:${line.id}`)}
            />
          </Field>
          <Field label="ความยาวคลิป">
            <div className="input flex items-center text-muted">
              {t ? `${t.duration.toFixed(2)} วิ` : "–"}
              {t?.sourceDuration && t.sourceDuration - t.duration > 0.01 ? <span className="ml-1 text-faint">/ {t.sourceDuration.toFixed(2)}</span> : null}
            </div>
          </Field>
          <Field label="ตัดหัว (วินาที)">
            <input
              className="input"
              type="number"
              min={0}
              step={0.05}
              value={line.trimStart}
              onChange={(e) => patchLine(line.id, { trimStart: Math.max(0, Number(e.target.value) || 0) }, `trims:${line.id}`)}
            />
          </Field>
          <Field label="ตัดท้าย (วินาที)">
            <input
              className="input"
              type="number"
              min={0}
              step={0.05}
              value={line.trimEnd}
              onChange={(e) => patchLine(line.id, { trimEnd: Math.max(0, Number(e.target.value) || 0) }, `trime:${line.id}`)}
            />
          </Field>
        </div>
        {(line.trimStart > 0 || line.trimEnd > 0) && (
          <button className="btn-ghost h-7 text-[12px]" onClick={() => patchLine(line.id, { trimStart: 0, trimEnd: 0 })}>
            คืนค่าการตัด (ใช้เสียงเต็ม)
          </button>
        )}
        <div className="text-[11px] text-faint">ฉาก {sceneId}</div>
      </Section>
      <Section title="การแสดง">
        <LineActing line={line} />
      </Section>
      <Section title="เสียง">
        <VoiceSlot line={line} />
      </Section>
      <Section title="ปรับเสียงและเอฟเฟกต์">
        <FxPanel line={line} />
      </Section>
    </>
  );
}

/** ช่องลงเสียง: TTS (ฟังก่อนได้) / อัดจากไมค์ / อัปโหลด / ลากไฟล์มาวาง */
function VoiceSlot({ line }: { line: Line }) {
  const name = useEditor((s) => s.name);
  const project = useEditor((s) => s.project)!;
  const [recording, setRecording] = useState<null | { stop: () => Promise<Blob>; level: () => number; started: number }>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    const tick = () => {
      setLevel(recording.level());
      setElapsed((Date.now() - recording.started) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  const attach = async (blob: Blob) => {
    const wav = await toWav(blob);
    const res = await api<{ path: string; duration: number }>(`/api/projects/${name}/voice`, { method: "POST", raw: wav });
    setLineAudio(line.id, res.path);
    toast(`ใส่เสียง ${res.duration.toFixed(1)} วินาทีแล้ว`);
  };

  const voice = project.characters[line.character]?.voice ?? project.voice;
  const voices = useEditor((s) => s.voices);
  const label = voices.find((v) => voiceKey(v) === voiceKey(voice))?.label ?? voice.voice;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) attach(f).catch(toastError);
      }}
      className={`space-y-3 rounded-lg border border-dashed p-3 ${dragOver ? "border-accent bg-accent/10" : "border-line"}`}
    >
      {line.audio ? (
        <>
          <div className="flex items-center gap-2 text-[12px]">
            <Mic size={14} className="text-accent" /> เสียงของฉัน
            <span className="flex-1" />
            <button className="btn-ghost h-7 text-[12px]" onClick={() => patchLine(line.id, { audio: undefined })}>
              <X size={13} /> ใช้ TTS แทน
            </button>
          </div>
          <audio controls preload="none" src={`/files/${name}/${line.audio}`} className="h-8 w-full" />
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">TTS: {label}</span>
          <AsyncButton
            className="btn h-7 text-[12px]"
            onClick={async () => {
              if (!line.text.trim()) throw new Error("ยังไม่มีบทพูด");
              const { url } = await api<{ url: string }>("/api/tts-preview", { method: "POST", body: { text: line.text, voice } });
              if (audioRef.current) {
                audioRef.current.src = url;
                await audioRef.current.play();
              }
            }}
          >
            <Play size={13} /> ฟัง
          </AsyncButton>
          <audio ref={audioRef} className="hidden" />
        </div>
      )}

      <TakesList line={line} />

      {recording ? (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-app">
            <div className="h-full bg-danger transition-[width] duration-75" style={{ width: `${Math.min(100, level * 140)}%` }} />
          </div>
          <span className="w-10 font-mono text-[12px] text-danger">{elapsed.toFixed(1)}s</span>
          <AsyncButton
            className="btn h-7 border-danger text-[12px] text-danger"
            onClick={async () => {
              const blob = await recording.stop();
              setRecording(null);
              await attach(blob);
            }}
          >
            <Square size={12} /> หยุด
          </AsyncButton>
        </div>
      ) : (
        <div className="flex gap-2">
          <AsyncButton
            className="btn h-7 flex-1 text-[12px]"
            onClick={async () => {
              try {
                const r = await startRecording();
                setRecording({ ...r, started: Date.now() });
              } catch {
                throw new Error("เปิดไมโครโฟนไม่ได้ ตรวจสิทธิ์ไมค์ของเบราว์เซอร์");
              }
            }}
          >
            <Mic size={13} /> อัดเสียง
          </AsyncButton>
          <button className="btn h-7 flex-1 text-[12px]" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> อัปโหลด
          </button>
        </div>
      )}
      <div className="text-center text-[11px] text-faint">หรือลากไฟล์เสียงมาวางที่นี่ (wav, mp3, m4a)</div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) attach(f).catch(toastError);
        }}
      />
    </div>
  );
}

function SceneInspector({ sceneId }: { sceneId: string }) {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const scene = project.scenes.find((s) => s.id === sceneId)!;
  const isHex = /^#[0-9a-f]{6}$/i.test(scene.background);
  const set = (fn: (s: typeof scene) => void, coalesce?: string) =>
    update((p) => {
      const s = p.scenes.find((x) => x.id === sceneId);
      if (s) fn(s);
    }, coalesce);

  return (
    <Section
      title={`ฉาก ${project.scenes.indexOf(scene) + 1}`}
      actions={
        <>
          <button className="btn-icon h-7 w-7" title="เลื่อนขึ้น" onClick={() => moveScene(sceneId, -1)}>
            <ArrowUp size={14} />
          </button>
          <button className="btn-icon h-7 w-7" title="เลื่อนลง" onClick={() => moveScene(sceneId, 1)}>
            <ArrowDown size={14} />
          </button>
          <button
            className="btn-icon h-7 w-7 text-danger"
            title="ลบฉาก"
            onClick={() => {
              if (!confirm(`ลบฉาก ${scene.id} และบทพูด ${scene.lines.length} บรรทัด?`)) return;
              try {
                deleteScene(sceneId);
              } catch (err) {
                toastError(err);
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        </>
      }
    >
      <Field label="ชื่อฉาก (id)">
        <input className="input" value={scene.id} disabled />
      </Field>
      <Field label="พื้นหลัง">
        <div className="flex gap-2">
          <input
            type="color"
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-app"
            value={isHex ? scene.background : "#bde0fe"}
            onChange={(e) => set((s) => (s.background = e.target.value), `bg:${sceneId}`)}
          />
          <input className="input font-mono text-[12px]" value={scene.background} onChange={(e) => set((s) => (s.background = e.target.value), `bg:${sceneId}`)} />
        </div>
        <div className="mt-1 text-[11px] text-faint">เลือกพื้นหลังสำเร็จรูปหรืออัปโหลดรูปได้ที่แท็บ “พื้นหลัง” ด้านซ้าย</div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ค้างก่อนบทแรก (วินาที)">
          <input className="input" type="number" min={0} step={0.1} value={scene.holdStart} onChange={(e) => set((s) => (s.holdStart = Math.max(0, Number(e.target.value) || 0)), `hs:${sceneId}`)} />
        </Field>
        <Field label="ค้างหลังบทสุดท้าย">
          <input className="input" type="number" min={0} step={0.1} value={scene.holdEnd} onChange={(e) => set((s) => (s.holdEnd = Math.max(0, Number(e.target.value) || 0)), `he:${sceneId}`)} />
        </Field>
      </div>
      <div className="text-[12px] text-muted">{scene.lines.length} บทพูด · ลากขอบขวาของฉากในไทม์ไลน์เพื่อปรับช่วงค้างได้</div>
      <SceneStyle scene={scene} />
    </Section>
  );
}

function CharacterInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const c = project.characters[id];
  const set = (fn: (ch: typeof c) => void, coalesce?: string) =>
    update((p) => {
      if (p.characters[id]) fn(p.characters[id]);
    }, coalesce);
  return (
    <Section
      title="ตัวละคร"
      actions={
        <button
          className="btn-icon h-7 w-7 text-danger"
          title="ลบตัวละคร"
          onClick={() => {
            try {
              deleteCharacter(id);
            } catch (err) {
              toastError(err);
            }
          }}
        >
          <Trash2 size={14} />
        </button>
      }
    >
      <Field label="ชื่อที่แสดง (ในซับ)">
        <input className="input" value={c.name} onChange={(e) => set((ch) => (ch.name = e.target.value), `cname:${id}`)} />
      </Field>
      <Field label="สีตัว">
        <div className="flex gap-2">
          <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line bg-app" value={c.color} onChange={(e) => set((ch) => (ch.color = e.target.value), `ccolor:${id}`)} />
          <input className="input font-mono text-[12px]" value={c.color} onChange={(e) => set((ch) => (ch.color = e.target.value), `ccolor:${id}`)} />
        </div>
      </Field>
      <Field label="เสียง">
        <VoiceSelect inherit value={c.voice} onChange={(v) => set((ch) => (v ? (ch.voice = v) : delete ch.voice))} />
      </Field>
      {c.voice?.provider === "azure" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="ความเร็ว">
            <input className="input" placeholder="+0%" value={c.voice.rate ?? ""} onChange={(e) => set((ch) => ch.voice && (ch.voice.rate = e.target.value || undefined), `crate:${id}`)} />
          </Field>
          <Field label="ระดับเสียง">
            <input className="input" placeholder="+0st" value={c.voice.pitch ?? ""} onChange={(e) => set((ch) => ch.voice && (ch.voice.pitch = e.target.value || undefined), `cpitch:${id}`)} />
          </Field>
        </div>
      )}
      <div className="font-mono text-[11px] text-faint">id: {id}</div>
    </Section>
  );
}

function ProjectInspector() {
  const project = useEditor((s) => s.project)!;
  const name = useEditor((s) => s.name);
  const update = useEditor((s) => s.update);
  const musicRef = useRef<HTMLInputElement>(null);
  const subs = project.subtitles;

  return (
    <>
      <Section title="ทั้งเรื่อง">
        <Field label="ชื่อเรื่อง">
          <input className="input" value={project.title} onChange={(e) => update((p) => void (p.title = e.target.value), "title")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ขนาด">
            <select className="input" value={project.format} onChange={(e) => update((p) => void (p.format = e.target.value as Project["format"]))}>
              <option value="16:9">16:9 แนวนอน</option>
              <option value="9:16">9:16 แนวตั้ง</option>
              <option value="1:1">1:1 จัตุรัส</option>
            </select>
          </Field>
          <Field label="เฟรมต่อวินาที">
            <select className="input" value={project.fps} onChange={(e) => update((p) => void (p.fps = Number(e.target.value)))}>
              {[24, 25, 30, 60].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="เสียงหลักของเรื่อง">
          <VoiceSelect value={project.voice} onChange={(v) => v && update((p) => void (p.voice = v))} />
        </Field>
      </Section>

      <Section title="ซับไตเติล">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={subs.enabled} onChange={(e) => update((p) => void (p.subtitles.enabled = e.target.checked))} /> แสดงซับในวิดีโอ
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={subs.showName} onChange={(e) => update((p) => void (p.subtitles.showName = e.target.checked))} /> แสดงชื่อคนพูด
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ตำแหน่ง">
            <select className="input" value={subs.position} onChange={(e) => update((p) => void (p.subtitles.position = e.target.value as "top" | "bottom"))}>
              <option value="bottom">ล่าง</option>
              <option value="top">บน</option>
            </select>
          </Field>
          <Field label="ขนาด">
            <select className="input" value={subs.size} onChange={(e) => update((p) => void (p.subtitles.size = e.target.value as "small" | "medium" | "large"))}>
              <option value="small">เล็ก</option>
              <option value="medium">กลาง</option>
              <option value="large">ใหญ่</option>
            </select>
          </Field>
        </div>
        <SubtitleStyle />
      </Section>

      <Section title="มิกซ์เสียง">
        <MixerSection />
      </Section>

      <Section title="เพลงประกอบ">
        {project.music ? (
          <>
            <audio controls preload="none" src={`/files/${name}/${project.music.file}`} className="h-8 w-full" />
            <Field label={`ความดัง ${Math.round(project.music.volume * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} className="w-full" value={project.music.volume} onChange={(e) => update((p) => void (p.music && (p.music.volume = Number(e.target.value))), "mvol")} />
            </Field>
            <Field label={`ตอนมีคนพูด ${Math.round(project.music.duckTo * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} className="w-full" value={project.music.duckTo} onChange={(e) => update((p) => void (p.music && (p.music.duckTo = Number(e.target.value))), "mduck")} />
            </Field>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={() => musicRef.current?.click()}>
                เปลี่ยนเพลง
              </button>
              <button className="btn-ghost text-danger" onClick={() => update((p) => void delete p.music)}>
                เอาออก
              </button>
            </div>
          </>
        ) : (
          <button className="btn w-full" onClick={() => musicRef.current?.click()}>
            <Music size={14} /> ใส่เพลงประกอบ
          </button>
        )}
        <div className="text-[11px] text-faint">เพลงจะวนซ้ำและเบาลงอัตโนมัติตอนตัวละครพูด</div>
        <input
          ref={musicRef}
          type="file"
          accept=".mp3,.wav,.m4a,.ogg,audio/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const file = await uploadAsset(name, f, f.name.split(".").pop() ?? "mp3");
              update((p) => void (p.music = { file, volume: p.music?.volume ?? 0.25, duckTo: p.music?.duckTo ?? 0.08 }));
              toast("ใส่เพลงประกอบแล้ว");
            } catch (err) {
              toastError(err);
            }
          }}
        />
      </Section>
    </>
  );
}
