import { ArrowDown, ArrowUp, Copy, Diamond, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ANIM_PRESETS, valueAt, type AnimPreset } from "../../../../core/src/anim";
import { componentCycle, EASES, type AnimProp, type Layer } from "../../../../core/src/schema";
import { FONT_NAMES } from "../../../../renderer/src/fonts";
import { api } from "../lib/api";
import {
  addLayer,
  addSfxLayer,
  applyAnimation,
  clearKeyframes,
  deleteComponent,
  duplicateLayer,
  hasKeyAt,
  LAYER_TYPES,
  layerTime,
  moveLayerOrder,
  patchComponent,
  patchLayer,
  patchPlacement,
  placeComponent,
  removeLayer,
  removePlacement,
  setAnimValue,
  toggleKeyframe,
} from "../lib/compOps";
import { uploadAsset } from "../lib/ops";
import { computeLayout, useEditor } from "../lib/store";
import { LAYER_ICON } from "./CompEditor";
import { AsyncButton, toast, toastError } from "./ui";

// แผงขวาของระบบคอมโพเนนต์: ตั้งค่าคอมโพเนนต์, ปรับเลเยอร์ + คีย์เฟรม, ปรับการวางในเรื่อง

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

function Num({ value, onChange, step = 1, min, max, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="relative">
      <input
        className="input pr-7"
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft ?? Math.round(value * 1000) / 1000}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v)) onChange(v);
        }}
        onBlur={() => setDraft(null)}
      />
      {suffix && <span className="pointer-events-none absolute top-1.5 right-2 text-[11px] text-faint">{suffix}</span>}
    </div>
  );
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <input type="color" className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-app" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} />
      <input className="input font-mono text-[12px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ---------- คอมโพเนนต์ ----------

const SIZE_PRESETS: [string, number, number][] = [
  ["เต็มจอ 16:9", 1920, 1080],
  ["เต็มจอ 9:16", 1080, 1920],
  ["จัตุรัส", 1080, 1080],
  ["ป้าย/แถบ", 900, 300],
  ["สติกเกอร์", 400, 400],
];

export function ComponentSettings({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const editing = useEditor((s) => s.editing);
  const { setEditing } = useEditor.getState();
  const c = project.components[id];
  const used = project.placements.filter((p) => p.component === id).length;
  if (!c) return null;
  return (
    <>
      <Section
        title="คอมโพเนนต์"
        actions={
          <button
            className="btn-icon h-7 w-7 text-danger"
            title="ลบคอมโพเนนต์"
            onClick={() => {
              if (!confirm(`ลบ “${c.name}”${used ? ` และการวางในเรื่อง ${used} จุด` : ""}?`)) return;
              try {
                deleteComponent(id);
              } catch (err) {
                toastError(err);
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        }
      >
        <Field label="ชื่อ">
          <input className="input" value={c.name} onChange={(e) => patchComponent(id, { name: e.target.value }, "cname")} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="กว้าง">
            <Num value={c.width} min={16} onChange={(v) => patchComponent(id, { width: Math.round(v) }, "cw")} />
          </Field>
          <Field label="สูง">
            <Num value={c.height} min={16} onChange={(v) => patchComponent(id, { height: Math.round(v) }, "ch")} />
          </Field>
          <Field label="ยาว (วิ)">
            <Num value={c.duration} step={0.1} min={0.1} onChange={(v) => patchComponent(id, { duration: Math.max(0.1, v) }, "cd")} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SIZE_PRESETS.map(([label, w, h]) => (
            <button key={label} className={c.width === w && c.height === h ? "chip-on h-6 px-2.5" : "chip h-6 px-2.5"} onClick={() => patchComponent(id, { width: w, height: h })}>
              {label}
            </button>
          ))}
        </div>
        <div className="text-[12px] text-muted">
          {c.layers.length} เลเยอร์ · วางในเรื่อง {used} จุด (แก้ที่นี่แล้วเปลี่ยนทุกจุด)
        </div>
        <div className="flex gap-2">
          {editing !== id ? (
            <button className="btn flex-1" onClick={() => setEditing(id)}>
              <Pencil size={13} /> เปิดแก้
            </button>
          ) : (
            <button className="btn flex-1" onClick={() => setEditing(null)}>
              กลับเรื่องหลัก
            </button>
          )}
          <button
            className="btn flex-1"
            onClick={() => {
              setEditing(null);
              placeComponent(id);
              toast("วางที่เส้นเวลาของเรื่องหลักแล้ว");
            }}
          >
            <Plus size={13} /> วางลงเรื่อง
          </button>
        </div>
      </Section>
      {editing === id && <AddLayerSection id={id} />}
    </>
  );
}

function AddLayerSection({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const name = useEditor((s) => s.name);
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const [sfx, setSfx] = useState<{ id: string; name: string; desc: string }[]>([]);
  useEffect(() => {
    api<{ id: string; name: string; desc: string }[]>("/api/sfx").then(setSfx).catch(() => {});
  }, []);
  const chars = Object.keys(project.characters);
  const nestable = Object.entries(project.components).filter(([cid]) => cid !== id && !componentCycle({ ...project.components, [id]: { layers: [{ type: "component", component: cid }] } }, id));
  const c = project.components[id];
  const atNow = () => Math.min(Math.max(0, useEditor.getState().compFrame / project.fps), Math.max(0, c.duration - 0.1));

  return (
    <Section title="เพิ่มเลเยอร์">
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={() => addLayer(id, { type: "text", text: "ข้อความ", size: Math.round(c.height / 10) })}>
          {LAYER_ICON.text} ข้อความ
        </button>
        <button className="btn" onClick={() => addLayer(id, { type: "shape", shape: "rect", w: c.width / 3, h: c.height / 4 })}>
          {LAYER_ICON.shape} รูปทรง
        </button>
        <button className="btn" onClick={() => imageRef.current?.click()}>
          {LAYER_ICON.image} รูปภาพ
        </button>
        <button className="btn" disabled={!chars.length} onClick={() => addLayer(id, { type: "character", character: chars[0], size: Math.round(c.height * 0.6) })}>
          {LAYER_ICON.character} ตัวละคร
        </button>
        <button className="btn" onClick={() => audioRef.current?.click()}>
          {LAYER_ICON.audio} ไฟล์เสียง
        </button>
        <select
          className="input h-8"
          value=""
          onChange={(e) => e.target.value && addLayer(id, { type: "component", component: e.target.value, start: 0, duration: project.components[e.target.value].duration })}
        >
          <option value="">+ คอมโพเนนต์ซ้อน…</option>
          {nestable.map(([cid, cc]) => (
            <option key={cid} value={cid}>
              {cc.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="label">เสียงประกอบ (SFX) ใส่ที่เส้นเวลา</div>
        <div className="flex flex-wrap gap-1.5">
          {sfx.map((s) => (
            <button key={s.id} className="chip h-7 px-2.5" title={s.desc} onClick={() => addSfxLayer(id, s.id, s.name, atNow()).catch(toastError)}>
              + {s.name}
            </button>
          ))}
        </div>
      </div>
      <input
        ref={imageRef}
        type="file"
        accept="image/*,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const src = await uploadAsset(name, f, f.name.split(".").pop() ?? "png");
            const img = await new Promise<HTMLImageElement>((res, rej) => {
              const i = new Image();
              i.onload = () => res(i);
              i.onerror = rej;
              i.src = URL.createObjectURL(f);
            });
            const k = Math.min(1, (c.width * 0.6) / img.width, (c.height * 0.6) / img.height);
            addLayer(id, { type: "image", src, name: f.name, w: Math.round(img.width * k), h: Math.round(img.height * k) });
          } catch (err) {
            toastError(err);
          }
        }}
      />
      <input
        ref={audioRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const src = await uploadAsset(name, f, f.name.split(".").pop() ?? "wav");
            addLayer(id, { type: "audio", src, name: f.name, start: atNow(), duration: Math.min(5, c.duration) });
          } catch (err) {
            toastError(err);
          }
        }}
      />
    </Section>
  );
}

// ---------- เลเยอร์ ----------

const PROPS: { prop: AnimProp; label: string; step: number; scale?: number; suffix?: string }[] = [
  { prop: "x", label: "ตำแหน่ง X", step: 1, suffix: "px" },
  { prop: "y", label: "ตำแหน่ง Y", step: 1, suffix: "px" },
  { prop: "scale", label: "ขนาด", step: 1, scale: 100, suffix: "%" },
  { prop: "rotation", label: "หมุน", step: 1, suffix: "°" },
  { prop: "opacity", label: "ความทึบ", step: 1, scale: 100, suffix: "%" },
];

export function LayerInspector({ component, id }: { component: string; id: string }) {
  const project = useEditor((s) => s.project)!;
  const name = useEditor((s) => s.name);
  useEditor((s) => s.compFrame); // วาดใหม่เมื่อเส้นเวลาเลื่อน (ค่าที่แสดงมาจากคีย์เฟรม ณ เวลานั้น)
  const { setEditing } = useEditor.getState();
  const c = project.components[component];
  const layer = c?.layers.find((l) => l.id === id);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!c || !layer) return null;
  const t = layerTime(layer);
  const inRange = t >= 0 && t <= layer.duration;
  const set = (patch: Record<string, unknown>, key?: string) => patchLayer(component, id, patch, key);

  return (
    <>
      <Section
        title={LAYER_TYPES[layer.type]}
        actions={
          <>
            <button className="btn-icon h-7 w-7" title="ขึ้นบน" onClick={() => moveLayerOrder(component, id, 1)}>
              <ArrowUp size={14} />
            </button>
            <button className="btn-icon h-7 w-7" title="ลงล่าง" onClick={() => moveLayerOrder(component, id, -1)}>
              <ArrowDown size={14} />
            </button>
            <button className="btn-icon h-7 w-7" title="ทำสำเนาเลเยอร์" onClick={() => duplicateLayer(component, id)}>
              <Copy size={14} />
            </button>
            <button className="btn-icon h-7 w-7 text-danger" title="ลบเลเยอร์" onClick={() => removeLayer(component, id)}>
              <Trash2 size={14} />
            </button>
          </>
        }
      >
        <Field label="ชื่อเลเยอร์">
          <input className="input" value={layer.name} onChange={(e) => set({ name: e.target.value }, "lname")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="เริ่ม (วิ)">
            <Num value={layer.start} step={0.05} min={0} onChange={(v) => set({ start: Math.max(0, v) }, "lstart")} />
          </Field>
          <Field label="ยาว (วิ)">
            <Num value={layer.duration} step={0.05} min={0.05} onChange={(v) => set({ duration: Math.max(0.05, v) }, "ldur")} />
          </Field>
        </div>
      </Section>

      <TypeFields component={component} layer={layer} set={set} name={name} fileRef={fileRef} onEditNested={(cid) => setEditing(cid)} />

      {layer.type !== "audio" && (
        <Section title="ตำแหน่งและแอนิเมชัน">
          {!inRange && <div className="rounded bg-warn/15 px-2 py-1 text-[11px] text-warn">เส้นเวลาอยู่นอกช่วงของเลเยอร์นี้ การใส่คีย์เฟรมจะอยู่ที่ขอบเลเยอร์</div>}
          {PROPS.map(({ prop, label, step, scale = 1, suffix }) => {
            const keys = layer.keyframes[prop];
            const v = valueAt(layer, prop, Math.max(0, Math.min(layer.duration, t)));
            const onKey = hasKeyAt(layer, prop, Math.max(0, t));
            return (
              <div key={prop} className="flex items-end gap-2">
                <button
                  className={`mb-1.5 flex h-5 w-5 shrink-0 items-center justify-center ${onKey ? "text-warn" : keys?.length ? "text-warn/50" : "text-faint hover:text-fg"}`}
                  title={onKey ? "ลบคีย์เฟรมที่เวลานี้" : "ใส่คีย์เฟรมที่เวลานี้"}
                  onClick={() => toggleKeyframe(component, id, prop)}
                >
                  <Diamond size={13} fill={onKey ? "currentColor" : "none"} />
                </button>
                <div className="flex-1">
                  <span className="label flex">
                    {label}
                    {keys?.length ? <span className="ml-1 text-warn">· {keys.length} คีย์</span> : null}
                  </span>
                  <Num value={v * scale} step={step} suffix={suffix} onChange={(nv) => setAnimValue(component, id, prop, nv / scale, `p:${prop}`)} />
                </div>
                {keys?.length ? (
                  <select
                    className="input mb-0 h-8 w-24 text-[11px]"
                    title="การเคลื่อนไหวระหว่างคีย์"
                    value={keys[0].ease}
                    onChange={(e) => set({ keyframes: { ...layer.keyframes, [prop]: keys.map((k) => ({ ...k, ease: e.target.value })) } })}
                  >
                    {EASES.map((e) => (
                      <option key={e} value={e}>
                        {EASE_LABEL[e]}
                      </option>
                    ))}
                  </select>
                ) : null}
                {keys?.length ? (
                  <button className="btn-icon mb-0.5 h-7 w-7 text-faint" title="ล้างคีย์เฟรมของค่านี้" onClick={() => clearKeyframes(component, id, prop)}>
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <div>
            <div className="label">แอนิเมชันสำเร็จรูป</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(ANIM_PRESETS) as [AnimPreset, string][]).map(([k, label]) => (
                <button key={k} className="chip h-6 px-2.5" onClick={() => applyAnimation(component, id, k)}>
                  {label}
                </button>
              ))}
            </div>
            {Object.keys(layer.keyframes).length > 0 && (
              <button className="btn-ghost mt-2 h-7 text-[12px] text-danger" onClick={() => clearKeyframes(component, id)}>
                ล้างแอนิเมชันทั้งหมด
              </button>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

const EASE_LABEL: Record<(typeof EASES)[number], string> = {
  linear: "คงที่",
  easeIn: "ค่อย ๆ เร่ง",
  easeOut: "ค่อย ๆ หยุด",
  easeInOut: "นุ่ม",
  bounce: "เด้ง",
  hold: "กระโดด",
};

function TypeFields({
  component,
  layer,
  set,
  name,
  fileRef,
  onEditNested,
}: {
  component: string;
  layer: Layer;
  set: (patch: Record<string, unknown>, key?: string) => void;
  name: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onEditNested: (id: string) => void;
}) {
  const project = useEditor((s) => s.project)!;
  switch (layer.type) {
    case "text":
      return (
        <Section title="ข้อความ">
          <textarea className="input h-auto min-h-16 py-2" value={layer.text} onChange={(e) => set({ text: e.target.value }, "ltext")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="ฟอนต์">
              <select className="input" value={layer.font} onChange={(e) => set({ font: e.target.value })}>
                {FONT_NAMES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="ขนาด">
              <Num value={layer.size} min={4} suffix="px" onChange={(v) => set({ size: Math.max(4, v) }, "lsize")} />
            </Field>
            <Field label="สี">
              <Color value={layer.color} onChange={(v) => set({ color: v }, "lcolor")} />
            </Field>
            <Field label="น้ำหนัก / จัด">
              <div className="flex gap-1">
                <select className="input" value={layer.weight} onChange={(e) => set({ weight: Number(e.target.value) })}>
                  <option value={400}>ปกติ</option>
                  <option value={700}>หนา</option>
                </select>
                <select className="input" value={layer.align} onChange={(e) => set({ align: e.target.value })}>
                  <option value="left">ซ้าย</option>
                  <option value="center">กลาง</option>
                  <option value="right">ขวา</option>
                </select>
              </div>
            </Field>
            <Field label="ขอบตัวอักษร">
              <Color value={layer.strokeColor} onChange={(v) => set({ strokeColor: v }, "lsc")} />
            </Field>
            <Field label="ความหนาขอบ">
              <Num value={layer.strokeWidth} min={0} suffix="px" onChange={(v) => set({ strokeWidth: Math.max(0, v) }, "lsw")} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={!!layer.box} onChange={(e) => set({ box: e.target.checked ? "#000000aa" : undefined })} /> กล่องพื้นหลัง
          </label>
          {layer.box && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="สีกล่อง">
                <Color value={layer.box} onChange={(v) => set({ box: v }, "lbox")} />
              </Field>
              <Field label="มุมโค้ง / ระยะขอบ">
                <div className="flex gap-1">
                  <Num value={layer.boxRadius} min={0} onChange={(v) => set({ boxRadius: Math.max(0, v) }, "lbr")} />
                  <Num value={layer.boxPadding} min={0} onChange={(v) => set({ boxPadding: Math.max(0, v) }, "lbp")} />
                </div>
              </Field>
            </div>
          )}
          <Field label="ความกว้างสูงสุด (ตัดบรรทัดอัตโนมัติ, เว้นว่าง = ไม่ตัด)">
            <input className="input" type="number" value={layer.maxWidth ?? ""} onChange={(e) => set({ maxWidth: e.target.value ? Math.max(40, Number(e.target.value)) : undefined }, "lmw")} />
          </Field>
        </Section>
      );
    case "shape":
      return (
        <Section title="รูปทรง">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["rect", "สี่เหลี่ยม"],
                ["ellipse", "วงรี"],
                ["star", "ดาว"],
                ["bubble", "ฟองคำพูด"],
              ] as const
            ).map(([s, label]) => (
              <button key={s} className={layer.shape === s ? "chip-on h-6 px-2.5" : "chip h-6 px-2.5"} onClick={() => set({ shape: s })}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="กว้าง">
              <Num value={layer.w} min={1} suffix="px" onChange={(v) => set({ w: Math.max(1, v) }, "lw")} />
            </Field>
            <Field label="สูง">
              <Num value={layer.h} min={1} suffix="px" onChange={(v) => set({ h: Math.max(1, v) }, "lh")} />
            </Field>
            <Field label="สีพื้น">
              <Color value={layer.fill} onChange={(v) => set({ fill: v }, "lfill")} />
            </Field>
            <Field label="มุมโค้ง">
              <Num value={layer.radius} min={0} onChange={(v) => set({ radius: Math.max(0, v) }, "lrad")} />
            </Field>
            <Field label="สีเส้นขอบ">
              <Color value={layer.strokeColor} onChange={(v) => set({ strokeColor: v }, "lsc")} />
            </Field>
            <Field label="ความหนาเส้น">
              <Num value={layer.strokeWidth} min={0} suffix="px" onChange={(v) => set({ strokeWidth: Math.max(0, v) }, "lsw")} />
            </Field>
          </div>
        </Section>
      );
    case "image":
      return (
        <Section title="รูปภาพ">
          <img src={`/files/${name}/${layer.src}`} alt="" className="max-h-32 w-full rounded bg-app object-contain" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="กว้าง">
              <Num value={layer.w} min={1} suffix="px" onChange={(v) => set({ w: Math.max(1, v) }, "lw")} />
            </Field>
            <Field label="สูง">
              <Num value={layer.h} min={1} suffix="px" onChange={(v) => set({ h: Math.max(1, v) }, "lh")} />
            </Field>
          </div>
          <div className="flex gap-2">
            <select className="input" value={layer.fit} onChange={(e) => set({ fit: e.target.value })}>
              <option value="contain">พอดีกรอบ</option>
              <option value="cover">เต็มกรอบ (ครอป)</option>
            </select>
            <button className="btn shrink-0" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> เปลี่ยนรูป
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) set({ src: await uploadAsset(name, f, f.name.split(".").pop() ?? "png") });
            }}
          />
        </Section>
      );
    case "character":
      return (
        <Section title="ตัวละคร">
          <Field label="ตัวละคร">
            <select className="input" value={layer.character} onChange={(e) => set({ character: e.target.value })}>
              {Object.entries(project.characters).map(([cid, ch]) => (
                <option key={cid} value={cid}>
                  {ch.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ความสูง">
              <Num value={layer.size} min={20} suffix="px" onChange={(v) => set({ size: Math.max(20, v) }, "lsize")} />
            </Field>
            <Field label="หันหน้า">
              <select className="input" value={layer.facing} onChange={(e) => set({ facing: Number(e.target.value) })}>
                <option value={1}>ขวา</option>
                <option value={-1}>ซ้าย</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={layer.talking} onChange={(e) => set({ talking: e.target.checked })} /> ขยับปากเหมือนพูด
          </label>
        </Section>
      );
    case "audio":
      return (
        <Section title="เสียง">
          <button className="btn w-full" onClick={() => void new Audio(`/files/${name}/${layer.src}`).play()}>
            <Play size={13} /> ฟังเสียง
          </button>
          <Field label={`ความดัง ${Math.round(layer.volume * 100)}%`}>
            <input type="range" min={0} max={1} step={0.01} className="w-full" value={layer.volume} onChange={(e) => set({ volume: Number(e.target.value) }, "lvol")} />
          </Field>
          <div className="text-[11px] break-all text-faint">{layer.src}</div>
        </Section>
      );
    case "component": {
      const child = project.components[layer.component];
      return (
        <Section title="คอมโพเนนต์ซ้อน">
          <div className="text-[13px]">{child?.name ?? "(ไม่พบ)"}</div>
          {child && (
            <button className="btn w-full" onClick={() => onEditNested(layer.component)}>
              <Pencil size={13} /> เปิดแก้คอมโพเนนต์นี้
            </button>
          )}
          <div className="text-[11px] text-faint">แก้คอมโพเนนต์ต้นแบบแล้ว ทุกที่ที่ใช้จะเปลี่ยนตาม · อยู่ใน “{project.components[component]?.name}”</div>
        </Section>
      );
    }
  }
}

// ---------- การวางในเรื่องหลัก ----------

export function PlacementInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline);
  const { setEditing } = useEditor.getState();
  const pl = project.placements.find((p) => p.id === id);
  if (!pl) return null;
  const c = project.components[pl.component];
  const lay = computeLayout(project, timeline).placements.find((p) => p.id === id);
  const set = (patch: Record<string, unknown>, key?: string) => patchPlacement(id, patch, key);
  const pct = (v: number) => Math.round(v * 1000) / 10;

  return (
    <Section
      title="คอมโพเนนต์ในเรื่อง"
      actions={
        <button className="btn-icon h-7 w-7 text-danger" title="เอาออกจากเรื่อง (Delete)" onClick={() => removePlacement(id)}>
          <Trash2 size={14} />
        </button>
      }
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c?.name}</span>
        <button className="btn h-7 text-[12px]" onClick={() => setEditing(pl.component)}>
          <Pencil size={12} /> แก้คอมโพเนนต์
        </button>
      </div>
      <div className="text-[12px] text-muted">
        เริ่ม {lay ? lay.start.toFixed(2) : "–"} วิ · ฉาก {pl.sceneId} +{pl.offset.toFixed(2)} วิ (เลื่อนตามฉาก) · ลากตำแหน่งบนจอวิดีโอได้
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ตำแหน่ง X">
          <Num value={pct(pl.x)} step={0.5} suffix="%" onChange={(v) => set({ x: v / 100 }, "plx")} />
        </Field>
        <Field label="ตำแหน่ง Y">
          <Num value={pct(pl.y)} step={0.5} suffix="%" onChange={(v) => set({ y: v / 100 }, "ply")} />
        </Field>
        <Field label="ขนาด (เทียบความกว้างจอ)">
          <Num value={pct(pl.scale)} step={1} min={1} suffix="%" onChange={(v) => set({ scale: Math.max(0.01, v / 100) }, "pls")} />
        </Field>
        <Field label="ความยาว (วิ)">
          <Num value={pl.duration ?? c?.duration ?? 1} step={0.1} min={0.05} onChange={(v) => set({ duration: Math.max(0.05, v) }, "pld")} />
        </Field>
      </div>
      <Field label={`ความทึบ ${Math.round(pl.opacity * 100)}%`}>
        <input type="range" min={0} max={1} step={0.01} className="w-full" value={pl.opacity} onChange={(e) => set({ opacity: Number(e.target.value) }, "plo")} />
      </Field>
      <Field label={`ความดังเสียงในคอมโพเนนต์ ${Math.round(pl.volume * 100)}%`}>
        <input type="range" min={0} max={1} step={0.01} className="w-full" value={pl.volume} onChange={(e) => set({ volume: Number(e.target.value) }, "plv")} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pl.loop} onChange={(e) => set({ loop: e.target.checked })} /> เล่นวนถ้ายาวกว่าคอมโพเนนต์
        </label>
        {pl.duration !== undefined && (
          <button className="btn-ghost h-6 px-2 text-[11px]" onClick={() => set({ duration: undefined })}>
            ใช้ความยาวเดิม
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["กลางจอ", 0.5, 0.5],
            ["บน", 0.5, 0.18],
            ["ล่าง", 0.5, 0.82],
            ["มุมซ้ายบน", 0.18, 0.18],
            ["มุมขวาบน", 0.82, 0.18],
          ] as const
        ).map(([label, x, y]) => (
          <button key={label} className="chip h-6 px-2.5" onClick={() => set({ x, y })}>
            {label}
          </button>
        ))}
      </div>
      <AsyncButton className="btn-ghost h-7 text-[12px]" onClick={async () => setEditing(pl.component)}>
        เปิดดูเลเยอร์ทั้งหมด →
      </AsyncButton>
    </Section>
  );
}
