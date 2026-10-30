import { AbsoluteFill, Html5Audio, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { MouthShape, Timeline, TimelineLine, TimelineScene } from "../../core/src/schema";
import { Character } from "./Character";
import { PlacementView } from "./ComponentView";
import { fontFamily } from "./fonts";



const isImage = (bg: string) => bg.startsWith("bg/");

const DEFAULT_SUBTITLES: Timeline["subtitles"] = { enabled: true, position: "bottom", size: "medium", showName: true, style: "classic", karaoke: false, font: "Sarabun", color: "#ffffff", highlight: "#ffd166" };
const SIZE_SCALE = { small: 0.038, medium: 0.048, large: 0.06 };
const DUCK_RAMP = 0.3; // วินาทีที่ใช้ลด/เพิ่มเสียงเพลงรอบช่วงพูด

export type VideoProps = Timeline & { assetBase?: string };

// ตอนเรนเดอร์ไฟล์อยู่ใน public dir (staticFile); ใน Player ของโปรแกรมโหลดผ่าน URL ของ server (assetBase)
const assetUrl = (base: string | undefined, path: string) => (base ? `${base}/${path}` : staticFile(path));

export const Video: React.FC<VideoProps> = (timeline) => {
  const asset = (path: string) => assetUrl(timeline.assetBase, path);
  const { fps } = timeline;
  const f = (s: number) => Math.round(s * fps);
  const subtitles = timeline.subtitles ?? DEFAULT_SUBTITLES;
  const music = timeline.music;

  // เพลงประกอบ: ลดเสียงลงนุ่ม ๆ ทุกช่วงที่มีคนพูด
  const musicVolume = (frame: number) => {
    if (!music) return 0;
    const t = frame / fps;
    let gap = Infinity;
    for (const l of timeline.lines) {
      if (l.muted) continue; // คลิปที่ปิดเสียงไม่ต้องลดเพลง
      const d = t < l.start ? l.start - t : t > l.start + l.duration ? t - (l.start + l.duration) : 0;
      gap = Math.min(gap, d);
    }
    const k = Math.min(1, gap / (music.ramp ?? DUCK_RAMP));
    const fadeOut = Math.min(1, (timeline.duration - t) / 1);
    return (music.duckTo + (music.volume - music.duckTo) * k) * Math.max(0, fadeOut);
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {music && <Html5Audio src={asset(music.src)} loop volume={musicVolume} />}
      {timeline.scenes.map((scene, i) => {
        // ฉากเดิมแสดงต่ออีกช่วงเท่ากับทรานสิชันของฉากถัดไป ให้ฉากใหม่ (วาดทับ) เปลี่ยนเข้ามาโดยไม่เลื่อนเวลาของเรื่อง
        const next = timeline.scenes[i + 1]?.transition;
        const overlap = next && next.type !== "none" ? next.duration : 0;
        return (
          <Sequence key={scene.id} from={f(scene.start)} durationInFrames={Math.max(1, f(scene.duration + overlap))} name={`ฉาก ${scene.id}`}>
            <Scene scene={scene} timeline={timeline} asset={asset} />
          </Sequence>
        );
      })}
      {/* คอมโพเนนต์ที่วางในเรื่อง: อยู่เหนือฉากและตัวละคร ใต้ซับไตเติล */}
      {(timeline.placements ?? []).map((pl) => (
        <Sequence key={pl.id} from={f(pl.start)} durationInFrames={Math.max(1, f(pl.duration))} name={`คอมโพเนนต์ ${timeline.components?.[pl.component]?.name ?? ""}`}>
          <PlacementView pl={pl} ctx={{ components: timeline.components ?? {}, characters: timeline.characters, asset, volume: 1 }} />
        </Sequence>
      ))}
      {timeline.lines.map((line, i) => (
        <Sequence key={i} from={f(line.start)} durationInFrames={Math.max(1, Math.ceil(line.duration * fps))}>
          {!line.muted && line.audio && <Html5Audio src={asset(line.audio)} volume={line.volume ?? 1} />}
          {subtitles.enabled && (
            <Subtitle line={line} config={subtitles} name={timeline.characters[line.character]?.name ?? line.character} color={timeline.characters[line.character]?.color ?? "#3a86ff"} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export type CastSpot = { id: string; x: number; size: number; facing: 1 | -1; bottom: number };

/** ตำแหน่งตัวละครในฉาก: ใช้ค่าที่ผู้ใช้ตั้งไว้ ไม่มีก็กระจายเท่า ๆ กันและหันเข้าหากลางจอ (ใช้ทั้งตัวเรนเดอร์และกรอบลากในหน้าจอ) */
export function castLayout(scene: TimelineScene, characters: Timeline["characters"], width: number, height: number): CastSpot[] {
  const cast = scene.cast.filter((id) => !characters[id]?.hidden);
  const n = cast.length;
  const base = Math.min(height * 0.62, (width / Math.max(1, n)) * 0.85);
  return cast.map((id, i) => {
    const l = scene.layout?.[id];
    const x = (l?.x ?? (i + 1) / (n + 1)) * width;
    const facing: 1 | -1 = l?.facing ? l.facing : x <= width / 2 ? 1 : -1;
    return { id, x, size: base * (l?.scale ?? 1), facing, bottom: height * 0.12 };
  });
}

/** สีหน้าของตัวละคร ณ เวลา t: ตอนพูด = อารมณ์ของบทนั้น, ตอนเงียบ = อารมณ์ของบทล่าสุดของตัวเองในฉากนี้ */
function emotionAt(lines: TimelineLine[], id: string, t: number) {
  let last: TimelineLine | undefined;
  for (const l of lines) if (l.character === id && l.start <= t) last = l;
  return last?.emotion ?? "neutral";
}

const Scene: React.FC<{ scene: TimelineScene; timeline: Timeline; asset: (path: string) => string }> = ({ scene, timeline, asset }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // เวลาในฉาก → เวลาจริงของทั้งเรื่อง
  const t = scene.start + frame / fps;
  const local = frame / fps;
  // บทพูดของฉากนี้เท่านั้น (ช่วงที่ฉากแสดงต่อระหว่างทรานสิชัน ต้องไม่ขยับปากตามบทของฉากถัดไป)
  const lines = timeline.lines.filter((l) => l.sceneId === scene.id || !l.sceneId);
  const speaking = lines.find((l) => t >= l.start && t < l.start + l.duration);
  const spots = castLayout(scene, timeline.characters, width, height);

  // ---------- กล้อง ----------
  let zoom = 1;
  let shakeX = 0;
  let shakeY = 0;
  let focus = width / 2;
  const speakerSpot = speaking && spots.find((s) => s.id === speaking.character);
  if (scene.autoFocus && speakerSpot) {
    // ค่อย ๆ ซูมเข้าหาคนพูด และค่อย ๆ ถอยออกตอนท้ายบท
    const into = t - speaking!.start;
    const out = speaking!.start + speaking!.duration - t;
    const k = Math.min(1, into / 0.45, out / 0.45);
    zoom *= 1 + 0.12 * Math.max(0, k);
    focus = speakerSpot.x;
  }
  if (speaking?.camera && speaking.camera !== "none") {
    const into = t - speaking.start;
    if (speakerSpot) focus = speakerSpot.x;
    if (speaking.camera === "zoomIn") zoom *= 1 + 0.2 * Math.min(1, into / Math.max(0.3, speaking.duration));
    if (speaking.camera === "punch") zoom *= 1 + 0.28 * Math.exp(-into / 0.18);
    if (speaking.camera === "shake") {
      const amp = 16 * Math.exp(-into / 0.35);
      shakeX = Math.sin(into * 61) * amp;
      shakeY = Math.cos(into * 47) * amp * 0.6;
    }
  }

  // ---------- ทรานสิชันเข้าฉาก ----------
  const tr = scene.transition ?? { type: "fade", duration: 0.27 };
  const p = tr.type === "none" ? 1 : Math.min(1, local / tr.duration);
  const e = 1 - Math.pow(1 - p, 3);
  let enter: React.CSSProperties = {};
  switch (tr.type) {
    case "fade":
      enter = { opacity: p };
      break;
    case "slideLeft":
      enter = { transform: `translateX(${(1 - e) * 100}%)` };
      break;
    case "slideUp":
      enter = { transform: `translateY(${(1 - e) * 100}%)` };
      break;
    case "wipe":
      enter = { clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` };
      break;
    case "zoom":
      enter = { transform: `scale(${0.6 + 0.4 * e})`, opacity: p };
      break;
    case "iris":
      enter = { clipPath: `circle(${e * 75}% at 50% 50%)` };
      break;
  }

  return (
    <AbsoluteFill style={{ ...enter, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px) scale(${zoom})`, transformOrigin: `${focus}px ${height * 0.6}px` }}>
        {isImage(scene.background) ? (
          <Img src={asset(scene.background)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <AbsoluteFill style={{ background: scene.background }} />
        )}
        {/* พื้น */}
        <AbsoluteFill style={{ top: "auto", height: height * 0.18, background: "rgba(0,0,0,0.12)" }} />
        {spots.map((s, i) => {
          const isSpeaking = speaking?.character === s.id;
          // เข้าฉาก
          const ent = scene.layout?.[s.id]?.enter ?? "none";
          const q = Math.min(1, local / 0.6);
          const qe = 1 - Math.pow(1 - q, 3);
          let x = s.x;
          let bottom = s.bottom;
          let size = s.size;
          if (ent === "left") x = -s.size + (s.x + s.size) * qe;
          if (ent === "right") x = width + s.size - (width + s.size - s.x) * qe;
          if (ent === "bottom") bottom = s.bottom - s.size * (1 - qe);
          if (ent === "pop") size = s.size * (q < 1 ? Math.min(1.12, qe * 1.15) : 1);
          return (
            <Character
              key={s.id}
              color={timeline.characters[s.id]?.color ?? "#f4a261"}
              mouth={isSpeaking ? mouthAt(speaking!, t) : "X"}
              speaking={isSpeaking}
              time={t}
              seed={i}
              size={Math.max(1, size)}
              x={x}
              bottom={bottom}
              facing={s.facing}
              emotion={emotionAt(lines, s.id, t)}
              gesture={isSpeaking ? speaking!.gesture : "none"}
              gestureT={isSpeaking ? t - speaking!.start : 0}
            />
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

function mouthAt(line: TimelineLine, t: number): MouthShape {
  const local = t - line.start;
  return line.cues.find((c) => local >= c.start && local < c.end)?.value ?? "X";
}

/**
 * แบ่งบทเป็นคำพร้อมเวลาเริ่ม (สัดส่วนตามจำนวนตัวอักษร) สำหรับซับแบบคาราโอเกะ
 * ภาษาไทยไม่เว้นวรรค จึงใช้ตัวตัดคำของเบราว์เซอร์ (Intl.Segmenter)
 */
export function karaokeWords(text: string, duration: number): { text: string; start: number; end: number }[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  const parts = Seg ? [...new Seg("th", { granularity: "word" }).segment(text)].map((s) => s.segment) : text.split(/(\s+)/);
  const weight = (s: string) => s.replace(/\s/g, "").length;
  const total = parts.reduce((n, s) => n + weight(s), 0) || 1;
  let acc = 0;
  return parts.map((s) => {
    const start = (acc / total) * duration;
    acc += weight(s);
    return { text: s, start, end: (acc / total) * duration };
  });
}

const Subtitle: React.FC<{ line: TimelineLine; name: string; config: Timeline["subtitles"]; color: string }> = ({ line, name, config, color }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const appear = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: "clamp" });
  const bold = config.style === "bold";
  const fontSize = Math.round(Math.min(width, height) * SIZE_SCALE[config.size] * (bold ? 1.25 : 1));
  // แนวตั้ง: เว้นขอบให้พ้นปุ่มของ TikTok/Reels
  const edge = height > width ? height * 0.16 : fontSize * 1.2;
  const top = config.position === "top";
  const font = fontFamily(config.font || "Sarabun");

  const box: React.CSSProperties =
    config.style === "minimal"
      ? { textShadow: "0 2px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)" }
      : config.style === "bold"
        ? { fontWeight: 800, WebkitTextStroke: `${Math.round(fontSize * 0.14)}px #111`, paintOrder: "stroke fill", letterSpacing: "0.01em" }
        : config.style === "bubble"
          ? { background: "#ffffff", color: "#1f2333", border: `${Math.round(fontSize * 0.1)}px solid ${color}`, borderRadius: fontSize, padding: `${fontSize * 0.35}px ${fontSize * 0.9}px` }
          : { background: "rgba(20,20,30,0.78)", borderRadius: fontSize * 0.5, padding: `${fontSize * 0.4}px ${fontSize * 0.9}px` };
  const baseColor = config.style === "bubble" ? "#1f2333" : config.color;

  const words = config.karaoke ? karaokeWords(line.text, line.duration) : null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: top ? "flex-start" : "flex-end",
        alignItems: "center",
        paddingBottom: top ? 0 : edge,
        paddingTop: top ? (height > width ? height * 0.1 : fontSize * 1.2) : 0,
        opacity: appear,
        transform: bold ? `scale(${interpolate(frame, [0, 5], [0.85, 1], { extrapolateRight: "clamp" })})` : undefined,
      }}
    >
      <div style={{ maxWidth: "86%", color: baseColor, fontFamily: font, fontSize, lineHeight: 1.45, textAlign: "center", ...box }}>
        {config.showName && <span style={{ color: config.style === "bubble" ? color : config.highlight, fontWeight: 700 }}>{name}: </span>}
        {words
          ? words.map((w, i) => {
              const active = t >= w.start && t < w.end;
              const done = t >= w.end;
              return (
                <span
                  key={i}
                  style={{
                    color: active || done ? (config.style === "bubble" ? color : config.highlight) : undefined,
                    display: "inline-block",
                    transform: active ? "scale(1.08)" : undefined,
                    whiteSpace: "pre",
                  }}
                >
                  {w.text}
                </span>
              );
            })
          : line.text}
      </div>
    </AbsoluteFill>
  );
};
