import { Check, ChevronLeft, ChevronRight, Mic, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, toWav } from "../lib/audio";
import { setLineAudio, uploadVoice } from "../lib/ops";
import { useEditor } from "../lib/store";
import { Modal, toastError } from "./ui";

// โหมดอัดตามบท: โชว์บททีละบรรทัดตัวใหญ่ นับถอยหลัง อัด แล้วไปบรรทัดถัดไป (Space = เริ่ม/หยุด)

type Phase = "idle" | "countdown" | "recording" | "saving";

export function Teleprompter({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const name = useEditor((s) => s.name);
  const selection = useEditor((s) => s.selection);
  const lines = project.scenes.flatMap((s) => s.lines);
  const [index, setIndex] = useState(() => Math.max(0, selection.kind === "line" ? lines.findIndex((l) => l.id === selection.id) : 0));
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [auto, setAuto] = useState(true);
  const rec = useRef<{ stop: () => Promise<Blob>; level: () => number; started: number } | null>(null);
  const line = lines[index];
  const c = line ? project.characters[line.character] : undefined;

  // VU meter และเวลาที่อัด
  useEffect(() => {
    if (phase !== "recording") return;
    let raf = 0;
    const tick = () => {
      if (rec.current) {
        setLevel(rec.current.level());
        setElapsed((Date.now() - rec.current.started) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const begin = useCallback(async () => {
    setPhase("countdown");
    for (let n = 3; n > 0; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 650));
    }
    try {
      const r = await startRecording();
      rec.current = { ...r, started: Date.now() };
      setPhase("recording");
    } catch {
      setPhase("idle");
      toastError("เปิดไมโครโฟนไม่ได้ ตรวจสิทธิ์ไมค์ของเบราว์เซอร์");
    }
  }, []);

  const finish = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase("saving");
    try {
      const res = await uploadVoice(name, await toWav(await r.stop()));
      setLineAudio(lines[index].id, res.path);
      const next = index + 1;
      if (next < lines.length) {
        setIndex(next);
        if (auto) return void begin();
      }
      setPhase("idle");
    } catch (err) {
      toastError(err);
      setPhase("idle");
    }
  }, [name, lines, index, auto, begin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ระหว่างหน้าต่างนี้เปิด คีย์ลัดของหน้าตัดต่อไม่ควรทำงาน (ยกเว้น Esc ที่ใช้ปิดหน้าต่าง)
      if (e.key !== "Escape") e.stopPropagation();
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase === "idle") void begin();
        else if (phase === "recording") void finish();
      } else if (phase === "idle" && e.key === "ArrowRight") setIndex((i) => Math.min(lines.length - 1, i + 1));
      else if (phase === "idle" && e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, begin, finish, lines.length]);

  // ปิดหน้าต่างระหว่างอัด: หยุดไมค์โดยไม่บันทึก
  const close = () => {
    void rec.current?.stop();
    rec.current = null;
    onClose();
  };

  if (!line) return null;
  const done = lines.filter((l) => l.audio).length;

  return (
    <Modal title="อัดเสียงตามบท" onClose={close} width={760}>
      <div className="mb-3 flex items-center gap-3 text-[12px] text-muted">
        <span>
          บรรทัด {index + 1}/{lines.length}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-app">
          <div className="h-full bg-ok" style={{ width: `${(done / lines.length) * 100}%` }} />
        </div>
        <span>มีเสียงอัดแล้ว {done} บรรทัด</span>
      </div>

      <div className="relative mb-4 rounded-xl bg-app px-8 py-10 text-center">
        <div className="mb-3 flex items-center justify-center gap-2 text-[13px]" style={{ color: c?.color }}>
          <span className="h-3 w-3 rounded-full" style={{ background: c?.color }} />
          {c?.name}
          {line.audio && (
            <span className="ml-2 flex items-center gap-1 rounded-full bg-ok/15 px-2 text-[11px] text-ok">
              <Check size={11} /> มีเสียงแล้ว {line.takes.length} เทค
            </span>
          )}
        </div>
        <div className="text-[30px] leading-snug font-semibold">{line.text}</div>
        {lines[index + 1] && <div className="mt-5 text-[14px] text-faint">ถัดไป: {lines[index + 1].text}</div>}
        {phase === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 text-[80px] font-bold text-white">{count}</div>
        )}
      </div>

      <div className="mb-4 flex h-6 items-center gap-3">
        {phase === "recording" && (
          <>
            <span className="h-3 w-3 animate-pulse rounded-full bg-danger" />
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-app">
              <div className={`h-full transition-[width] duration-75 ${level > 0.9 ? "bg-danger" : level > 0.5 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, level * 110)}%` }} />
            </div>
            <span className="w-14 font-mono text-[12px] text-danger">{elapsed.toFixed(1)}s</span>
          </>
        )}
        {phase === "saving" && <span className="text-[12px] text-muted">กำลังบันทึก…</span>}
        {phase === "idle" && <span className="text-[12px] text-faint">กด Space เพื่อเริ่มอัด · ← → เลือกบรรทัด · ระดับเสียงควรอยู่ช่วงสีเขียว–เหลือง</span>}
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-icon" aria-label="บรรทัดก่อนหน้า" disabled={phase !== "idle" || index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="btn-icon" aria-label="บรรทัดถัดไป" disabled={phase !== "idle" || index >= lines.length - 1} onClick={() => setIndex(index + 1)}>
          <ChevronRight size={16} />
        </button>
        <label className="ml-2 flex items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> อัดบรรทัดถัดไปต่อเลย
        </label>
        <span className="flex-1" />
        {phase === "recording" ? (
          <button className="btn border-danger text-danger" onClick={() => void finish()}>
            <Square size={13} /> หยุดและบันทึก (Space)
          </button>
        ) : (
          <button className="btn-primary" disabled={phase !== "idle"} onClick={() => void begin()}>
            {line.audio ? <RotateCcw size={14} /> : <Mic size={14} />} {line.audio ? "อัดเทคใหม่" : "เริ่มอัด"} (Space)
          </button>
        )}
      </div>
    </Modal>
  );
}
