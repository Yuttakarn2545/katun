import { AbsoluteFill, Html5Audio, Img, Loop, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { transformAt } from "../../core/src/anim";
import type { Component, Layer, MouthShape, TimelinePlacement } from "../../core/src/schema";
import { Character } from "./Character";
import { fontFamily } from "./fonts";

// เรนเดอร์คอมโพเนนต์ (แบบ precomp): เลเยอร์ล่างขึ้นบนตามลำดับ แต่ละเลเยอร์มีช่วงเวลาและคีย์เฟรมของตัวเอง

export type CompContext = {
  components: Record<string, Component>;
  characters: Record<string, { name: string; color: string }>;
  asset: (path: string) => string;
  volume: number;
};

const MAX_DEPTH = 8; // กันซ้อนลึกผิดปกติ (schema กันการซ้อนวนไว้แล้ว)

export const ComponentView: React.FC<{ id: string; ctx: CompContext; depth?: number }> = ({ id, ctx, depth = 0 }) => {
  const comp = ctx.components[id];
  const { fps } = useVideoConfig();
  if (!comp || depth > MAX_DEPTH) return null;
  return (
    <div style={{ position: "relative", width: comp.width, height: comp.height }}>
      {comp.layers.map((layer) =>
        layer.hidden ? null : (
          <Sequence
            key={layer.id}
            from={Math.round(layer.start * fps)}
            durationInFrames={Math.max(1, Math.round(layer.duration * fps))}
            layout="none"
            name={layer.name || layer.type}
          >
            <LayerView layer={layer} ctx={ctx} depth={depth} />
          </Sequence>
        ),
      )}
    </div>
  );
};

const TALK: MouthShape[] = ["C", "D", "B", "C", "E", "A", "D", "B"];

const LayerView: React.FC<{ layer: Layer; ctx: CompContext; depth: number }> = ({ layer, ctx, depth }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const tr = transformAt(layer, t);

  if (layer.type === "audio") {
    return <Html5Audio src={ctx.asset(layer.src)} volume={Math.min(1, layer.volume * ctx.volume)} />;
  }

  const style: React.CSSProperties = {
    position: "absolute",
    left: tr.x,
    top: tr.y,
    transform: `translate(-50%, -50%) rotate(${tr.rotation}deg) scale(${tr.scale})`,
    opacity: Math.max(0, Math.min(1, tr.opacity)),
    pointerEvents: "none",
  };

  switch (layer.type) {
    case "text":
      return (
        <div
          style={{
            ...style,
            fontFamily: fontFamily(layer.font),
            fontSize: layer.size,
            fontWeight: layer.weight,
            color: layer.color,
            textAlign: layer.align,
            lineHeight: 1.25,
            whiteSpace: layer.maxWidth ? "normal" : "pre",
            width: layer.maxWidth,
            WebkitTextStroke: layer.strokeWidth ? `${layer.strokeWidth}px ${layer.strokeColor}` : undefined,
            paintOrder: "stroke fill",
            background: layer.box,
            borderRadius: layer.box ? layer.boxRadius : undefined,
            padding: layer.box ? layer.boxPadding : undefined,
          }}
        >
          {layer.text}
        </div>
      );
    case "shape":
      return (
        <div style={{ ...style, width: layer.w, height: layer.h }}>
          <Shape layer={layer} />
        </div>
      );
    case "image":
      return <Img src={ctx.asset(layer.src)} style={{ ...style, width: layer.w, height: layer.h, objectFit: layer.fit }} />;
    case "character": {
      const color = ctx.characters[layer.character]?.color ?? "#f4a261";
      const w = (layer.size * 200) / 260;
      const mouth = layer.talking ? TALK[Math.floor(t * 10) % TALK.length] : "X";
      return (
        <div style={{ ...style, width: w, height: layer.size }}>
          <Character color={color} mouth={mouth} speaking={layer.talking} time={t} seed={0} size={layer.size} x={w / 2} bottom={0} facing={layer.facing} />
        </div>
      );
    }
    case "component": {
      const child = ctx.components[layer.component];
      if (!child) return null;
      return (
        <div style={{ ...style, width: child.width, height: child.height }}>
          <ComponentView id={layer.component} ctx={ctx} depth={depth + 1} />
        </div>
      );
    }
  }
};

function Shape({ layer }: { layer: Extract<Layer, { type: "shape" }> }) {
  const { w, h, fill, strokeColor, strokeWidth: sw, radius } = layer;
  const half = sw / 2;
  const stroke = sw ? { stroke: strokeColor, strokeWidth: sw, strokeLinejoin: "round" as const } : {};
  let el: React.ReactNode;
  switch (layer.shape) {
    case "rect":
      el = <rect x={half} y={half} width={w - sw} height={h - sw} rx={Math.min(radius, (h - sw) / 2)} fill={fill} {...stroke} />;
      break;
    case "ellipse":
      el = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - half} ry={h / 2 - half} fill={fill} {...stroke} />;
      break;
    case "star": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? 0.42 : 1;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${w / 2 + Math.cos(a) * (w / 2 - half) * r},${h / 2 + Math.sin(a) * (h / 2 - half) * r}`;
      });
      el = <polygon points={pts.join(" ")} fill={fill} {...stroke} />;
      break;
    }
    case "bubble": {
      // ฟองคำพูด: กล่องมุมมนพร้อมหางชี้ลงซ้าย
      const bh = h * 0.8 - half;
      const r = Math.min(radius * 2, bh / 2);
      const x0 = half, y0 = half, x1 = w - half;
      const d = `M${x0 + r},${y0} H${x1 - r} Q${x1},${y0} ${x1},${y0 + r} V${bh - r} Q${x1},${bh} ${x1 - r},${bh} H${w * 0.36} L${w * 0.2},${h - half} L${w * 0.24},${bh} H${x0 + r} Q${x0},${bh} ${x0},${bh - r} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} Z`;
      el = <path d={d} fill={fill} {...stroke} />;
      break;
    }
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", display: "block" }}>
      {el}
    </svg>
  );
}

/** คอมโพเนนต์ที่วางในวิดีโอหลัก: กึ่งกลางที่ (x, y) ของจอ ขนาด scale × ความกว้างจอ */
export const PlacementView: React.FC<{ pl: TimelinePlacement; ctx: CompContext }> = ({ pl, ctx }) => {
  const { width, height, fps } = useVideoConfig();
  const comp = ctx.components[pl.component];
  if (!comp) return null;
  const k = (pl.scale * width) / comp.width;
  const inner = <ComponentView id={pl.component} ctx={{ ...ctx, volume: ctx.volume * pl.volume }} />;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: pl.opacity }}>
      <div
        style={{
          position: "absolute",
          left: pl.x * width,
          top: pl.y * height,
          width: comp.width,
          height: comp.height,
          transform: `translate(-50%, -50%) scale(${k})`,
        }}
      >
        {pl.loop && pl.duration > comp.duration ? <Loop durationInFrames={Math.max(1, Math.round(comp.duration * fps))}>{inner}</Loop> : inner}
      </div>
    </AbsoluteFill>
  );
};

/** ใช้ใน Player ของหน้าแก้คอมโพเนนต์: แสดงคอมโพเนนต์เต็มเฟรมบนพื้นตาราง */
export type StageProps = { components: Record<string, Component>; characters: CompContext["characters"]; componentId: string; assetBase: string };

export const ComponentStage: React.FC<StageProps> = ({ components, characters, componentId, assetBase }) => (
  <AbsoluteFill
    style={{
      backgroundColor: "#1b1e26",
      backgroundImage: "linear-gradient(45deg,#252935 25%,transparent 25%,transparent 75%,#252935 75%),linear-gradient(45deg,#252935 25%,transparent 25%,transparent 75%,#252935 75%)",
      backgroundSize: "40px 40px",
      backgroundPosition: "0 0, 20px 20px",
    }}
  >
    <ComponentView id={componentId} ctx={{ components, characters, asset: (p) => `${assetBase}/${p}`, volume: 1 }} />
  </AbsoluteFill>
);
