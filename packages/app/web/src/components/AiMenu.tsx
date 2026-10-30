import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../App";
import { api } from "../lib/api";
import { useEditor } from "../lib/store";
import { toast, toastError } from "./ui";

// ปุ่ม "AI ช่วย" ในหน้าตัดต่อ: ปรับ/แปลบท และแนะนำการแสดง ผลลัพธ์ใส่ลงบทเป็น Undo ขั้นเดียว

const MODES: [string, string][] = [
  ["shorter", "ทำบทให้สั้นกระชับ"],
  ["longer", "ขยายบทให้ละเอียดขึ้น"],
  ["funnier", "ทำให้ตลกขึ้น"],
  ["kids", "ปรับให้เด็กเข้าใจง่าย"],
  ["formal", "ปรับให้สุภาพเป็นทางการ"],
];

export function AiMenu() {
  const name = useEditor((s) => s.name);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>("/api/ai/status").then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const run = async (label: string, fn: () => Promise<number>) => {
    setOpen(false);
    setBusy(label);
    try {
      if (!(await useEditor.getState().flush())) throw new Error("แก้ข้อผิดพลาดในบทก่อน");
      const n = await fn();
      toast(`${label}: แก้ ${n} บรรทัดแล้ว (Ctrl+Z เพื่อย้อน)`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  const rewrite = (mode: string, label: string, target?: string) =>
    run(label, async () => {
      const { lines } = await api<{ lines: { id: string; text: string }[] }>(`/api/projects/${name}/ai/rewrite`, { method: "POST", body: { mode, target } });
      const map = new Map(lines.map((l) => [l.id, l.text]));
      useEditor.getState().update((p) => {
        for (const s of p.scenes) for (const l of s.lines) if (map.has(l.id)) l.text = map.get(l.id)!;
      });
      return map.size;
    });

  const direct = () =>
    run("แนะนำการแสดง", async () => {
      const { lines } = await api<{ lines: { id: string; emotion: string; gesture: string; camera: string }[] }>(`/api/projects/${name}/ai/direct`, { method: "POST" });
      const map = new Map(lines.map((l) => [l.id, l]));
      useEditor.getState().update((p) => {
        for (const s of p.scenes)
          for (const l of s.lines) {
            const d = map.get(l.id);
            if (d) Object.assign(l, { emotion: d.emotion, gesture: d.gesture, camera: d.camera });
          }
      });
      return map.size;
    });

  return (
    <div className="relative" ref={ref}>
      <button className="btn" disabled={!!busy} onClick={() => setOpen((v) => !v)} title="ให้ Claude ช่วยปรับบทและการแสดง">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? `${busy}…` : "AI ช่วย"}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 shadow-2xl">
          {configured === false ? (
            <button className="block w-full px-3 py-2 text-left text-[13px] hover:bg-panel-3" onClick={() => navigate("#/settings")}>
              ใส่ Claude API key ที่หน้าตั้งค่าก่อน →
            </button>
          ) : (
            <>
              <div className="px-3 pt-1 pb-1 text-[11px] text-faint">ปรับบททั้งเรื่อง</div>
              {MODES.map(([m, label]) => (
                <button key={m} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-panel-3" onClick={() => rewrite(m, label)}>
                  {label}
                </button>
              ))}
              <button
                className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-panel-3"
                onClick={() => {
                  const target = prompt("แปลบทเป็นภาษาอะไร", "English");
                  if (target) void rewrite("translate", `แปลเป็น ${target}`, target);
                }}
              >
                แปลบทเป็นภาษาอื่น…
              </button>
              <div className="my-1 border-t border-line" />
              <button className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-panel-3" onClick={direct}>
                แนะนำสีหน้า ท่าทาง และกล้อง
              </button>
              <div className="px-3 pt-1 pb-1.5 text-[10px] text-faint">ใช้ Claude Opus 5.5 · ผลลัพธ์ย้อนได้ด้วย Ctrl+Z</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
