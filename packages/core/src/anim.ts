import { ANIM_PROPS, type AnimProp, type Keyframe, type Layer } from "./schema.js";

// คีย์เฟรมของเลเยอร์: คำนวณค่า ณ เวลาใด ๆ และสร้างแอนิเมชันสำเร็จรูป (ใช้ทั้งตัวเรนเดอร์ หน้าจอ และ MCP)

function bounceOut(t: number): number {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export function ease(kind: Keyframe["ease"], t: number): number {
  switch (kind) {
    case "linear":
      return t;
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "bounce":
      return bounceOut(t);
    case "hold":
      return 0;
  }
}

/** ค่าของคุณสมบัติ ณ เวลา t (วินาทีภายในเลเยอร์): มีคีย์เฟรมใช้คีย์เฟรม ไม่มีใช้ค่าคงที่ของเลเยอร์ */
export function valueAt(layer: Pick<Layer, AnimProp | "keyframes">, prop: AnimProp, t: number): number {
  const keys = layer.keyframes?.[prop];
  if (!keys?.length) return layer[prop];
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  const i = ks.findIndex((k) => k.t > t) - 1;
  const a = ks[i], b = ks[i + 1];
  const p = ease(a.ease ?? "easeInOut", (t - a.t) / (b.t - a.t || 1));
  return a.v + (b.v - a.v) * p;
}

export function transformAt(layer: Pick<Layer, AnimProp | "keyframes">, t: number): Record<AnimProp, number> {
  return Object.fromEntries(ANIM_PROPS.map((p) => [p, valueAt(layer, p, t)])) as Record<AnimProp, number>;
}

/** ใส่/แก้คีย์เฟรมที่เวลา t (ถ้ามีคีย์ห่างไม่เกิน 1/60 วิ ถือเป็นคีย์เดียวกัน) */
export function setKeyframe(layer: Layer, prop: AnimProp, t: number, v: number, easing?: Keyframe["ease"]): void {
  const keys = [...(layer.keyframes[prop] ?? [])];
  const i = keys.findIndex((k) => Math.abs(k.t - t) < 1 / 60);
  if (i >= 0) keys[i] = { ...keys[i], v, ...(easing ? { ease: easing } : {}) };
  else keys.push({ t: Math.max(0, t), v, ease: easing ?? "easeInOut" });
  layer.keyframes[prop] = keys.sort((a, b) => a.t - b.t);
}

export function removeKeyframe(layer: Layer, prop: AnimProp, t: number): void {
  const keys = (layer.keyframes[prop] ?? []).filter((k) => Math.abs(k.t - t) >= 1 / 60);
  if (keys.length) layer.keyframes[prop] = keys;
  else delete layer.keyframes[prop];
}

export const ANIM_PRESETS = {
  fadeIn: "จางเข้า",
  popIn: "เด้งเข้า",
  slideInLeft: "เลื่อนเข้าจากซ้าย",
  slideInRight: "เลื่อนเข้าจากขวา",
  slideInUp: "เลื่อนขึ้นจากล่าง",
  dropIn: "ตกลงมาเด้ง",
  pulse: "เต้นเป็นจังหวะ",
  wiggle: "ส่ายไปมา",
  fadeOut: "จางออก",
  shrinkOut: "ย่อหายไป",
} as const;
export type AnimPreset = keyof typeof ANIM_PRESETS;

/**
 * ใส่แอนิเมชันสำเร็จรูปให้เลเยอร์ (เข้า = ต้นเลเยอร์, ออก = ท้ายเลเยอร์) โดยยึดค่าปัจจุบันของเลเยอร์เป็นตำแหน่งปกติ
 * compWidth/compHeight ใช้คำนวณระยะเลื่อนเข้าจากขอบ
 */
export function applyPreset(layer: Layer, preset: AnimPreset, compWidth: number, compHeight: number, length = 0.5): void {
  const d = layer.duration;
  const len = Math.min(length, d / 2);
  const base = { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity };
  const k = (prop: AnimProp, t: number, v: number, e: Keyframe["ease"]) => setKeyframe(layer, prop, t, v, e);
  switch (preset) {
    case "fadeIn":
      k("opacity", 0, 0, "easeOut");
      k("opacity", len, base.opacity, "linear");
      break;
    case "popIn":
      k("scale", 0, 0, "bounce");
      k("scale", len * 1.4, base.scale, "linear");
      k("opacity", 0, 0, "easeOut");
      k("opacity", len * 0.4, base.opacity, "linear");
      break;
    case "slideInLeft":
      k("x", 0, -compWidth * 0.6, "easeOut");
      k("x", len, base.x, "linear");
      break;
    case "slideInRight":
      k("x", 0, compWidth * 1.6, "easeOut");
      k("x", len, base.x, "linear");
      break;
    case "slideInUp":
      k("y", 0, compHeight * 1.5, "easeOut");
      k("y", len, base.y, "linear");
      break;
    case "dropIn":
      k("y", 0, -compHeight * 0.5, "bounce");
      k("y", len * 1.6, base.y, "linear");
      break;
    case "pulse":
      for (let t = 0, i = 0; t <= d; t += 0.4, i++) k("scale", t, base.scale * (i % 2 ? 1.12 : 1), "easeInOut");
      break;
    case "wiggle":
      for (let t = 0, i = 0; t <= d; t += 0.15, i++) k("rotation", t, base.rotation + (i % 2 ? 8 : -8), "easeInOut");
      k("rotation", d, base.rotation, "linear");
      break;
    case "fadeOut":
      k("opacity", Math.max(0, d - len), valueAt(layer, "opacity", d - len), "easeIn");
      k("opacity", d, 0, "linear");
      break;
    case "shrinkOut":
      k("scale", Math.max(0, d - len), valueAt(layer, "scale", d - len), "easeIn");
      k("scale", d, 0, "linear");
      break;
  }
}
