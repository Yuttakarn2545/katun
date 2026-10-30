import { useEffect, useRef, useState } from "react";

// ชั้นโปร่งใสวางทับ Player: คลิกเลือกชิ้นงานบนจอ และลากย้ายตำแหน่งได้ (หน่วยเป็นพิกเซลของงานจริง ไม่ใช่ของจอ)

export type StageItem = { id: string; cx: number; cy: number; w: number; h: number; rot?: number; label: string };

export function StageOverlay({
  width,
  height,
  items,
  selected,
  onSelect,
  onDrag,
  inset = 12,
}: {
  width: number;
  height: number;
  items: StageItem[];
  selected?: string;
  onSelect: (id: string | null) => void;
  /** dx, dy สะสมจากจุดเริ่มลาก; session เปลี่ยนทุกครั้งที่เริ่มลากใหม่ (ใช้รวม Undo) */
  onDrag: (id: string, dx: number, dy: number, session: string) => void;
  inset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<{ id: string; x0: number; y0: number; session: string; moved: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // งานถูกย่อให้พอดีกรอบแบบ contain และวางกึ่งกลาง เหมือนที่ Player ทำ
  const fit = Math.min(box.w / width, box.h / height) || 0;
  const ox = (box.w - width * fit) / 2;
  const oy = (box.h - height * fit) / 2;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !fit) return;
      const dx = (e.clientX - d.x0) / fit;
      const dy = (e.clientY - d.y0) / fit;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
      d.moved = true;
      onDrag(d.id, dx, dy, d.session);
    };
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [fit, onDrag]);

  return (
    // พื้นที่ว่างให้คลิกทะลุไปที่ Player ได้ (คลิกเล่น/หยุด) จับได้เฉพาะกรอบชิ้นงาน
    <div ref={ref} className="pointer-events-none absolute" style={{ inset }}>
      {items.map((it) => {
        const sel = it.id === selected;
        return (
          <div
            key={it.id}
            title={it.label}
            className={`group pointer-events-auto absolute cursor-move ${sel ? "outline-2 outline-accent" : "outline-1 outline-transparent hover:outline-white/60"} outline-dashed`}
            style={{
              left: ox + (it.cx - it.w / 2) * fit,
              top: oy + (it.cy - it.h / 2) * fit,
              width: Math.max(6, it.w * fit),
              height: Math.max(6, it.h * fit),
              transform: it.rot ? `rotate(${it.rot}deg)` : undefined,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(it.id);
              drag.current = { id: it.id, x0: e.clientX, y0: e.clientY, session: `${it.id}:${Date.now()}`, moved: false };
            }}
          >
            {sel && (
              <>
                <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 text-[10px] whitespace-nowrap text-accent-ink">{it.label}</span>
                {[
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
                ].map(([x, y]) => (
                  <span key={`${x}${y}`} className="absolute h-2 w-2 -translate-x-1 -translate-y-1 rounded-sm bg-accent" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
