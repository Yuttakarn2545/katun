import {
  Check,
  Copy,
  FileArchive,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../App";
import { AsyncButton, Modal, Thumb, toast, toastError } from "../components/ui";
import { api, fmtTime, relativeTime, type ProjectSummary, type TemplateInfo, type TrashItem } from "../lib/api";

// หน้าแรกแบบ CapCut: เริ่มงานใหม่ เลือก/ค้นหา/จัดการโปรเจกต์ และถังขยะ

type Filter = "all" | "16:9" | "9:16" | "1:1" | "draft" | "exported";
type Sort = "updated" | "created" | "title";

const FILTERS: [Filter, string][] = [
  ["all", "ทั้งหมด"],
  ["16:9", "16:9"],
  ["9:16", "9:16"],
  ["1:1", "1:1"],
  ["draft", "ร่าง"],
  ["exported", "ส่งออกแล้ว"],
];

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [trashCount, setTrashCount] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("updated");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | { kind: "new"; step: "format" | "template" } | { kind: "ai" } | { kind: "trash" } | { kind: "rename"; p: ProjectSummary }>(null);

  const refresh = useCallback(async () => {
    const [list, trash] = await Promise.all([api<ProjectSummary[]>("/api/projects"), api<TrashItem[]>("/api/trash")]);
    setProjects(list);
    setTrashCount(trash.length);
    setSelected((s) => new Set([...s].filter((n) => list.some((p) => p.project === n))));
  }, []);

  useEffect(() => {
    refresh().catch(toastError);
    const onRefresh = () => { void refresh().catch(() => {}); };
    window.addEventListener("katun:refresh-projects", onRefresh);
    return () => window.removeEventListener("katun:refresh-projects", onRefresh);
  }, [refresh]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => !q || p.title.toLowerCase().includes(q) || p.project.toLowerCase().includes(q))
      .filter((p) =>
        filter === "all" ? true : filter === "draft" ? !p.exported : filter === "exported" ? p.exported : p.format === filter,
      )
      .sort((a, b) =>
        sort === "title" ? a.title.localeCompare(b.title, "th") : (b[sort === "created" ? "createdAt" : "updatedAt"] ?? "").localeCompare(a[sort === "created" ? "createdAt" : "updatedAt"] ?? ""),
      );
  }, [projects, query, filter, sort]);

  const trashSelected = async () => {
    for (const n of selected) await api(`/api/projects/${n}`, { method: "DELETE" });
    toast(`ย้าย ${selected.size} โปรเจกต์ไปถังขยะแล้ว`);
    setSelected(new Set());
    await refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
        <img src="./icon.svg" alt="" width={26} height={26} />
        <span className="text-[16px] font-semibold">Katun Studio</span>
        <span className="flex-1" />
        <div className="relative w-72">
          <Search size={15} className="absolute top-2 left-2.5 text-faint" />
          <input className="input pl-8" placeholder="ค้นหาโปรเจกต์" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn-ghost" onClick={() => setDialog({ kind: "trash" })}>
          <Trash2 size={15} /> ถังขยะ{trashCount ? ` (${trashCount})` : ""}
        </button>
        <button className="btn-icon" title="ตั้งค่าและเชื่อมต่อ AI" onClick={() => navigate("#/settings")}>
          <SettingsIcon size={17} />
        </button>
      </header>

      <main className="flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction
              primary
              icon={<Plus size={22} />}
              title="โปรเจกต์ใหม่"
              desc="เลือกขนาดแล้วเริ่มเลย"
              onClick={() => setDialog({ kind: "new", step: "format" })}
            />
            <QuickAction icon={<LayoutTemplate size={22} />} title="เริ่มจากเทมเพลต" desc="บทสนทนา สอนเด็ก รีวิว นิทาน" onClick={() => setDialog({ kind: "new", step: "template" })} />
            <QuickAction icon={<Sparkles size={22} />} title="ให้ AI ทำให้" desc="Claude เขียนบทจากหัวข้อ แล้วแก้ต่อได้ทุกอย่าง" onClick={() => setDialog({ kind: "ai" })} />
            <ImportAction />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h1 className="mr-3 text-[17px] font-semibold">โปรเจกต์ของคุณ</h1>
            {FILTERS.map(([f, label]) => (
              <button key={f} className={filter === f ? "chip-on" : "chip"} onClick={() => setFilter(f)}>
                {label}
                {f === "all" && projects ? ` ${projects.length}` : ""}
              </button>
            ))}
            <span className="flex-1" />
            <label className="flex items-center gap-2 text-[12px] text-muted">
              เรียง
              <select className="input w-36" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="updated">แก้ล่าสุด</option>
                <option value="created">สร้างล่าสุด</option>
                <option value="title">ชื่อ ก–ฮ</option>
              </select>
            </label>
          </div>

          {selected.size > 0 && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2">
              <span className="text-[13px]">เลือก {selected.size} โปรเจกต์</span>
              <AsyncButton className="btn" onClick={trashSelected}>
                <Trash2 size={14} /> ย้ายไปถังขยะ
              </AsyncButton>
              <button className="btn-ghost" onClick={() => setSelected(new Set())}>
                ยกเลิกเลือก
              </button>
            </div>
          )}

          {projects === null ? (
            <div className="py-20 text-center text-muted">กำลังโหลด…</div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line py-20 text-center">
              <div className="mb-1 text-[15px]">{projects.length ? "ไม่พบโปรเจกต์ที่ตรงกับตัวกรอง" : "เริ่มโปรเจกต์แรกของคุณ"}</div>
              <div className="mb-4 text-muted">{projects.length ? "ลองเปลี่ยนคำค้นหรือตัวกรอง" : "สร้างเรื่องใหม่ หรือเริ่มจากเทมเพลต"}</div>
              {!projects.length && (
                <button className="btn-primary" onClick={() => setDialog({ kind: "new", step: "format" })}>
                  <Plus size={15} /> โปรเจกต์ใหม่
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-6">
              {shown.map((p) => (
                <ProjectCard
                  key={p.project}
                  p={p}
                  selected={selected.has(p.project)}
                  selecting={selected.size > 0}
                  onToggle={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(p.project)) n.delete(p.project);
                      else n.add(p.project);
                      return n;
                    })
                  }
                  onRename={() => setDialog({ kind: "rename", p })}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {dialog?.kind === "new" && <NewProjectDialog initialStep={dialog.step} onClose={() => setDialog(null)} />}
      {dialog?.kind === "ai" && <AiDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "trash" && <TrashDialog onClose={() => setDialog(null)} onChanged={refresh} />}
      {dialog?.kind === "rename" && <RenameDialog p={dialog.p} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}

function QuickAction({ icon, title, desc, onClick, primary }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-4 rounded-xl border p-5 text-left transition-colors ${
        primary ? "border-accent/50 bg-accent/10 hover:bg-accent/15" : "border-line bg-panel hover:border-line-strong hover:bg-panel-2"
      }`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${primary ? "bg-accent text-accent-ink" : "bg-panel-3 text-fg"}`}>{icon}</span>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[12px] text-muted">{desc}</span>
      </span>
    </button>
  );
}

function ProjectCard({
  p,
  selected,
  selecting,
  onToggle,
  onRename,
  onChanged,
}: {
  p: ProjectSummary;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  onRename: () => void;
  onChanged: () => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const open = () => (selecting ? onToggle() : navigate(`#/edit/${p.project}`));
  const act = (fn: () => Promise<unknown>) => async () => {
    setMenu(false);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="group relative">
      <div
        onClick={open}
        className={`relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 ${selected ? "border-accent" : "border-transparent group-hover:border-line-strong"}`}
      >
        <Thumb url={p.thumbnailUrl} background={p.firstBackground} colors={p.colors} format={p.format} className="h-full w-full" />
        {p.durationSeconds !== undefined && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 text-[11px] text-white">{fmtTime(p.durationSeconds)}</span>
        )}
        {p.exported && <span className="absolute top-1.5 left-1.5 rounded bg-ok/90 px-1.5 text-[11px] font-semibold text-black">ส่งออกแล้ว</span>}
        {!p.valid && <span className="absolute top-1.5 left-1.5 rounded bg-warn px-1.5 text-[11px] text-black">ไฟล์มีปัญหา</span>}
        <button
          aria-label="เลือก"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full border ${
            selected ? "border-accent bg-accent text-accent-ink" : "border-white/60 bg-black/40 text-transparent opacity-0 group-hover:opacity-100"
          } ${selecting ? "opacity-100" : ""}`}
        >
          <Check size={14} />
        </button>
      </div>
      <div className="mt-2 flex items-start gap-1">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={open}>
          <div className="truncate text-[14px]">{p.title}</div>
          <div className="text-[12px] text-faint">
            {relativeTime(p.updatedAt)} · {p.format ?? "?"}
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button className="btn-icon h-7 w-7" aria-label="เมนูโปรเจกต์" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 shadow-2xl">
              <MenuItem icon={<Pencil size={14} />} label="เปลี่ยนชื่อ" onClick={() => (setMenu(false), onRename())} />
              <MenuItem
                icon={<Copy size={14} />}
                label="ทำสำเนา"
                onClick={act(async () => {
                  await api(`/api/projects/${p.project}/duplicate`, { method: "POST" });
                  toast("ทำสำเนาแล้ว");
                  await onChanged();
                })}
              />
              <MenuItem icon={<FolderOpen size={14} />} label="เปิดโฟลเดอร์" onClick={act(() => api(`/api/projects/${p.project}/open-folder`, { method: "POST" }))} />
              <MenuItem icon={<FileArchive size={14} />} label="ส่งออกไฟล์ .katun" onClick={() => { setMenu(false); window.location.href = `/api/projects/${p.project}/bundle`; }} />
              <div className="my-1 border-t border-line" />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                label="ย้ายไปถังขยะ"
                onClick={act(async () => {
                  await api(`/api/projects/${p.project}`, { method: "DELETE" });
                  toast(`ย้าย “${p.title}” ไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน`);
                  await onChanged();
                })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-panel-3 ${danger ? "text-danger" : ""}`}>
      {icon}
      {label}
    </button>
  );
}

const FORMATS = [
  { id: "16:9", name: "แนวนอน 16:9", hint: "YouTube, Facebook", w: 64, h: 36 },
  { id: "9:16", name: "แนวตั้ง 9:16", hint: "TikTok, Reels, Shorts", w: 27, h: 48 },
  { id: "1:1", name: "จัตุรัส 1:1", hint: "Instagram, โพสต์", w: 42, h: 42 },
] as const;

function NewProjectDialog({ initialStep, onClose }: { initialStep: "format" | "template"; onClose: () => void }) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [format, setFormat] = useState<"16:9" | "9:16" | "1:1" | null>(null);
  const [template, setTemplate] = useState(initialStep === "template" ? "dialogue" : "blank");
  const [title, setTitle] = useState("");
  useEffect(() => {
    api<TemplateInfo[]>("/api/templates").then(setTemplates).catch(toastError);
  }, []);

  const chosenFormat = format ?? templates.find((t) => t.id === template)?.format ?? "16:9";

  return (
    <Modal title="โปรเจกต์ใหม่" onClose={onClose} width={760}>
      <label className="label">ชื่อเรื่อง</label>
      <input className="input mb-5 h-10 text-[15px]" autoFocus placeholder="น้องนกสอนนับเลข" value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="label">ขนาดวิดีโอ</div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFormat(f.id)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left ${chosenFormat === f.id ? "border-accent bg-accent/10" : "border-line hover:border-line-strong"}`}
          >
            <span className="flex h-12 w-16 items-center justify-center">
              <span className="rounded-sm border-2 border-current" style={{ width: f.w, height: f.h, color: chosenFormat === f.id ? "var(--color-accent)" : "var(--color-muted)" }} />
            </span>
            <span>
              <span className="block text-[13px] font-semibold">{f.name}</span>
              <span className="block text-[11px] text-muted">{f.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="label">เริ่มจาก</div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setTemplate(t.id)}
            className={`rounded-lg border p-3 text-left ${template === t.id ? "border-accent bg-accent/10" : "border-line hover:border-line-strong"}`}
          >
            <div className="text-[13px] font-semibold">{t.name}</div>
            <div className="text-[11px] text-muted">{t.description}</div>
            <div className="mt-1 text-[11px] text-faint">{t.format}</div>
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          ยกเลิก
        </button>
        <AsyncButton
          className="btn-primary"
          onClick={async () => {
            const res = await api<{ name: string }>("/api/projects", {
              method: "POST",
              body: { title: title.trim() || templates.find((t) => t.id === template)?.name || "เรื่องใหม่", format: format ?? undefined, template },
            });
            navigate(`#/edit/${res.name}`);
          }}
        >
          สร้างและเริ่มแก้
        </AsyncButton>
      </div>
    </Modal>
  );
}

function AiDialog({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [chars, setChars] = useState(2);
  const [format, setFormat] = useState<"16:9" | "9:16" | "1:1">("9:16");
  const [language, setLanguage] = useState("ไทย");
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ configured: boolean }>("/api/ai/status").then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, []);
  const prompt = `ใช้ katun ทำวิดีโอการ์ตูน 2D เรื่อง: ${topic || "<หัวข้อ>"} ขนาด ${format} ยาวประมาณ ${seconds} วินาที เขียนบท เลือกเสียง เตรียมเสียง แล้วเรนเดอร์ตัวอย่างให้ดู`;

  return (
    <Modal title="ให้ AI ทำให้" onClose={onClose} width={600}>
      <label className="label">หัวข้อ / เรื่องที่อยากได้</label>
      <textarea className="input mb-3 h-auto min-h-20 py-2" autoFocus placeholder="น้องนกสอนนับเลข 1–3 ให้เด็กอนุบาล จบด้วยการชวนกดติดตาม" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="label">ความยาว {seconds} วิ</span>
          <input type="range" min={10} max={120} step={5} className="w-full" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="label">ตัวละคร</span>
          <select className="input" value={chars} onChange={(e) => setChars(Number(e.target.value))}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} ตัว
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">ขนาด</span>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
            <option value="9:16">9:16 แนวตั้ง</option>
            <option value="16:9">16:9 แนวนอน</option>
            <option value="1:1">1:1 จัตุรัส</option>
          </select>
        </label>
        <label className="block">
          <span className="label">ภาษา</span>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {["ไทย", "English", "日本語", "中文"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      {configured ? (
        <div className="mb-5 flex items-center gap-2">
          <span className="flex-1 text-[12px] text-muted">Claude Opus 5.5 เขียนบท ตัวละคร สีหน้า และท่าทางให้ แล้วเปิดหน้าตัดต่อให้แก้ต่อ</span>
          <AsyncButton
            className="btn-primary"
            onClick={async () => {
              if (!topic.trim()) throw new Error("ใส่หัวข้อก่อน");
              const res = await api<{ name: string; title: string }>("/api/ai/script", { method: "POST", body: { topic, seconds, characters: chars, format, language } });
              toast(`สร้าง “${res.title}” แล้ว`);
              navigate(`#/edit/${res.name}`);
            }}
          >
            <Sparkles size={14} /> เขียนบทให้เลย
          </AsyncButton>
        </div>
      ) : configured === false ? (
        <div className="mb-5 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[12px]">
          ยังไม่ได้ใส่ Claude API key ใส่ได้ที่{" "}
          <button className="underline" onClick={() => navigate("#/settings")}>
            หน้าตั้งค่า
          </button>{" "}
          หรือใช้วิธีด้านล่างผ่าน Claude Desktop / Claude Code แทน
        </div>
      ) : null}

      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted">หรือสั่งผ่าน Claude Desktop / Claude Code (MCP)</summary>
        <div className="mt-2 rounded-lg bg-app p-3 font-mono text-[12px] text-muted">{prompt}</div>
        <div className="mt-2 flex justify-end">
          <AsyncButton
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(prompt);
              toast("คัดลอกคำสั่งแล้ว วางใน Claude ได้เลย");
            }}
          >
            <Copy size={14} /> คัดลอกคำสั่ง
          </AsyncButton>
        </div>
      </details>
    </Modal>
  );
}

/** ปุ่มนำเข้าไฟล์ .katun (โปรเจกต์ที่ส่งออกจากเครื่องอื่น) */
function ImportAction() {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <QuickAction icon={busy ? <Loader2 size={22} className="animate-spin" /> : <FileArchive size={22} />} title="นำเข้า .katun" desc="เปิดโปรเจกต์ที่ส่งออกจากเครื่องอื่น" onClick={() => ref.current?.click()} />
      <input
        ref={ref}
        type="file"
        accept=".katun,application/zip"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const res = await api<{ name: string; title: string }>("/api/import", { method: "POST", raw: f });
            toast(`นำเข้า “${res.title}” แล้ว`);
            navigate(`#/edit/${res.name}`);
          } catch (err) {
            toastError(err);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function TrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const load = useCallback(() => api<TrashItem[]>("/api/trash").then(setItems).catch(toastError), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Modal title="ถังขยะ" onClose={onClose} width={600}>
      <p className="mb-4 text-[12px] text-muted">โปรเจกต์ในถังขยะจะถูกลบถาวรอัตโนมัติเมื่อครบ 30 วัน</p>
      {items === null ? (
        <div className="text-muted">กำลังโหลด…</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-muted">ถังขยะว่าง</div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate">{t.title}</div>
                <div className="text-[12px] text-faint">ลบ{relativeTime(t.deletedAt)}</div>
              </div>
              <AsyncButton
                onClick={async () => {
                  await api(`/api/trash/${t.id}/restore`, { method: "POST" });
                  toast(`กู้คืน “${t.title}” แล้ว`);
                  await Promise.all([load(), onChanged()]);
                }}
              >
                <RotateCcw size={14} /> กู้คืน
              </AsyncButton>
              <AsyncButton
                className="btn-ghost text-danger"
                title="ลบถาวร"
                onClick={async () => {
                  if (!confirm(`ลบ “${t.title}” ถาวร? กู้คืนไม่ได้อีก`)) return;
                  await api(`/api/trash/${t.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                <X size={14} /> ลบถาวร
              </AsyncButton>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function RenameDialog({ p, onClose, onDone }: { p: ProjectSummary; onClose: () => void; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState(p.title);
  const submit = async () => {
    if (!title.trim()) throw new Error("ใส่ชื่อเรื่องก่อน");
    await api(`/api/projects/${p.project}/rename`, { method: "POST", body: { title: title.trim() } });
    await onDone();
    onClose();
  };
  return (
    <Modal title="เปลี่ยนชื่อ" onClose={onClose} width={420}>
      <input
        className="input mb-4 h-10"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit().catch(toastError)}
      />
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          ยกเลิก
        </button>
        <AsyncButton className="btn-primary" onClick={submit}>
          บันทึก
        </AsyncButton>
      </div>
    </Modal>
  );
}
