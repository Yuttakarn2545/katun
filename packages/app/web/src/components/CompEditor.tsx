import { Player, type PlayerRef } from "@remotion/player";
import { AudioLines, Box, Eye, EyeOff, Image as ImageIcon, Lock, Pause, Play, Shapes, SkipBack, Smile, Type, Unlock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { transformAt } from "../../../../core/src/anim";
import type { Component, Layer } from "../../../../core/src/schema";
import { ComponentStage } from "../../../../renderer/src/ComponentView";
import { fmtTime } from "../lib/api";
import { patchLayer, setAnimValues } from "../lib/compOps";
import { useEditor } from "../lib/store";
import { StageOverlay } from "./StageOverlay";

// โหมดแก้คอมโพเนนต์ (แบบ After Effects): พรีวิวที่ลากเลเยอร์ได้ + ไทม์ไลน์เลเยอร์พร้อมคีย์เฟรม

export const compPlayerRef: { current: PlayerRef | null } = { current: null };

export const LAYER_ICON: Record<Layer["type"], React.ReactNode> = {
  text: <Type size={13} />,
  shape: <Shapes size={13} />,
  image: <ImageIcon size={13} />,
  character: <Smile size={13} />,
  audio: <AudioLines size={13} />,
  component: <Box size={13} />,
};

/** ขนาดคร่าว ๆ ของเลเยอร์ (ก่อน scale) ใช้วาดกรอบเลือกบนจอ */
export function layerSize(layer: Layer, components: Record<string, Component>): { w: number; h: number } {
  switch (layer.type) {
    case "text": {
      const lines = layer.text.split("\n");
      const longest = Math.max(1, ...lines.map((l) => l.length));
      const pad = layer.box ? layer.boxPadding * 2 : 0;
      const w = layer.maxWidth ?? longest * layer.size * 0.55;
      const rows = layer.maxWidth ? Math.ceil((longest * layer.size * 0.55) / layer.maxWidth) * lines.length : lines.length;
      return { w: w + pad, h: rows * layer.size * 1.25 + pad };
    }
    case "shape":
    case "image":
      return { w: layer.w, h: layer.h };
    case "character":
      return { w: (layer.size * 200) / 260, h: layer.size };
    case "component": {
      const c = components[layer.component];
      return c ? { w: c.width, h: c.height } : { w: 100, h: 100 };
    }
    case "audio":
      return { w: 0, h: 0 };
  }
}

export function CompStage({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const name = useEditor((s) => s.name);
  const selection = useEditor((s) => s.selection);
  const frame = useEditor((s) => s.compFrame);
  const compSeek = useEditor((s) => s.compSeek);
  const { setCompFrame, select } = useEditor.getState();
  const ref = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  const comp = project.components[id];
  const fps = project.fps;
  const total = Math.max(1, Math.round(comp.duration * fps));
  const origin = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    const p = ref.current;
    compPlayerRef.current = p;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setCompFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [id, setCompFrame]);

  useEffect(() => {
    if (compSeek) ref.current?.seekTo(Math.min(total - 1, compSeek.frame));
  }, [compSeek, total]);

  const characters = useMemo(() => Object.fromEntries(Object.entries(project.characters).map(([k, c]) => [k, { name: c.name, color: c.color }])), [project.characters]);
  const t = frame / fps;
  const items = comp.layers
    .filter((l) => l.type !== "audio" && !l.hidden && !l.locked && t >= l.start && t <= l.start + l.duration)
    .map((l) => {
      const tr = transformAt(l, t - l.start);
      const s = layerSize(l, project.components);
      return { id: l.id, cx: tr.x, cy: tr.y, w: s.w * tr.scale, h: s.h * tr.scale, rot: tr.rotation, label: l.name || l.type };
    });

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 p-3">
        <Player
          ref={ref}
          component={ComponentStage}
          inputProps={{ components: project.components, characters, componentId: id, assetBase: `/files/${name}` }}
          durationInFrames={total}
          fps={fps}
          compositionWidth={comp.width}
          compositionHeight={comp.height}
          style={{ width: "100%", height: "100%" }}
          loop
          spaceKeyToPlayOrPause={false}
        />
        <StageOverlay
          width={comp.width}
          height={comp.height}
          items={items}
          selected={selection.kind === "layer" ? selection.id : undefined}
          onSelect={(lid) => select(lid ? { kind: "layer", component: id, id: lid } : { kind: "component", id })}
          onDrag={(lid, dx, dy, session) => {
            const l = comp.layers.find((x) => x.id === lid);
            if (!l) return;
            if (!origin.current.has(session)) {
              const tr = transformAt(l, t - l.start);
              origin.current.set(session, { x: tr.x, y: tr.y });
            }
            const o = origin.current.get(session)!;
            setAnimValues(id, lid, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }, `stage:${session}`);
          }}
        />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3">
        <span className="w-28 font-mono text-[12px] text-muted">
          {fmtTime(t)}.{String(Math.floor((t % 1) * 10))} / {fmtTime(comp.duration)}
        </span>
        <span className="flex-1" />
        <button className="btn-icon" aria-label="ไปต้นคอมโพเนนต์" onClick={() => ref.current?.seekTo(0)}>
          <SkipBack size={16} />
        </button>
        <button className="btn-icon h-9 w-9 rounded-full bg-panel-3" aria-label={playing ? "หยุด" : "เล่น"} onClick={() => (playing ? ref.current?.pause() : ref.current?.play())}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span className="flex-1" />
        <span className="w-28 text-right text-[11px] text-faint">
          {comp.width}×{comp.height} · คลิก/ลากเลเยอร์บนจอได้
        </span>
      </div>
    </div>
  );
}

const HEAD = 200;
const ROW = 30;

/** ไทม์ไลน์เลเยอร์: แถวบน = เลเยอร์บนสุด, ลากแถบเพื่อย้าย/ตัดช่วงเวลา, ◆ = คีย์เฟรม */
export function LayerTimeline({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const frame = useEditor((s) => s.compFrame);
  const selection = useEditor((s) => s.selection);
  const { select, seekComp } = useEditor.getState();
  const comp = project.components[id];
  const fps = project.fps;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const drag = useRef<{ lid: string; mode: "move" | "start" | "end"; x0: number; start: number; duration: number; session: string } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - HEAD - 16));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = Math.max(10, width / comp.duration);
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(comp.duration, (clientX - r.left - HEAD) / pps));
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dt = Math.round(((e.clientX - d.x0) / pps) * fps) / fps;
      if (d.mode === "move") patchLayer(id, d.lid, { start: Math.max(0, Math.min(comp.duration - 0.05, d.start + dt)) }, d.session);
      else if (d.mode === "start") {
        const start = Math.max(0, Math.min(d.start + d.duration - 0.05, d.start + dt));
        patchLayer(id, d.lid, { start, duration: d.duration - (start - d.start) }, d.session);
      } else patchLayer(id, d.lid, { duration: Math.max(0.05, d.duration + dt) }, d.session);
    };
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [id, pps, fps, comp.duration]);

  const layers = [...comp.layers].reverse(); // บนสุดอยู่แถวแรก แบบ After Effects
  const t = frame / fps;
  const step = comp.duration > 20 ? 5 : comp.duration > 6 ? 1 : 0.5;

  return (
    <div className="flex h-full flex-col select-none">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
        <span>เลเยอร์ของ “{comp.name}”</span>
        <span className="text-faint">· ลากแถบเพื่อย้ายเวลา · ลากขอบเพื่อตัด · ◆ = คีย์เฟรม (เพิ่มได้ที่แผงขวา)</span>
      </div>
      <div ref={ref} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 flex h-6 border-b border-line bg-panel" onPointerDown={(e) => seekComp(Math.round(timeAt(e.clientX) * fps))}>
          <div className="shrink-0 border-r border-line" style={{ width: HEAD }} />
          <div className="relative flex-1 cursor-col-resize">
            {Array.from({ length: Math.floor(comp.duration / step) + 1 }, (_, i) => (
              <span key={i} className="absolute top-0 h-full border-l border-line pl-1 text-[10px] leading-6 text-faint" style={{ left: i * step * pps }}>
                {(i * step).toFixed(step < 1 ? 1 : 0)}s
              </span>
            ))}
          </div>
        </div>
        {layers.length === 0 && <div className="p-6 text-center text-muted">ยังไม่มีเลเยอร์ เพิ่มได้ที่แผงขวา</div>}
        {layers.map((l) => {
          const sel = selection.kind === "layer" && selection.id === l.id;
          const keyTimes = [...new Set(Object.values(l.keyframes).flatMap((ks) => ks?.map((k) => Math.round(k.t * 1000) / 1000) ?? []))];
          return (
            <div key={l.id} className={`flex border-b border-line ${sel ? "bg-accent/10" : ""}`} style={{ height: ROW }}>
              <div className="flex shrink-0 items-center gap-1.5 border-r border-line px-2 text-[12px]" style={{ width: HEAD }} onClick={() => select({ kind: "layer", component: id, id: l.id })}>
                <span className="text-faint">{LAYER_ICON[l.type]}</span>
                <span className={`min-w-0 flex-1 cursor-pointer truncate ${l.hidden ? "text-faint line-through" : ""}`}>{l.name || l.type}</span>
                <button className="text-faint hover:text-fg" title={l.hidden ? "แสดง" : "ซ่อน"} onClick={(e) => (e.stopPropagation(), patchLayer(id, l.id, { hidden: !l.hidden }))}>
                  {l.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button className="text-faint hover:text-fg" title={l.locked ? "ปลดล็อก" : "ล็อก (ลากบนจอไม่ได้)"} onClick={(e) => (e.stopPropagation(), patchLayer(id, l.id, { locked: !l.locked }))}>
                  {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              </div>
              <div className="relative flex-1" onPointerDown={(e) => e.target === e.currentTarget && seekComp(Math.round(timeAt(e.clientX) * fps))}>
                <div
                  className={`group absolute top-1 bottom-1 flex items-center overflow-hidden rounded px-2 text-[11px] ${l.type === "audio" ? "bg-[#7f77dd]" : "bg-[#3a86ff]"} ${sel ? "ring-2 ring-white" : ""} ${l.hidden ? "opacity-40" : ""} cursor-grab text-white`}
                  style={{ left: l.start * pps, width: Math.max(4, l.duration * pps) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    select({ kind: "layer", component: id, id: l.id });
                    drag.current = { lid: l.id, mode: "move", x0: e.clientX, start: l.start, duration: l.duration, session: `lt:${l.id}:${Date.now()}` };
                  }}
                >
                  <span className="truncate">{l.name}</span>
                  {(["start", "end"] as const).map((edge) => (
                    <span
                      key={edge}
                      className={`absolute top-0 h-full w-1.5 cursor-ew-resize group-hover:bg-black/30 ${edge === "start" ? "left-0" : "right-0"}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        select({ kind: "layer", component: id, id: l.id });
                        drag.current = { lid: l.id, mode: edge, x0: e.clientX, start: l.start, duration: l.duration, session: `lt:${l.id}:${Date.now()}` };
                      }}
                    />
                  ))}
                </div>
                {keyTimes.map((kt) => (
                  <button
                    key={kt}
                    title={`คีย์เฟรมที่ ${(l.start + kt).toFixed(2)} วิ`}
                    className="absolute top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-black/50 bg-warn"
                    style={{ left: (l.start + kt) * pps }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      select({ kind: "layer", component: id, id: l.id });
                      seekComp(Math.round((l.start + kt) * fps));
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-danger" style={{ left: HEAD + t * pps }} />
      </div>
    </div>
  );
}
