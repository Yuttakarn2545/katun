import { Player, type PlayerRef } from "@remotion/player";
import { Loader2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Video } from "../../../../renderer/src/Video";
import { fmtTime } from "../lib/api";
import { patchPlacement } from "../lib/compOps";
import { useEditor, useLayout } from "../lib/store";
import { StageOverlay } from "./StageOverlay";
import { castLayout } from "../../../../renderer/src/Video";
import { castPatch } from "./ActingPanel";

// พรีวิวสด: เล่น composition เดียวกับตอนเรนเดอร์ (WYSIWYG) ไม่ต้องรอเรนเดอร์

export const playerRef: { current: PlayerRef | null } = { current: null };

export function PreviewPlayer() {
  const timeline = useEditor((s) => s.timeline);
  const assetBase = useEditor((s) => s.assetBase);
  const prep = useEditor((s) => s.prep);
  const frame = useEditor((s) => s.frame);
  const setFrame = useEditor((s) => s.setFrame);
  const seekRequest = useEditor((s) => s.seekRequest);
  const rate = useEditor((s) => s.rate);
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const layout = useLayout();
  const dragOrigin = useRef(new Map<string, { x: number; y: number }>());
  const nowSec = frame / (project?.fps ?? 30);
  const curScene = layout?.scenes.find((s) => nowSec >= s.start && nowSec < s.start + s.duration) ?? layout?.scenes[layout.scenes.length - 1];
  const ref = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const p = ref.current;
    playerRef.current = p;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      if (playerRef.current === p) playerRef.current = null;
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [timeline, setFrame]);

  useEffect(() => {
    if (seekRequest) ref.current?.seekTo(seekRequest.frame);
  }, [seekRequest]);

  if (!timeline) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        {prep.status === "error" ? (
          <span className="max-w-md text-center text-danger">{prep.error}</span>
        ) : (
          <>
            <Loader2 className="animate-spin" size={22} />
            กำลังเตรียมเสียงและพรีวิว…
          </>
        )}
      </div>
    );
  }

  const total = Math.max(1, Math.ceil(timeline.duration * timeline.fps));
  const toggle = () => (playing ? ref.current?.pause() : ref.current?.play());

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 p-3">
        <Player
          ref={ref}
          component={Video}
          inputProps={{
            ...timeline,
            assetBase,
            placements: layout?.placements ?? timeline.placements,
            components: project?.components ?? timeline.components,
            // ค่าที่ไม่ต้องรอสร้างเสียงใหม่: ใช้ของล่าสุดจากหน้าจอทันที (ตำแหน่งตัวละคร ทรานสิชัน การแสดง ซับ)
            subtitles: project?.subtitles ?? timeline.subtitles,
            scenes: timeline.scenes.map((s) => {
              const cur = layout?.scenes.find((x) => x.id === s.id);
              return cur ? { ...s, layout: cur.layout, transition: cur.transition, autoFocus: cur.autoFocus } : s;
            }),
            lines: timeline.lines.map((l) => {
              const cur = layout?.lines.find((x) => x.id === l.id);
              return cur ? { ...l, emotion: cur.emotion, gesture: cur.gesture, camera: cur.camera } : l;
            }),
          }}
          durationInFrames={total}
          fps={timeline.fps}
          compositionWidth={timeline.width}
          compositionHeight={timeline.height}
          style={{ width: "100%", height: "100%" }}
          clickToPlay
          doubleClickToFullscreen
          spaceKeyToPlayOrPause={false}
          playbackRate={rate}
          initiallyMuted={muted}
        />
        {project && layout && (
          <StageOverlay
            width={timeline.width}
            height={timeline.height}
            items={[
              // ตัวละครของฉากปัจจุบัน (ลากแนวนอนเพื่อย้าย) อยู่ใต้คอมโพเนนต์
              ...(curScene
                ? castLayout(curScene, layout.characters, timeline.width, timeline.height).map((s) => ({
                    id: `char:${s.id}`,
                    cx: s.x,
                    cy: timeline.height - s.bottom - s.size / 2,
                    w: (s.size * 200) / 260,
                    h: s.size,
                    label: project.characters[s.id]?.name ?? s.id,
                  }))
                : []),
              ...layout.placements
                .filter((p) => frame / timeline.fps >= p.start && frame / timeline.fps <= p.start + p.duration && project.components[p.component])
                .map((p) => {
                  const c = project.components[p.component];
                  const k = (p.scale * timeline.width) / c.width;
                  return { id: p.id, cx: p.x * timeline.width, cy: p.y * timeline.height, w: c.width * k, h: c.height * k, label: c.name };
                }),
            ]}
            selected={selection.kind === "placement" ? selection.id : selection.kind === "character" ? `char:${selection.id}` : undefined}
            onSelect={(id) => id && select(id.startsWith("char:") ? { kind: "character", id: id.slice(5) } : { kind: "placement", id })}
            onDrag={(id, dx, dy, session) => {
              if (id.startsWith("char:") && curScene) {
                const cid = id.slice(5);
                if (!dragOrigin.current.has(session)) {
                  const spot = castLayout(curScene, layout.characters, timeline.width, timeline.height).find((s) => s.id === cid);
                  dragOrigin.current.set(session, { x: (spot?.x ?? timeline.width / 2) / timeline.width, y: 0 });
                }
                const ox = dragOrigin.current.get(session)!.x;
                useEditor.getState().update((p) => {
                  const s = p.scenes.find((x) => x.id === curScene.id);
                  if (s) castPatch(s, cid, { x: Math.max(-0.5, Math.min(1.5, Math.round((ox + dx / timeline.width) * 1000) / 1000)) });
                }, `stage:${session}`);
                return;
              }
              const pl = project.placements.find((x) => x.id === id);
              if (!pl) return;
              if (!dragOrigin.current.has(session)) dragOrigin.current.set(session, { x: pl.x, y: pl.y });
              const o = dragOrigin.current.get(session)!;
              patchPlacement(id, { x: Math.round((o.x + dx / timeline.width) * 1000) / 1000, y: Math.round((o.y + dy / timeline.height) * 1000) / 1000 }, `stage:${session}`);
            }}
          />
        )}
        {(prep.status === "running" || prep.status === "pending") && (
          <span className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white">
            <Loader2 size={12} className="animate-spin" /> อัปเดตเสียง…
          </span>
        )}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3">
        <span className="w-28 font-mono text-[12px] text-muted">
          {fmtTime(frame / timeline.fps)}.{String(Math.floor(((frame / timeline.fps) % 1) * 10))} / {fmtTime(timeline.duration)}
        </span>
        <span className="flex-1" />
        <button className="btn-icon" aria-label="ไปต้นเรื่อง" onClick={() => ref.current?.seekTo(0)}>
          <SkipBack size={16} />
        </button>
        <button className="btn-icon h-9 w-9 rounded-full bg-panel-3" aria-label={playing ? "หยุด" : "เล่น"} onClick={toggle}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="btn-icon" aria-label="ไปท้ายเรื่อง" onClick={() => ref.current?.seekTo(total - 1)}>
          <SkipForward size={16} />
        </button>
        <span className="flex-1" />
        <button
          className="btn-icon"
          aria-label={muted ? "เปิดเสียง" : "ปิดเสียง"}
          onClick={() => {
            if (muted) ref.current?.unmute();
            else ref.current?.mute();
            setMuted(!muted);
          }}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        {rate !== 1 && <span className="rounded bg-accent/20 px-1.5 text-[11px] text-accent">{rate}×</span>}
        <span className="w-24 text-right text-[11px] text-faint">
          {timeline.width}×{timeline.height}
        </span>
      </div>
    </div>
  );
}
