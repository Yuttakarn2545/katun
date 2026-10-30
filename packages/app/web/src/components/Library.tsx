import { Copy, LayoutTemplate, Pencil, Play, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { addBlankComponent, addSfxLayer, addTemplateComponent, duplicateComponent, placeComponent, placeSfx } from "../lib/compOps";
import { useEditor } from "../lib/store";
import { toast, toastError } from "./ui";

// คลังคอมโพเนนต์และคลัง SFX (แท็บในแผงซ้าย)

type TemplateInfo = { id: string; name: string; description: string };
type SfxInfo = { id: string; name: string; desc: string };

export function ComponentLibrary() {
  const project = useEditor((s) => s.project)!;
  const editing = useEditor((s) => s.editing);
  const selection = useEditor((s) => s.selection);
  const { setEditing, select } = useEditor.getState();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  useEffect(() => {
    api<TemplateInfo[]>("/api/component-templates").then(setTemplates).catch(() => {});
  }, []);
  const entries = Object.entries(project.components);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn"
          onClick={() => {
            const id = addBlankComponent();
            setEditing(id);
          }}
        >
          <Plus size={14} /> ว่าง
        </button>
        <button className={showTemplates ? "btn border-accent" : "btn"} onClick={() => setShowTemplates((v) => !v)}>
          <LayoutTemplate size={14} /> เทมเพลต
        </button>
      </div>

      {showTemplates && (
        <div className="space-y-1 rounded-lg bg-app/70 p-2">
          {templates.map((t) => (
            <button
              key={t.id}
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-panel-3"
              onClick={async () => {
                try {
                  const id = await addTemplateComponent(t.id);
                  setShowTemplates(false);
                  setEditing(id);
                  toast(`สร้าง “${t.name}” แล้ว แก้ข้อความ/สี/เวลาได้ทุกเลเยอร์`);
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              <div className="text-[12px] font-semibold">{t.name}</div>
              <div className="text-[11px] text-muted">{t.description}</div>
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 && !showTemplates && (
        <div className="rounded-lg border border-dashed border-line p-4 text-center text-[12px] text-muted">
          คอมโพเนนต์ = ชิ้นงานที่สร้างครั้งเดียวแล้วใช้ซ้ำได้ เช่น ชื่อเรื่อง ป้ายชื่อ ฟองคำพูด สติกเกอร์ พร้อมเสียง
        </div>
      )}

      {entries.map(([id, c]) => {
        const used = project.placements.filter((p) => p.component === id).length;
        const active = editing === id || (selection.kind === "component" && selection.id === id);
        return (
          <div
            key={id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-katun-component", id)}
            onClick={() => select({ kind: "component", id })}
            onDoubleClick={() => setEditing(id)}
            className={`group cursor-pointer rounded-lg border p-2 ${active ? "border-accent bg-accent/10" : "border-line hover:border-line-strong"}`}
            title="ดับเบิลคลิกเพื่อแก้ · ลากลงไทม์ไลน์เพื่อวาง"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
              <span className="text-[10px] text-faint">{c.duration.toFixed(1)}s</span>
            </div>
            <div className="text-[11px] text-faint">
              {c.width}×{c.height} · {c.layers.length} เลเยอร์ · ใช้ {used} จุด
            </div>
            <div className="mt-1.5 flex gap-1 opacity-70 group-hover:opacity-100">
              <button className="btn h-6 flex-1 px-1.5 text-[11px]" onClick={(e) => (e.stopPropagation(), setEditing(id))}>
                <Pencil size={11} /> แก้
              </button>
              <button
                className="btn h-6 flex-1 px-1.5 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(null);
                  placeComponent(id);
                }}
              >
                <Plus size={11} /> วาง
              </button>
              <button className="btn h-6 px-1.5 text-[11px]" title="ทำสำเนา" onClick={(e) => (e.stopPropagation(), select({ kind: "component", id: duplicateComponent(id) }))}>
                <Copy size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SfxLibrary() {
  const name = useEditor((s) => s.name);
  const editing = useEditor((s) => s.editing);
  const project = useEditor((s) => s.project)!;
  const [list, setList] = useState<SfxInfo[]>([]);
  useEffect(() => {
    api<SfxInfo[]>("/api/sfx").then(setList).catch(() => {});
  }, []);

  const play = async (id: string) => {
    const { path } = await api<{ path: string }>(`/api/projects/${name}/sfx`, { method: "POST", body: { id } });
    await new Audio(`/files/${name}/${path}`).play();
  };

  return (
    <div className="space-y-1.5">
      <div className="mb-2 text-[11px] text-faint">
        {editing ? `กด + เพื่อใส่ใน “${project.components[editing]?.name}” ที่เส้นเวลา` : "กด + เพื่อวางในเรื่องหลักที่เส้นเวลา"} · เสียงทั้งหมดสร้างด้วยโค้ด ใช้ได้ไม่ติดลิขสิทธิ์
      </div>
      {list.map((s) => (
        <div key={s.id} className="flex items-center gap-2 rounded-lg bg-app/60 px-2 py-1.5">
          <button className="btn-icon h-7 w-7" title="ฟัง" onClick={() => play(s.id).catch(toastError)}>
            <Play size={13} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[12px]">{s.name}</div>
            <div className="truncate text-[11px] text-faint">{s.desc}</div>
          </div>
          <button
            className="btn-icon h-7 w-7"
            title={editing ? "ใส่ในคอมโพเนนต์" : "วางในเรื่อง"}
            onClick={() => {
              const st = useEditor.getState();
              const p = editing ? addSfxLayer(editing, s.id, s.name, st.compFrame / project.fps) : placeSfx(s.id, s.name);
              p.then(() => toast(`ใส่เสียง “${s.name}” แล้ว`)).catch(toastError);
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
