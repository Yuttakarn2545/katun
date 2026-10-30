import type { z } from "zod";
import { applyPreset, type AnimPreset } from "./anim.js";
import { ComponentSchema, LayerSchema, type Component, type Layer } from "./schema.js";
import type { SfxId } from "./sfx.js";

// คอมโพเนนต์สำเร็จรูป: เริ่มจากตรงนี้แล้วแก้ต่อได้ทุกเลเยอร์

type LayerInput = z.input<typeof LayerSchema>;

export type ComponentTemplate = { id: string; name: string; description: string; build: (sfx: (id: SfxId) => string) => Component };

function make(base: { name: string; width?: number; height?: number; duration: number }, layers: [LayerInput, AnimPreset[]][]): Component {
  const comp = ComponentSchema.parse({ ...base, layers: [] });
  for (const [input, presets] of layers) {
    const layer: Layer = LayerSchema.parse({ duration: comp.duration, ...input });
    for (const p of presets) applyPreset(layer, p, comp.width, comp.height);
    comp.layers.push(layer);
  }
  return comp;
}

export const COMPONENT_TEMPLATES: ComponentTemplate[] = [
  {
    id: "title-pop",
    name: "ชื่อเรื่องเด้ง",
    description: "กล่องชื่อเรื่องเด้งเข้ากลางจอ พร้อมเสียงป๊อป",
    build: (sfx) =>
      make({ name: "ชื่อเรื่องเด้ง", duration: 3 }, [
        [{ type: "shape", name: "กล่อง", shape: "rect", x: 960, y: 540, w: 1300, h: 280, fill: "#ffd166", radius: 60, strokeColor: "#2b2d42", strokeWidth: 10 }, ["popIn", "shrinkOut"]],
        [{ type: "text", name: "ชื่อเรื่อง", text: "ชื่อเรื่องของคุณ", x: 960, y: 540, size: 130, color: "#2b2d42", start: 0.1, duration: 2.9 }, ["popIn", "shrinkOut"]],
        [{ type: "audio", name: "เสียงป๊อป", src: sfx("pop"), duration: 0.3 }, []],
      ]),
  },
  {
    id: "lower-third",
    name: "ป้ายชื่อ",
    description: "ป้ายชื่อมุมล่างซ้าย เลื่อนเข้ามาพร้อมเสียงวูบ",
    build: (sfx) =>
      make({ name: "ป้ายชื่อ", duration: 4 }, [
        [{ type: "shape", name: "แถบ", shape: "rect", x: 520, y: 880, w: 820, h: 170, fill: "#22d3c5", radius: 20 }, ["slideInLeft", "fadeOut"]],
        [{ type: "text", name: "ชื่อ", text: "ชื่อ นามสกุล", x: 520, y: 855, size: 64, color: "#062a27", start: 0.15, duration: 3.85 }, ["slideInLeft", "fadeOut"]],
        [{ type: "text", name: "ตำแหน่ง", text: "ตำแหน่ง / คำอธิบาย", x: 520, y: 920, size: 36, weight: 400, color: "#0b3d39", start: 0.25, duration: 3.75 }, ["slideInLeft", "fadeOut"]],
        [{ type: "audio", name: "เสียงวูบ", src: sfx("whoosh"), duration: 0.8 }, []],
      ]),
  },
  {
    id: "speech-bubble",
    name: "ฟองคำพูด",
    description: "ฟองคำพูดการ์ตูน วางเหนือตัวละคร",
    build: (sfx) =>
      make({ name: "ฟองคำพูด", width: 900, height: 520, duration: 3 }, [
        [{ type: "shape", name: "ฟอง", shape: "bubble", x: 450, y: 250, w: 820, h: 420, fill: "#ffffff", strokeColor: "#2b2d42", strokeWidth: 8 }, ["popIn", "fadeOut"]],
        [{ type: "text", name: "คำพูด", text: "สวัสดี!", x: 450, y: 220, size: 90, color: "#2b2d42", maxWidth: 700 }, ["popIn", "fadeOut"]],
        [{ type: "audio", name: "เสียงป๊อป", src: sfx("pop"), duration: 0.3 }, []],
      ]),
  },
  {
    id: "star-sticker",
    name: "สติกเกอร์ดาว",
    description: "ดาวเด้งส่ายไปมา พร้อมเสียงวิ้ง",
    build: (sfx) =>
      make({ name: "สติกเกอร์ดาว", width: 400, height: 400, duration: 2 }, [
        [{ type: "shape", name: "ดาว", shape: "star", x: 200, y: 200, w: 340, h: 340, fill: "#ffd166", strokeColor: "#e09f3e", strokeWidth: 10 }, ["popIn", "wiggle"]],
        [{ type: "audio", name: "เสียงวิ้ง", src: sfx("sparkle"), duration: 1 }, []],
      ]),
  },
  {
    id: "correct",
    name: "ถูกต้อง!",
    description: "ป้ายถูกต้องสีเขียว พร้อมเสียงติ๊ง",
    build: (sfx) =>
      make({ name: "ถูกต้อง", width: 900, height: 360, duration: 2 }, [
        [{ type: "shape", name: "ป้าย", shape: "rect", x: 450, y: 180, w: 800, h: 260, fill: "#4ade80", radius: 130, strokeColor: "#14532d", strokeWidth: 10 }, ["popIn", "fadeOut"]],
        [{ type: "text", name: "ข้อความ", text: "✔ ถูกต้อง!", x: 450, y: 180, size: 110, color: "#14532d" }, ["popIn", "fadeOut"]],
        [{ type: "audio", name: "เสียงติ๊ง", src: sfx("ding"), duration: 1.2 }, []],
      ]),
  },
  {
    id: "subscribe",
    name: "ปุ่มกดติดตาม",
    description: "ปุ่มแดงเต้นเป็นจังหวะ พร้อมเสียงคลิก",
    build: (sfx) =>
      make({ name: "ปุ่มกดติดตาม", width: 900, height: 300, duration: 4 }, [
        [{ type: "shape", name: "ปุ่ม", shape: "rect", x: 450, y: 150, w: 760, h: 200, fill: "#e63946", radius: 100 }, ["popIn", "pulse", "fadeOut"]],
        [{ type: "text", name: "ข้อความ", text: "กดติดตาม", x: 450, y: 150, size: 96, color: "#ffffff" }, ["popIn", "pulse", "fadeOut"]],
        [{ type: "audio", name: "เสียงคลิก", src: sfx("click"), start: 1.2, duration: 0.2 }, []],
      ]),
  },
  {
    id: "countdown",
    name: "นับถอยหลัง 3-2-1",
    description: "ตัวเลขใหญ่กลางจอทีละวินาที พร้อมเสียง",
    build: (sfx) =>
      make({ name: "นับถอยหลัง", width: 600, height: 600, duration: 3 }, [
        ...(["3", "2", "1"] as const).flatMap((n, i): [LayerInput, AnimPreset[]][] => [
          [{ type: "text", name: n, text: n, x: 300, y: 300, size: 420, color: "#ffffff", strokeColor: "#2b2d42", strokeWidth: 16, start: i, duration: 1 }, ["popIn", "fadeOut"]],
          [{ type: "audio", name: `เสียง ${n}`, src: sfx(i === 2 ? "ding" : "click"), start: i, duration: 0.6 }, []],
        ]),
      ]),
  },
];

export function blankComponent(name = "คอมโพเนนต์ใหม่", width = 1920, height = 1080): Component {
  return ComponentSchema.parse({ name, width, height, duration: 3, layers: [] });
}
