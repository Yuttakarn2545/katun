import { AlertCircle, ArrowLeft, Check, Download, Loader2, Mic, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../App";
import { ExportDialog } from "../components/ExportDialog";
import { Inspector } from "../components/Inspector";
import { LeftPanel } from "../components/LeftPanel";
import { playerRef, PreviewPlayer } from "../components/PreviewPlayer";
import { Teleprompter } from "../components/Teleprompter";
import { AiMenu } from "../components/AiMenu";
import { Timeline } from "../components/Timeline";
import { compPlayerRef, CompStage, LayerTimeline } from "../components/CompEditor";
import { duplicateLayer, removeLayer, removePlacement } from "../lib/compOps";
import { toastError } from "../components/ui";
import { addMarker, deleteLine, duplicateLine, isLocked, splitLine } from "../lib/ops";
import { currentLayout, useEditor } from "../lib/store";

// หน้าตัดต่อ: แถบบน + คลังซ้าย + พรีวิวกลาง + Inspector ขวา + ไทม์ไลน์ล่าง

export function Editor({ name }: { name: string }) {
  const project = useEditor((s) => s.project);
  const loadedName = useEditor((s) => s.name);
  const editing = useEditor((s) => s.editing);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    useEditor.getState().load(name).catch((err: Error) => setError(err.message));
    return () => {
      void useEditor.getState().flush();
    };
  }, [name]);

  // คีย์ลัดมาตรฐาน
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      const st = useEditor.getState();
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        st.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void st.flush();
      } else if (e.key === " " && !typing) {
        e.preventDefault();
        if (st.editing) return compPlayerRef.current?.toggle();
        if (st.rate !== 1) st.setPrefs({ rate: 1 });
        playerRef.current?.toggle();
      } else if (typing || e.altKey) {
        return;
      } else if (st.editing) {
        // โหมดแก้คอมโพเนนต์: คีย์ลัดทำงานกับคอมโพเนนต์
        const sel = st.selection;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const step = (e.shiftKey ? (st.project?.fps ?? 30) : 1) * (e.key === "ArrowLeft" ? -1 : 1);
          compPlayerRef.current?.pause();
          st.seekComp(Math.max(0, st.compFrame + step));
        } else if ((e.key === "Delete" || e.key === "Backspace") && sel.kind === "layer") {
          e.preventDefault();
          removeLayer(sel.component, sel.id);
        } else if (mod && e.key.toLowerCase() === "d" && sel.kind === "layer") {
          e.preventDefault();
          duplicateLayer(sel.component, sel.id);
        } else if (e.key === "Escape") {
          if (sel.kind === "layer") st.select({ kind: "component", id: st.editing });
          else st.setEditing(null);
        }
        return;
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selection.kind === "placement") {
        e.preventDefault();
        removePlacement(st.selection.id);
      } else if (mod && e.key.toLowerCase() === "d" && st.selection.kind === "line") {
        e.preventDefault();
        duplicateLine(st.selection.id);
      } else if (!mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const now = st.frame / (st.project?.fps ?? 30);
        const lines = currentLayout()?.lines ?? [];
        const inside = (l: (typeof lines)[number]) => now > l.start && now < l.start + l.duration;
        const target = lines.find((l) => st.selection.kind === "line" && l.id === st.selection.id && inside(l)) ?? lines.find((l) => inside(l) && !isLocked(l.character));
        if (target?.id) splitLine(target.id, now).catch(toastError);
      } else if (!mod && e.key.toLowerCase() === "m") {
        addMarker(st.frame / (st.project?.fps ?? 30));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // ← → ทีละเฟรม, Shift = ทีละวินาที
        e.preventDefault();
        const step = (e.shiftKey ? (st.project?.fps ?? 30) : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        playerRef.current?.pause();
        st.seek(Math.max(0, st.frame + step));
      } else if (e.key === "Home") {
        st.seek(0);
      } else if (e.key === "End") {
        st.seek(Math.max(0, Math.ceil((currentLayout()?.duration ?? 0) * (st.project?.fps ?? 30)) - 1));
      } else if (["j", "k", "l"].includes(e.key.toLowerCase()) && !mod) {
        // J/K/L: ถอยหลัง / หยุด / เดินหน้า กดซ้ำเพื่อเร่ง
        const p = playerRef.current;
        const key = e.key.toLowerCase();
        if (key === "k") {
          p?.pause();
          st.setPrefs({ rate: 1 });
        } else {
          const dir = key === "l" ? 1 : -1;
          const rate = Math.sign(st.rate) === dir && p?.isPlaying() ? Math.max(-4, Math.min(4, st.rate * 2)) : dir;
          st.setPrefs({ rate });
          p?.play();
        }
      } else if (e.key === "=" || e.key === "+") {
        st.setPrefs({ pps: Math.min(400, st.pps * 1.4) });
      } else if (e.key === "-") {
        st.setPrefs({ pps: Math.max(8, st.pps / 1.4) });
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.selection.kind === "line") {
        e.preventDefault();
        try {
          deleteLine(st.selection.id);
        } catch (err) {
          toastError(err);
        }
      } else if (e.key === "Escape") {
        st.select({ kind: "project" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AlertCircle className="text-danger" />
        <div>{error}</div>
        <button className="btn" onClick={() => navigate("#/")}>
          กลับหน้าแรก
        </button>
      </div>
    );
  }
  if (!project || loadedName !== name) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 className="mr-2 animate-spin" size={18} /> กำลังเปิดโปรเจกต์…
      </div>
    );
  }

  // คอลัมน์ minmax(0,1fr): ไทม์ไลน์เรื่องยาว ๆ ต้องเลื่อนในตัวเอง ไม่ดันทั้งหน้าให้กว้างจนพรีวิวหลุดจอ
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[48px_minmax(0,1fr)_minmax(150px,32%)]">
      <TopBar onExport={() => setExporting(true)} onRecord={() => setRecording(true)} />
      <div className="grid min-h-0 grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 border-r border-line bg-panel">
          <LeftPanel />
        </aside>
        <section className="min-h-0 bg-app">
          {editing && project.components[editing] ? <CompStage id={editing} /> : <PreviewPlayer />}
        </section>
        <aside className="min-h-0 border-l border-line bg-panel">
          <Inspector />
        </aside>
      </div>
      <div className="min-h-0 border-t border-line bg-panel">
        {editing && project.components[editing] ? <LayerTimeline id={editing} /> : <Timeline />}
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {recording && <Teleprompter onClose={() => setRecording(false)} />}
    </div>
  );
}

function TopBar({ onExport, onRecord }: { onExport: () => void; onRecord: () => void }) {
  const project = useEditor((s) => s.project)!;
  const save = useEditor((s) => s.save);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const { undo, redo, update } = useEditor.getState();

  return (
    <header className="flex items-center gap-2 border-b border-line bg-panel px-3">
      <button
        className="btn-icon"
        aria-label="กลับหน้าแรก"
        onClick={async () => {
          await useEditor.getState().flush();
          navigate("#/");
        }}
      >
        <ArrowLeft size={17} />
      </button>
      <input
        className="h-8 w-72 rounded-md border border-transparent bg-transparent px-2 text-[14px] font-semibold outline-none hover:border-line focus:border-accent"
        value={project.title}
        onChange={(e) => update((p) => void (p.title = e.target.value), "title")}
        aria-label="ชื่อเรื่อง"
      />
      <Breadcrumb />
      <span
        className={`flex items-center gap-1 text-[12px] ${save.status === "error" ? "text-danger" : "text-faint"}`}
        title={save.status === "error" ? save.error : undefined}
      >
        {save.status === "saved" ? (
          <>
            <Check size={13} /> บันทึกแล้ว
          </>
        ) : save.status === "error" ? (
          <>
            <AlertCircle size={13} /> บันทึกไม่ได้: {save.error?.split("\n")[0]}
          </>
        ) : (
          <>
            <Loader2 size={13} className="animate-spin" /> กำลังบันทึก
          </>
        )}
      </span>
      <span className="flex-1" />
      <button className="btn-icon" title="ย้อนกลับ (Ctrl+Z)" disabled={!past} onClick={undo}>
        <Undo2 size={16} />
      </button>
      <button className="btn-icon" title="ทำซ้ำ (Ctrl+Shift+Z)" disabled={!future} onClick={redo}>
        <Redo2 size={16} />
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <AiMenu />
      <button className="btn" title="อัดเสียงทีละบรรทัดตามบท" onClick={onRecord}>
        <Mic size={15} /> อัดตามบท
      </button>
      <button className="btn-primary" onClick={onExport}>
        <Download size={15} /> ส่งออก
      </button>
    </header>
  );
}

/** เส้นทาง: เรื่องหลัก › คอมโพเนนต์ที่กำลังแก้ (Esc หรือคลิก "เรื่องหลัก" เพื่อกลับ) */
function Breadcrumb() {
  const editing = useEditor((s) => s.editing);
  const comp = useEditor((s) => (s.editing ? s.project?.components[s.editing] : undefined));
  if (!editing || !comp) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-[12px]">
      <button className="text-muted hover:text-fg" onClick={() => useEditor.getState().setEditing(null)}>
        เรื่องหลัก
      </button>
      <span className="text-faint">›</span>
      <span className="font-semibold text-accent">{comp.name}</span>
    </span>
  );
}
