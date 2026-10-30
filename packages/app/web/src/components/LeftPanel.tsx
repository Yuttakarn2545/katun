import { ImagePlus, Mic, Plus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activeSceneId, addCharacter, addLine, addScene, uploadAsset } from "../lib/ops";
import { ComponentLibrary, SfxLibrary } from "./Library";
import { useEditor } from "../lib/store";
import { toast, toastError } from "./ui";

// คลังด้านซ้าย: โครงบท, ตัวละคร, พื้นหลัง

type Tab = "script" | "characters" | "backgrounds" | "components" | "sfx";

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("script");
  const editing = useEditor((s) => s.editing);
  // เปิดแก้คอมโพเนนต์แล้วให้คลังคอมโพเนนต์แสดงอยู่
  useEffect(() => {
    if (editing) setTab("components");
  }, [editing]);
  const tabs: [Tab, string][] = [
    ["script", "บท"],
    ["characters", "ตัวละคร"],
    ["backgrounds", "พื้นหลัง"],
    ["components", "คอมโพเนนต์"],
    ["sfx", "SFX"],
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line p-2">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? "chip-on" : "chip"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === "script" ? <ScriptOutline /> : tab === "characters" ? <CharacterList /> : tab === "backgrounds" ? <Backgrounds /> : tab === "components" ? <ComponentLibrary /> : <SfxLibrary />}
      </div>
    </div>
  );
}

function ScriptOutline() {
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const seek = useEditor((s) => s.seek);

  const jump = (lineId: string) => {
    const l = timeline?.lines.find((x) => x.id === lineId);
    if (l && timeline) seek(Math.round((l.start + 0.05) * timeline.fps));
  };

  return (
    <div className="space-y-3">
      {project.scenes.map((scene, si) => (
        <div key={scene.id}>
          <button
            onClick={() => {
              select({ kind: "scene", id: scene.id });
              const s = timeline?.scenes.find((x) => x.id === scene.id);
              if (s && timeline) seek(Math.round(s.start * timeline.fps));
            }}
            className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-semibold ${
              selection.kind === "scene" && selection.id === scene.id ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel-2"
            }`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm border border-white/20" style={{ background: /^bg|assets\//.test(scene.background) ? "#555" : scene.background }} />
            ฉาก {si + 1} · {scene.id}
          </button>
          <div className="space-y-0.5 pl-2">
            {scene.lines.map((line) => {
              const c = project.characters[line.character];
              const active = selection.kind === "line" && selection.id === line.id;
              return (
                <button
                  key={line.id}
                  onClick={() => {
                    select({ kind: "line", id: line.id });
                    jump(line.id);
                  }}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${active ? "bg-panel-3 ring-1 ring-accent/60" : "hover:bg-panel-2"}`}
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-faint">
                      {c?.name ?? line.character}
                      {line.audio && <Mic size={10} className="ml-1 inline text-accent" />}
                    </span>
                    <span className={`line-clamp-2 text-[12px] ${line.text ? "" : "text-faint italic"}`}>{line.text || "ยังไม่มีบท"}</span>
                  </span>
                </button>
              );
            })}
            <button className="btn-ghost h-7 w-full justify-start text-[12px] text-muted" onClick={() => addLine(scene.id)}>
              <Plus size={13} /> เพิ่มบทพูด
            </button>
          </div>
        </div>
      ))}
      <button className="btn w-full" onClick={() => addScene()}>
        <Plus size={14} /> เพิ่มฉาก
      </button>
    </div>
  );
}

function CharacterList() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  return (
    <div className="space-y-1">
      {Object.entries(project.characters).map(([id, c]) => {
        const lines = project.scenes.reduce((n, s) => n + s.lines.filter((l) => l.character === id).length, 0);
        return (
          <button
            key={id}
            onClick={() => select({ kind: "character", id })}
            className={`flex w-full items-center gap-3 rounded-lg p-2 text-left ${
              selection.kind === "character" && selection.id === id ? "bg-panel-3 ring-1 ring-accent/60" : "hover:bg-panel-2"
            }`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.color }}>
              <span className="flex gap-1.5">
                <span className="h-2 w-1.5 rounded-full bg-[#2b2d42]" />
                <span className="h-2 w-1.5 rounded-full bg-[#2b2d42]" />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{c.name}</span>
              <span className="block text-[11px] text-faint">{lines} บรรทัด</span>
            </span>
          </button>
        );
      })}
      <button className="btn mt-2 w-full" onClick={addCharacter}>
        <Users size={14} /> เพิ่มตัวละคร
      </button>
    </div>
  );
}

const PRESETS = [
  "linear-gradient(#bde0fe, #e0fbfc)",
  "linear-gradient(#ffe5ec, #fff1e6)",
  "linear-gradient(#fdffb6, #caffbf)",
  "linear-gradient(#cdb4db, #ffc8dd)",
  "linear-gradient(#1d3557, #457b9d)",
  "linear-gradient(#ffd6a5, #ffadad)",
  "linear-gradient(#a0c4ff, #bdb2ff)",
  "linear-gradient(#0f2027, #2c5364)",
  "#bde0fe",
  "#ffe5ec",
  "#caffbf",
  "#f1faee",
];

function Backgrounds() {
  const name = useEditor((s) => s.name);
  const update = useEditor((s) => s.update);
  const project = useEditor((s) => s.project)!;
  const sceneId = activeSceneId();
  const scene = project.scenes.find((s) => s.id === sceneId);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (bg: string) =>
    update((p) => {
      const s = p.scenes.find((x) => x.id === sceneId);
      if (s) s.background = bg;
    });

  return (
    <div>
      <div className="mb-2 text-[12px] text-muted">ใช้กับ: ฉาก {scene?.id}</div>
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((bg) => (
          <button
            key={bg}
            onClick={() => apply(bg)}
            className={`aspect-video rounded-md border-2 ${scene?.background === bg ? "border-accent" : "border-transparent hover:border-line-strong"}`}
            style={{ background: bg }}
            aria-label="ใช้พื้นหลังนี้"
          />
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          className="flex aspect-video items-center justify-center rounded-md border border-dashed border-line-strong text-muted hover:text-fg"
          aria-label="อัปโหลดรูปพื้นหลัง"
        >
          <ImagePlus size={18} />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            apply(await uploadAsset(name, f, f.name.split(".").pop() ?? "png"));
            toast("ใส่รูปพื้นหลังแล้ว");
          } catch (err) {
            toastError(err);
          }
        }}
      />
    </div>
  );
}
