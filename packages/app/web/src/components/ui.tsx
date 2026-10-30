import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";

// ส่วนประกอบ UI ที่ใช้ร่วมกัน: toast, modal, ปุ่มที่ล็อกตัวเองระหว่างทำงาน

type Toast = { id: number; message: string; kind: "info" | "error" };
const useToasts = create<{ items: Toast[]; push: (m: string, k?: Toast["kind"]) => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (message, kind = "info") => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === "error" ? 8000 : 3500);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, kind: Toast["kind"] = "info") => useToasts.getState().push(message, kind);
export const toastError = (err: unknown) => toast(err instanceof Error ? err.message : String(err), "error");

export function Toaster() {
  const { items, drop } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          onClick={() => drop(t.id)}
          className={`pointer-events-auto max-w-md cursor-pointer rounded-lg px-4 py-2.5 text-[13px] whitespace-pre-wrap shadow-xl ${
            t.kind === "error" ? "bg-danger text-white" : "bg-fg text-app"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[90vh] w-full overflow-auto rounded-xl border border-line bg-panel shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <span className="flex-1" />
          <button className="btn-icon" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** ปุ่มที่รอ promise เสร็จ ระหว่างนั้นกดซ้ำไม่ได้ และแสดง error เป็น toast */
export function AsyncButton({
  onClick,
  children,
  className = "btn",
  title,
}: {
  onClick: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      title={title}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch (err) {
          toastError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

/** ภาพย่อของเรื่อง: ใช้ภาพจริงถ้ามี ไม่มีก็วาดจากพื้นหลังฉากแรกและสีตัวละคร */
export function Thumb({
  url,
  background,
  colors = [],
  format = "16:9",
  className = "",
}: {
  url?: string;
  background?: string;
  colors?: string[];
  format?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const ratio = format === "9:16" ? "9 / 16" : format === "1:1" ? "1 / 1" : "16 / 9";
  const isImageBg = background && !/^(#|rgb|hsl|linear-gradient|radial-gradient)/i.test(background) && !/^[a-z]+$/i.test(background);
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-panel-3 ${className}`}>
      {url && !broken ? (
        <img src={url} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} style={{ aspectRatio: ratio }} />
      ) : (
        <div className="relative h-full max-h-full" style={{ aspectRatio: ratio, background: isImageBg ? "#2a2f3a" : background }}>
          <div className="absolute inset-x-0 bottom-[14%] flex justify-center gap-[8%]">
            {colors.slice(0, 3).map((c, i) => (
              <div key={i} className="aspect-square w-[18%] rounded-full" style={{ background: c, maxWidth: 48 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
