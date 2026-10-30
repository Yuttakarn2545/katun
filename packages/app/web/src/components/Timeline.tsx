import {
  Eye,
  EyeOff,
  Flag,
  Lock,
  Magnet,
  Maximize2,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  WrapText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineLine } from "../../../../core/src/schema";
import { fmtTime } from "../lib/api";
import {
  addMarker,
  deleteLine,
  isLocked,
  moveLineTo,
  moveMarker,
  removeMarker,
  renameMarker,
  setSceneHold,
  setTrackState,
  splitLine,
  trimLine,
} from "../lib/ops";
import { isNeutralFx } from "../../../../core/src/dsp";
import { toWav } from "../lib/audio";
import { usePeaks } from "../lib/peaks";
import { insertAudioLine, setLineAudio, uploadVoice } from "../lib/ops";
import { movePlacement, patchPlacement, placeComponent } from "../lib/compOps";
import { EMOTION_LABEL } from "./ActingPanel";
import { useEditor, useLayout } from "../lib/store";
import { toast, toastError } from "./ui";

// ไทม์ไลน์หลายแทร็ก: ลากย้าย/สลับลำดับ/เปลี่ยนคนพูด, ลากขอบตัดหัวท้าย, แยกคลิป, สแนป, ซูม, marker, ควบคุมแทร็ก

const HEAD = 168; // ความกว้างหัวแทร็ก
const ROW = 38;
const RULER = 26;
const EDGE = 7; // ระยะจับขอบคลิปสำหรับตัด (px)
const SNAP_PX = 8;
const DRAG_THRESHOLD = 3;
let suppressClickUntil = 0; // กันคลิกที่ตามหลังการลากไม่ให้กระโดดเวลา

type Drag =
  | { kind: "move"; id: string; offset: number; dur: number; origChar: string; start: number; char: string; moved: boolean; x0: number; y0: number }
  | { kind: "trim"; id: string; edge: "start" | "end"; line: TimelineLine; at: number }
  | { kind: "hold"; sceneId: string; origEnd: number; origHold: number; at: number }
  | { kind: "marker"; id: string; at: number; moved: boolean; x0: number }
  | { kind: "scrub" }
  | { kind: "placement"; id: string; edge: "move" | "end"; start: number; dur: number; offset: number; at: number; moved: boolean; x0: number };

export function Timeline() {
  const project = useEditor((s) => s.project)!;
  const layout = useLayout()!;
  const frame = useEditor((s) => s.frame);
  const selection = useEditor((s) => s.selection);
  const { select, seek, setPrefs } = useEditor.getState();
  const pps = useEditor((s) => s.pps);
  const ripple = useEditor((s) => s.ripple);
  const snapOn = useEditor((s) => s.snap);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const name = useEditor((s) => s.name);
  const [fileOver, setFileOver] = useState<string | null>(null);
  const lineById = useMemo(() => new Map(project.scenes.flatMap((s) => s.lines).map((l) => [l.id, l])), [project]);

  /** ไฟล์เสียงที่ลากมาจาก Explorer: วางบนคลิป = เทคใหม่ของบรรทัดนั้น, วางบนแทร็กว่าง = บทพูดใหม่ */
  const dropAudio = async (file: File, char: string, time: number, lineId?: string) => {
    const res = await uploadVoice(name, await toWav(file));
    if (lineId) {
      setLineAudio(lineId, res.path);
      toast(`ใส่เสียง ${res.duration.toFixed(1)} วิ เป็นเทคใหม่แล้ว`);
    } else {
      insertAudioLine(char, time, res.path, file.name.replace(/\.[^.]+$/, ""));
      toast(`เพิ่มบทพูดจากไฟล์ ${file.name} แล้ว แก้ข้อความซับได้ที่แผงขวา`);
    }
  };

  const fps = project.fps;
  const duration = layout.duration;
  const now = frame / fps;
  const width = Math.max(800, duration * pps + 240);

  const charIds = Object.keys(project.characters);
  const rows = useMemo(
    () => [
      { key: "scenes", label: "ฉาก" },
      { key: "comps", label: "คอมโพเนนต์" },
      ...charIds.map((id) => ({ key: `c:${id}`, label: project.characters[id].name, char: id })),
      ...(project.music ? [{ key: "music", label: "เพลง" }] : []),
      { key: "subs", label: "ซับ" },
    ],
    [charIds.join(","), project.characters, project.music],
  );

  // เลื่อนตามเส้นเวลาระหว่างเล่น
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || drag) return;
    const x = now * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEAD - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [now, pps, drag]);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft - HEAD) / pps);
  };
  const rowAt = (clientY: number) => {
    const el = scrollRef.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop - RULER;
    return rows[Math.floor(y / ROW)];
  };

  // จุดที่สแนปได้: ต้นเรื่อง เส้นเวลา ขอบคลิปอื่น ขอบฉาก marker
  const snapPoints = (excludeId?: string) => {
    const pts = [0, now, duration, ...project.markers.map((m) => m.time)];
    for (const s of layout.scenes) pts.push(s.start, s.start + s.duration);
    for (const l of layout.lines) if (l.id !== excludeId) pts.push(l.start, l.start + l.duration);
    for (const p of layout.placements) if (p.id !== excludeId) pts.push(p.start, p.start + p.duration);
    return pts;
  };
  const snapTo = (times: number[], pts: number[]): { shift: number; at: number | null } => {
    if (!snapOn) return { shift: 0, at: null };
    let best = { shift: 0, at: null as number | null, dist: SNAP_PX / pps };
    for (const t of times) for (const p of pts) if (Math.abs(p - t) < best.dist) best = { shift: p - t, at: p, dist: Math.abs(p - t) };
    return best;
  };

  // ระหว่างลาก: ฟังเมาส์ทั้งหน้าต่าง
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current!;
      const t = timeAt(e.clientX);
      if (d.kind === "scrub") {
        seek(Math.round(t * fps));
      } else if (d.kind === "move") {
        const moved = d.moved || Math.abs(e.clientX - d.x0) > DRAG_THRESHOLD || Math.abs(e.clientY - d.y0) > DRAG_THRESHOLD;
        let start = Math.max(0, t - d.offset);
        const s = snapTo([start, start + d.dur], snapPoints(d.id));
        start = Math.max(0, start + s.shift);
        const row = rowAt(e.clientY);
        const char = row && "char" in row && row.char && !isLocked(row.char) ? row.char : d.char;
        setGuide(moved ? s.at : null);
        setDrag({ ...d, start, char, moved });
      } else if (d.kind === "trim") {
        const s = snapTo([t], snapPoints(d.id));
        setGuide(s.at);
        setDrag({ ...d, at: t + s.shift });
      } else if (d.kind === "hold") {
        const s = snapTo([t], snapPoints());
        setGuide(s.at);
        setDrag({ ...d, at: t + s.shift });
      } else if (d.kind === "placement") {
        const moved = d.moved || Math.abs(e.clientX - d.x0) > DRAG_THRESHOLD;
        if (d.edge === "move") {
          let start = Math.max(0, t - d.offset);
          const s = snapTo([start, start + d.dur], snapPoints(d.id));
          start = Math.max(0, start + s.shift);
          setGuide(moved ? s.at : null);
          setDrag({ ...d, at: start, moved });
        } else {
          const s = snapTo([t], snapPoints(d.id));
          setGuide(s.at);
          setDrag({ ...d, at: Math.max(d.start + 0.05, t + s.shift), moved });
        }
      } else if (d.kind === "marker") {
        setDrag({ ...d, at: t, moved: d.moved || Math.abs(e.clientX - d.x0) > DRAG_THRESHOLD });
      }
    };
    const up = () => {
      const d = dragRef.current!;
      setDrag(null);
      setGuide(null);
      try {
        if (d.kind === "move" && d.moved) suppressClickUntil = Date.now() + 250;
        if (d.kind === "move" && d.moved) moveLineTo(d.id, d.start, d.char !== d.origChar ? d.char : undefined);
        else if (d.kind === "trim") {
          const l = d.line;
          // ระยะบนไทม์ไลน์ × ความเร็วของคลิป = ระยะในไฟล์ต้นฉบับ
          const sp = lineById.get(d.id)?.fx.speed ?? 1;
          if (d.edge === "start") trimLine(d.id, "start", (l.trimStart ?? 0) + (d.at - l.start) * sp);
          else trimLine(d.id, "end", (l.trimEnd ?? 0) - (d.at - (l.start + l.duration)) * sp);
        } else if (d.kind === "hold") setSceneHold(d.sceneId, "end", d.origHold + (d.at - d.origEnd));
        else if (d.kind === "marker" && d.moved) moveMarker(d.id, d.at);
        else if (d.kind === "placement" && d.moved) {
          suppressClickUntil = Date.now() + 250;
          if (d.edge === "move") movePlacement(d.id, d.at);
          else patchPlacement(d.id, { duration: Math.round((d.at - d.start) * 100) / 100 });
        }
      } catch (err) {
        toastError(err);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind]);

  // Ctrl + ล้อเมาส์ = ซูมโดยให้เวลาใต้เมาส์อยู่ที่เดิม
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const t = timeAt(e.clientX);
      const next = Math.min(400, Math.max(8, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setPrefs({ pps: next });
      requestAnimationFrame(() => (el.scrollLeft = t * next - (e.clientX - el.getBoundingClientRect().left - HEAD)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const fit = () => {
    const el = scrollRef.current;
    if (el && duration > 0) setPrefs({ pps: Math.min(400, Math.max(8, (el.clientWidth - HEAD - 40) / duration)) });
  };

  const selectedLine = selection.kind === "line" ? layout.lines.find((l) => l.id === selection.id) : undefined;
  const splitTarget =
    selectedLine && now > selectedLine.start && now < selectedLine.start + selectedLine.duration
      ? selectedLine
      : layout.lines.find((l) => now > l.start && now < l.start + l.duration && !isLocked(l.character));
  const tickStep = pps >= 160 ? 0.5 : pps >= 80 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;

  return (
    <div className="flex h-full flex-col select-none">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
        <ToolButton
          title="แยกคลิปที่เส้นเวลา (S)"
          disabled={!splitTarget}
          onClick={() => splitTarget?.id && splitLine(splitTarget.id, now).catch(toastError)}
        >
          <Scissors size={15} />
        </ToolButton>
        <ToolButton
          title="ลบบทพูดที่เลือก (Delete)"
          disabled={!selectedLine}
          onClick={() => {
            try {
              if (selectedLine?.id) deleteLine(selectedLine.id);
            } catch (err) {
              toastError(err);
            }
          }}
        >
          <Trash2 size={15} />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <ToolButton title={ripple ? "Ripple เปิด: คลิปถัดไปเลื่อนตาม" : "Ripple ปิด: คลิปอื่นอยู่ที่เดิม"} on={ripple} onClick={() => setPrefs({ ripple: !ripple })}>
          <WrapText size={15} /> <span className="hidden xl:inline">Ripple</span>
        </ToolButton>
        <ToolButton title={snapOn ? "สแนปเปิด" : "สแนปปิด"} on={snapOn} onClick={() => setPrefs({ snap: !snapOn })}>
          <Magnet size={15} /> <span className="hidden xl:inline">สแนป</span>
        </ToolButton>
        <ToolButton title="เพิ่ม marker ที่เส้นเวลา (M)" onClick={() => addMarker(now)}>
          <Flag size={15} />
        </ToolButton>
        <span className="ml-2 text-faint">ลากคลิปเพื่อย้าย · ลากข้ามแทร็กเพื่อเปลี่ยนคนพูด · ลากขอบเพื่อตัด · Ctrl+ล้อเมาส์เพื่อซูม</span>
        <span className="flex-1" />
        <ToolButton title="ซูมออก (-)" onClick={() => setPrefs({ pps: Math.max(8, pps / 1.4) })}>
          <ZoomOut size={15} />
        </ToolButton>
        <input type="range" min={8} max={400} value={pps} onChange={(e) => setPrefs({ pps: Number(e.target.value) })} className="w-28" aria-label="ซูมไทม์ไลน์" />
        <ToolButton title="ซูมเข้า (+)" onClick={() => setPrefs({ pps: Math.min(400, pps * 1.4) })}>
          <ZoomIn size={15} />
        </ToolButton>
        <ToolButton title="พอดีจอ" onClick={fit}>
          <Maximize2 size={14} />
        </ToolButton>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div style={{ width: width + HEAD, height: RULER + rows.length * ROW }} className="relative">
          {/* แถบเวลา + marker */}
          <div
            className="sticky top-0 z-30 flex border-b border-line bg-panel"
            style={{ height: RULER }}
            onPointerDown={(e) => {
              seek(Math.round(timeAt(e.clientX) * fps));
              setDrag({ kind: "scrub" });
            }}
          >
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel" style={{ width: HEAD }} />
            <div className="relative flex-1 cursor-col-resize">
              {Array.from({ length: Math.ceil((duration + 4) / tickStep) }, (_, i) => (
                <span key={i} className="absolute top-0 h-full border-l border-line pl-1 text-[10px] leading-[26px] text-faint" style={{ left: i * tickStep * pps }}>
                  {tickStep < 1 && i % 2 ? "" : fmtTime(i * tickStep)}
                </span>
              ))}
              {project.markers.map((m) => {
                const at = drag?.kind === "marker" && drag.id === m.id ? drag.at : m.time;
                return (
                  <button
                    key={m.id}
                    title={`${m.label} · ดับเบิลคลิกเปลี่ยนชื่อ · คลิกขวาลบ`}
                    className="absolute top-0.5 z-10 flex h-5 -translate-x-0.5 cursor-grab items-center gap-0.5 rounded-sm bg-warn px-1 text-[10px] font-semibold text-black"
                    style={{ left: at * pps }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDrag({ kind: "marker", id: m.id, at: m.time, moved: false, x0: e.clientX });
                    }}
                    onClick={() => seek(Math.round(m.time * fps))}
                    onDoubleClick={() => {
                      const label = prompt("ชื่อ marker", m.label);
                      if (label !== null) renameMarker(m.id, label);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removeMarker(m.id);
                    }}
                  >
                    <Flag size={10} />
                    <span className="max-w-24 truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {rows.map((row, ri) => {
            const char = "char" in row ? row.char : undefined;
            const state = char ? project.tracks[char] : undefined;
            const isDropTarget = drag?.kind === "move" && drag.moved && char === drag.char && drag.char !== drag.origChar;
            return (
              <div key={row.key} className={`absolute left-0 flex border-b border-line ${isDropTarget ? "bg-accent/10" : ""}`} style={{ top: RULER + ri * ROW, height: ROW, width: width + HEAD }}>
                <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-line bg-panel px-2 text-[12px]" style={{ width: HEAD }}>
                  {char && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.characters[char].color }} />}
                  <span className={`min-w-0 flex-1 truncate ${state?.hidden ? "text-faint line-through" : "text-muted"}`}>{row.label}</span>
                  {char && (
                    <>
                      <TrackToggle title={state?.muted ? "เปิดเสียง" : "ปิดเสียง"} on={!!state?.muted} danger onClick={() => setTrackState(char, { muted: !state?.muted })}>
                        {state?.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      </TrackToggle>
                      <TrackToggle title="ฟังเดี่ยว" on={!!state?.solo} onClick={() => setTrackState(char, { solo: !state?.solo })}>
                        <span className="text-[10px] font-bold">S</span>
                      </TrackToggle>
                      <TrackToggle title={state?.locked ? "ปลดล็อก" : "ล็อกแทร็ก"} on={!!state?.locked} onClick={() => setTrackState(char, { locked: !state?.locked })}>
                        {state?.locked ? <Lock size={12} /> : <Unlock size={12} />}
                      </TrackToggle>
                      <TrackToggle title={state?.hidden ? "แสดงตัวละคร" : "ซ่อนตัวละครในวิดีโอ"} on={!!state?.hidden} onClick={() => setTrackState(char, { hidden: !state?.hidden })}>
                        {state?.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </TrackToggle>
                    </>
                  )}
                </div>
                <div
                  className={`relative flex-1 ${fileOver === row.key ? "bg-accent/15 outline-1 outline-accent outline-dashed" : ""}`}
                  onDragOver={(e) => {
                    const isComp = e.dataTransfer.types.includes("application/x-katun-component");
                    if (!isComp && (!char || !e.dataTransfer.types.includes("Files") || state?.locked)) return;
                    e.preventDefault();
                    setFileOver(isComp ? "comps" : row.key);
                  }}
                  onDragLeave={() => setFileOver(null)}
                  onDrop={(e) => {
                    setFileOver(null);
                    const compId = e.dataTransfer.getData("application/x-katun-component");
                    if (compId) {
                      // ลากคอมโพเนนต์จากคลังมาวางที่เวลานั้น
                      e.preventDefault();
                      placeComponent(compId, timeAt(e.clientX));
                      return;
                    }
                    if (!char || state?.locked) return;
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f) dropAudio(f, char, timeAt(e.clientX)).catch(toastError);
                  }}
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    select({ kind: "project" });
                    seek(Math.round(timeAt(e.clientX) * fps));
                    setDrag({ kind: "scrub" });
                  }}
                >
                  {row.key === "scenes" &&
                    layout.scenes.map((s) => {
                      const end = drag?.kind === "hold" && drag.sceneId === s.id ? drag.at : s.start + s.duration;
                      const sel = selection.kind === "scene" && selection.id === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`absolute top-1 bottom-1 flex items-center overflow-hidden rounded px-2 text-[11px] font-semibold text-[#1f2333] ${sel ? "ring-2 ring-white" : ""}`}
                          style={{ left: s.start * pps, width: Math.max(6, (end - s.start) * pps - 1), background: /^(bg|assets)\//.test(s.background) ? "#4b5263" : s.background }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            select({ kind: "scene", id: s.id });
                            seek(Math.round(s.start * fps));
                          }}
                        >
                          <span className="truncate">{s.id}</span>
                          <span
                            title="ลากเพื่อปรับช่วงค้างท้ายฉาก"
                            className="absolute top-0 right-0 h-full w-2 cursor-ew-resize bg-black/20 hover:bg-white/50"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              const scene = project.scenes.find((x) => x.id === s.id)!;
                              setDrag({ kind: "hold", sceneId: s.id, origEnd: s.start + s.duration, origHold: scene.holdEnd, at: s.start + s.duration });
                            }}
                          />
                        </div>
                      );
                    })}

                  {char &&
                    layout.lines
                      .filter((l) => l.character === char || (drag?.kind === "move" && drag.moved && drag.id === l.id && drag.char === char))
                      .map((l) => {
                        const isDragged = drag && "id" in drag && drag.id === l.id;
                        let left = l.start;
                        let right = l.start + l.duration;
                        let ghost = false;
                        if (isDragged && drag.kind === "move" && drag.moved) {
                          if (drag.char !== char) {
                            // ตำแหน่งเดิมในแทร็กเก่า แสดงจาง ๆ
                            if (l.character !== char) return null;
                          } else {
                            left = drag.start;
                            right = drag.start + drag.dur;
                            ghost = true;
                          }
                        }
                        if (isDragged && drag.kind === "trim") {
                          const src = l.sourceDuration ?? l.duration;
                          if (drag.edge === "start") left = Math.min(right - 0.1, Math.max(l.start - (l.trimStart ?? 0), drag.at));
                          else right = Math.max(left + 0.1, Math.min(l.start + src - (l.trimStart ?? 0), drag.at));
                        }
                        const locked = !!state?.locked;
                        const sel = selection.kind === "line" && selection.id === l.id;
                        const faded = isDragged && drag?.kind === "move" && drag.moved && !ghost;
                        return (
                          <div
                            key={l.id + (ghost ? "-ghost" : "")}
                            className={`group absolute top-1 bottom-1 flex items-center overflow-hidden rounded text-[11px] font-medium text-[#1b1d26] ${sel ? "ring-2 ring-white" : ""} ${
                              ghost ? "z-10 opacity-90 shadow-lg ring-2 ring-accent" : ""
                            } ${faded ? "opacity-30" : ""} ${l.muted ? "opacity-50" : ""} ${locked ? "cursor-not-allowed" : "cursor-grab"}`}
                            style={{
                              left: left * pps,
                              width: Math.max(4, (right - left) * pps - 1),
                              background: locked
                                ? `repeating-linear-gradient(135deg, ${project.characters[char].color}, ${project.characters[char].color} 6px, #0000 6px, #0000 9px), ${project.characters[char].color}aa`
                                : project.characters[char].color,
                            }}
                            onDragOver={(e) => {
                              if (locked || !e.dataTransfer.types.includes("Files")) return;
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onDrop={(e) => {
                              if (locked || !l.id) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setFileOver(null);
                              const f = e.dataTransfer.files[0];
                              if (f) dropAudio(f, char, 0, l.id).catch(toastError);
                            }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              if (!l.id) return;
                              select({ kind: "line", id: l.id });
                              if (locked) return seek(Math.round((l.start + 0.02) * fps));
                              setDrag({
                                kind: "move",
                                id: l.id,
                                offset: timeAt(e.clientX) - l.start,
                                dur: l.duration,
                                origChar: l.character,
                                char: l.character,
                                start: l.start,
                                moved: false,
                                x0: e.clientX,
                                y0: e.clientY,
                              });
                            }}
                            onClick={() => {
                              if (Date.now() > suppressClickUntil) seek(Math.round((l.start + 0.02) * fps));
                            }}
                          >
                            <Waveform audio={l.key ? l.audio : undefined} cues={l.cues} duration={l.duration} />
                            {l.id && !isNeutralFx(lineById.get(l.id)?.fx) && (
                              <span className="relative ml-1 shrink-0 rounded bg-black/35 px-1 text-[9px] font-bold text-white" title="มีเอฟเฟกต์เสียง">
                                FX
                              </span>
                            )}
                            <span className="relative truncate px-2">
                              {l.emotion && l.emotion !== "neutral" ? `${EMOTION_LABEL[l.emotion].split(" ")[0]} ` : ""}
                              {l.text || "…"}
                            </span>
                            {!locked && (
                              <>
                                <span
                                  title="ลากเพื่อตัดหัว"
                                  className="absolute top-0 left-0 h-full cursor-ew-resize bg-black/0 group-hover:bg-black/25"
                                  style={{ width: EDGE }}
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    if (!l.id) return;
                                    select({ kind: "line", id: l.id });
                                    setDrag({ kind: "trim", id: l.id, edge: "start", line: l, at: l.start });
                                  }}
                                />
                                <span
                                  title="ลากเพื่อตัดท้าย"
                                  className="absolute top-0 right-0 h-full cursor-ew-resize bg-black/0 group-hover:bg-black/25"
                                  style={{ width: EDGE }}
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    if (!l.id) return;
                                    select({ kind: "line", id: l.id });
                                    setDrag({ kind: "trim", id: l.id, edge: "end", line: l, at: l.start + l.duration });
                                  }}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}

                  {row.key === "comps" &&
                    layout.placements.map((p) => {
                      const c = project.components[p.component];
                      const dragging = drag?.kind === "placement" && drag.id === p.id && drag.moved ? drag : null;
                      const left = dragging?.edge === "move" ? dragging.at : p.start;
                      const right = dragging?.edge === "end" ? dragging.at : left + p.duration;
                      const sel = selection.kind === "placement" && selection.id === p.id;
                      return (
                        <div
                          key={p.id}
                          title={`${c?.name} · ดับเบิลคลิกเพื่อแก้คอมโพเนนต์`}
                          className={`group absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded bg-[#14b8a6]/85 px-2 text-[11px] font-medium text-[#042f2a] ${sel ? "z-10 ring-2 ring-white" : ""}`}
                          style={{ left: left * pps, width: Math.max(6, (right - left) * pps - 1) }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            select({ kind: "placement", id: p.id });
                            setDrag({ kind: "placement", id: p.id, edge: "move", start: p.start, dur: p.duration, offset: timeAt(e.clientX) - p.start, at: p.start, moved: false, x0: e.clientX });
                          }}
                          onClick={() => Date.now() > suppressClickUntil && seek(Math.round((p.start + 0.02) * fps))}
                          onDoubleClick={() => useEditor.getState().setEditing(p.component)}
                        >
                          <span className="truncate">◇ {c?.name}</span>
                          <span
                            title="ลากเพื่อปรับความยาว"
                            className="absolute top-0 right-0 h-full w-2 cursor-ew-resize group-hover:bg-black/25"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              select({ kind: "placement", id: p.id });
                              setDrag({ kind: "placement", id: p.id, edge: "end", start: p.start, dur: p.duration, offset: 0, at: p.start + p.duration, moved: false, x0: e.clientX });
                            }}
                          />
                        </div>
                      );
                    })}
                  {row.key === "comps" && layout.placements.length === 0 && (
                    <span className="pointer-events-none absolute top-2 left-2 text-[11px] text-faint">ลากคอมโพเนนต์จากแท็บ “คอมโพเนนต์” มาวางที่นี่</span>
                  )}

                  {row.key === "music" && project.music && (
                    <div
                      className="absolute top-1 bottom-1 flex items-center rounded bg-[#7f77dd] px-2 text-[11px] text-white"
                      style={{ left: 0, width: duration * pps }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        select({ kind: "project" });
                      }}
                    >
                      เพลงประกอบ · เบาลงตอนพูด
                    </div>
                  )}

                  {row.key === "subs" &&
                    project.subtitles.enabled &&
                    layout.lines.map((l) => (
                      <div
                        key={l.id}
                        className={`absolute top-1 bottom-1 flex items-center overflow-hidden rounded bg-panel-3 px-2 text-[11px] whitespace-nowrap text-muted ${
                          selection.kind === "line" && selection.id === l.id ? "ring-1 ring-white/70" : ""
                        }`}
                        style={{ left: l.start * pps, width: Math.max(4, l.duration * pps - 1) }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (l.id) select({ kind: "line", id: l.id });
                          seek(Math.round((l.start + 0.02) * fps));
                        }}
                      >
                        <span className="truncate">Aa {l.text}</span>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}

          {/* marker ลากเส้นยาวลงทุกแทร็ก */}
          {project.markers.map((m) => (
            <div key={m.id} className="pointer-events-none absolute z-10 w-px border-l border-dashed border-warn/70" style={{ left: HEAD + m.time * pps, top: RULER, bottom: 0 }} />
          ))}
          {/* เส้นนำตอนสแนป */}
          {guide !== null && <div className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-accent" style={{ left: HEAD + guide * pps }} />}
          {/* เส้นเวลาปัจจุบัน */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-danger" style={{ left: HEAD + now * pps }}>
            <div className="absolute top-0 -left-1.5 h-3 w-3 rotate-45 bg-danger" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ title, onClick, children, on, disabled }: { title: string; onClick: () => void; children: React.ReactNode; on?: boolean; disabled?: boolean }) {
  return (
    <button title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`btn-ghost h-7 px-2 ${on ? "bg-accent/15 text-accent hover:bg-accent/25" : ""}`}>
      {children}
    </button>
  );
}

function TrackToggle({ title, on, onClick, children, danger }: { title: string; on: boolean; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${on ? (danger ? "bg-danger/20 text-danger" : "bg-accent/20 text-accent") : "text-faint hover:bg-panel-3 hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

/** waveform จริงจากไฟล์เสียงที่ประมวลผลแล้ว (ถ้ายังไม่พร้อมใช้ภาพคร่าว ๆ จากรูปปากแทน) */
function Waveform({ audio, cues, duration }: { audio?: string; cues: TimelineLine["cues"]; duration: number }) {
  const peaks = usePeaks(audio);
  if (!peaks?.length) return <Wave cues={cues} duration={duration} />;
  const n = peaks.length;
  const top = peaks.map((p, i) => `${i},${50 - Math.min(1, p) * 46}`).join(" ");
  const bottom = peaks.map((p, i) => `${n - 1 - i},${50 + Math.min(1, peaks[n - 1 - i]) * 46}`).join(" ");
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-35" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`${top} ${bottom}`} fill="#000" />
    </svg>
  );
}

function Wave({ cues, duration }: { cues: TimelineLine["cues"]; duration: number }) {
  return (
    <span className="pointer-events-none absolute inset-0 opacity-25">
      {cues
        .filter((c) => c.value !== "X" && c.value !== "A" && c.start < duration)
        .map((c, i) => (
          <span
            key={i}
            className="absolute bg-black"
            style={{
              left: `${(c.start / duration) * 100}%`,
              width: `${((Math.min(c.end, duration) - c.start) / duration) * 100}%`,
              top: c.value === "D" ? "18%" : c.value === "C" || c.value === "E" ? "28%" : "38%",
              bottom: c.value === "D" ? "18%" : c.value === "C" || c.value === "E" ? "28%" : "38%",
            }}
          />
        ))}
    </span>
  );
}
