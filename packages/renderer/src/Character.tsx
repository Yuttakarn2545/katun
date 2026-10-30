import type { Emotion, Gesture, MouthShape } from "../../core/src/schema";

// ตัวละคร 2D แบบ SVG ชิ้นส่วนแยก (ตัว หัว ตา คิ้ว ปาก แขน) ขยับด้วยโค้ดล้วน ไม่ต้องใช้ไฟล์ภาพ
// viewBox 200x260: หัวกลางที่ (100,100), ปากที่ (100,138)

type Props = {
  color: string;
  mouth: MouthShape;
  speaking: boolean;
  time: number; // วินาที ใช้ทำท่าหายใจ/กะพริบตา
  seed: number; // ให้แต่ละตัวกะพริบตาไม่พร้อมกัน
  size: number; // ความสูงเป็นพิกเซล
  x: number;
  bottom: number;
  facing: 1 | -1;
  emotion?: Emotion;
  gesture?: Gesture;
  gestureT?: number; // วินาทีนับจากเริ่มท่าทาง
};

const INK = "#2b2d42";
const stroke = { stroke: INK, strokeWidth: 4, fill: "none", strokeLinecap: "round" as const };

/** ค่ากำกับท่าทาง: 1 ช่วงแรกแล้วค่อย ๆ หยุด */
const fadeOut = (t: number, len: number) => Math.max(0, 1 - t / len);

export const Character: React.FC<Props> = ({ color, mouth, speaking, time, seed, size, x, bottom, facing, emotion = "neutral", gesture = "none", gestureT = 0 }) => {
  const breathe = Math.sin(time * 2.2 + seed) * 0.012;
  const bob = speaking ? Math.abs(Math.sin(time * 9)) * -4 : 0;
  let tilt = speaking ? Math.sin(time * 3.1 + seed) * 3 : Math.sin(time * 0.9 + seed) * 1.2;
  const blinkPeriod = 3.4 + seed * 0.7;
  const blinking = emotion !== "surprised" && (time + seed * 1.3) % blinkPeriod < 0.12;
  const width = (size * 200) / 260;

  // ท่าทาง
  const g = gestureT;
  let headY = 0;
  let bodyY = 0;
  let jitter = 0;
  if (gesture === "nod") headY = Math.sin(g * 11) * 7 * fadeOut(g, 1.3);
  if (gesture === "shake") tilt += Math.sin(g * 15) * 9 * fadeOut(g, 1.3);
  if (gesture === "jump") bodyY = -Math.abs(Math.sin(g * 6)) * 34 * fadeOut(g, 1.1);
  if (gesture === "tremble") jitter = Math.sin(g * 70) * 2.2;
  if (emotion === "laugh") headY += Math.abs(Math.sin(time * 14)) * -3;

  return (
    <svg
      viewBox="0 0 200 260"
      width={width}
      height={size}
      style={{
        position: "absolute",
        left: x - width / 2,
        bottom,
        transform: `translate(${jitter}px, ${(bodyY * size) / 260}px) scaleX(${facing}) scaleY(${1 + breathe})`,
        transformOrigin: "50% 100%",
        overflow: "visible",
      }}
    >
      {/* เงา (เล็กลงตอนกระโดด) */}
      <ellipse cx={100} cy={256 - bodyY} rx={62 * (1 + bodyY / 120)} ry={8} fill="rgba(0,0,0,0.18)" />
      {/* ตัว */}
      <path d="M48 255 Q42 175 100 168 Q158 175 152 255 Z" fill={shade(color, -0.12)} />
      {/* แขน: แสดงเฉพาะตอนโบก/ชี้ วาดทับตัวให้เห็นชัด */}
      {gesture === "wave" && <Arm color={color} angle={-62 + Math.sin(g * 12) * 20} />}
      {gesture === "point" && <Arm color={color} angle={-25 + Math.sin(g * 3) * 3} />}
      <g transform={`translate(0 ${bob + headY}) rotate(${tilt} 100 160)`}>
        {/* หัว */}
        <circle cx={100} cy={100} r={78} fill={color} />
        <ellipse cx={72} cy={58} rx={20} ry={12} fill="rgba(255,255,255,0.25)" />
        <Cheeks emotion={emotion} />
        <Eyes emotion={emotion} blinking={blinking} />
        <Brows emotion={emotion} />
        {emotion === "confused" && <path d="M162 70 Q170 84 162 90 Q154 84 162 70 Z" fill="#8ecae6" stroke="#457b9d" strokeWidth={2} />}
        {emotion === "angry" && <path d="M150 40 l8 8 m0 -8 l-8 8" stroke="#e63946" strokeWidth={4} strokeLinecap="round" />}
        {mouth === "X" ? <IdleMouth emotion={emotion} /> : <Mouth shape={mouth} />}
      </g>
    </svg>
  );
};

/** แขนจากไหล่ขวา หมุนตามองศา (0 = ชี้ไปข้างหน้า, -90 = ชูขึ้น) */
function Arm({ color, angle }: { color: string; angle: number }) {
  return (
    <g transform={`rotate(${angle} 140 196)`}>
      <rect x={136} y={188} width={58} height={17} rx={8.5} fill={shade(color, -0.12)} />
      <circle cx={196} cy={196} r={12} fill={color} stroke={shade(color, -0.2)} strokeWidth={2} />
    </g>
  );
}

function Cheeks({ emotion }: { emotion: Emotion }) {
  const a = emotion === "shy" ? 0.65 : emotion === "happy" || emotion === "laugh" ? 0.42 : emotion === "angry" ? 0.4 : 0.28;
  const c = emotion === "angry" ? "230,57,70" : "255,90,90";
  return (
    <>
      <ellipse cx={58} cy={122} rx={emotion === "shy" ? 16 : 12} ry={emotion === "shy" ? 9 : 7} fill={`rgba(${c},${a})`} />
      <ellipse cx={142} cy={122} rx={emotion === "shy" ? 16 : 12} ry={emotion === "shy" ? 9 : 7} fill={`rgba(${c},${a})`} />
    </>
  );
}

function Eyes({ emotion, blinking }: { emotion: Emotion; blinking: boolean }) {
  if (blinking || emotion === "happy" || emotion === "laugh") {
    // ตาปิด / ตายิ้ม (^ ^)
    const d = emotion === "happy" || emotion === "laugh" ? (cx: number) => `M${cx - 12} 96 Q${cx} 82 ${cx + 12} 96` : (cx: number) => `M${cx - 12} 94 Q${cx} 100 ${cx + 12} 94`;
    return (
      <>
        <path d={d(72)} {...stroke} strokeWidth={emotion === "laugh" ? 5 : 4} />
        <path d={d(128)} {...stroke} strokeWidth={emotion === "laugh" ? 5 : 4} />
      </>
    );
  }
  if (emotion === "surprised") {
    return (
      <>
        {[72, 128].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy={90} r={15} fill="#fff" stroke={INK} strokeWidth={3} />
            <circle cx={cx} cy={91} r={6} fill={INK} />
          </g>
        ))}
      </>
    );
  }
  const ry = emotion === "angry" ? 9 : emotion === "sad" ? 11 : 13;
  const dy = emotion === "shy" ? 6 : emotion === "sad" ? 4 : 0;
  return (
    <>
      <ellipse cx={72} cy={92 + dy} rx={10} ry={ry} fill={INK} />
      <ellipse cx={128} cy={92 + dy} rx={10} ry={ry} fill={INK} />
      <circle cx={76} cy={87 + dy + (13 - ry) / 2} r={3.5} fill="#fff" />
      <circle cx={132} cy={87 + dy + (13 - ry) / 2} r={3.5} fill="#fff" />
      {emotion === "sad" && <path d="M64 108 q-3 9 2 12" stroke="#8ecae6" strokeWidth={4} fill="none" strokeLinecap="round" />}
    </>
  );
}

function Brows({ emotion }: { emotion: Emotion }) {
  switch (emotion) {
    case "angry":
      return (
        <>
          <path d="M58 68 L86 78" {...stroke} strokeWidth={6} />
          <path d="M142 68 L114 78" {...stroke} strokeWidth={6} />
        </>
      );
    case "sad":
      return (
        <>
          <path d="M60 76 L84 68" {...stroke} strokeWidth={5} />
          <path d="M140 76 L116 68" {...stroke} strokeWidth={5} />
        </>
      );
    case "surprised":
      return (
        <>
          <path d="M58 62 Q72 52 86 62" {...stroke} strokeWidth={5} />
          <path d="M114 62 Q128 52 142 62" {...stroke} strokeWidth={5} />
        </>
      );
    case "confused":
      return (
        <>
          <path d="M60 64 Q72 56 84 64" {...stroke} strokeWidth={5} />
          <path d="M116 74 L140 72" {...stroke} strokeWidth={5} />
        </>
      );
    default:
      return null;
  }
}

/** ปากตอนไม่ได้พูด ตามอารมณ์ */
function IdleMouth({ emotion }: { emotion: Emotion }) {
  switch (emotion) {
    case "happy":
      return <path d="M82 132 Q100 152 118 132" {...stroke} strokeWidth={5} />;
    case "laugh":
      return (
        <g>
          <path d="M80 130 Q100 162 120 130 Z" fill={INSIDE} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <ellipse cx={100} cy={146} rx={9} ry={5} fill={TONGUE} />
        </g>
      );
    case "surprised":
      return <ellipse cx={100} cy={140} rx={9} ry={12} fill={INSIDE} stroke={INK} strokeWidth={3} />;
    case "sad":
      return <path d="M86 144 Q100 132 114 144" {...stroke} />;
    case "angry":
      return <path d="M86 142 Q100 136 114 142" {...stroke} strokeWidth={5} />;
    case "confused":
      return <path d="M84 140 Q92 134 100 140 T116 138" {...stroke} />;
    case "shy":
      return <path d="M92 138 Q100 144 108 138" {...stroke} />;
    default:
      return <path d="M86 136 Q100 146 114 136" {...stroke} />;
  }
}

const INSIDE = "#5a1e2a";
const TONGUE = "#ff8fa3";
const LINE = { stroke: "#2b2d42", strokeWidth: 4, fill: "none", strokeLinecap: "round" as const };

// รูปปากตามมาตรฐาน Rhubarb: A ปิด(ม บ พ) B เปิดนิด C เปิด D อ้ากว้าง E ห่อ F จู๋ G ฟันแตะปาก(ฟ) H ลิ้นแตะ(ล) X พัก
const Mouth: React.FC<{ shape: MouthShape }> = ({ shape }) => {
  const open = (rx: number, ry: number, tongue = true) => (
    <g>
      <ellipse cx={100} cy={138} rx={rx} ry={ry} fill={INSIDE} stroke="#2b2d42" strokeWidth={3} />
      {tongue && ry > 6 && <ellipse cx={100} cy={138 + ry * 0.45} rx={rx * 0.6} ry={ry * 0.4} fill={TONGUE} />}
    </g>
  );
  switch (shape) {
    case "A":
      return <path d="M86 138 L114 138" {...LINE} strokeWidth={5} />;
    case "B":
      return (
        <g>
          {open(15, 6, false)}
          <rect x={89} y={133} width={22} height={4} fill="#fff" />
        </g>
      );
    case "C":
      return open(16, 11);
    case "D":
      return open(19, 17);
    case "E":
      return open(11, 12);
    case "F":
      return open(7, 7, false);
    case "G":
      return (
        <g>
          {open(14, 7, false)}
          <rect x={90} y={131} width={20} height={5} fill="#fff" />
        </g>
      );
    case "H":
      return (
        <g>
          {open(15, 12, false)}
          <ellipse cx={100} cy={132} rx={8} ry={4} fill={TONGUE} />
        </g>
      );
    default:
      return <path d="M86 136 Q100 146 114 136" {...LINE} />;
  }
};

function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 0xff);
  const b = ch(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
