import { applyPreset, removeKeyframe, setKeyframe, valueAt, type AnimPreset } from "../../../../core/src/anim";
import { blankComponent } from "../../../../core/src/componentTemplates";
import { LayerSchema, newId, type AnimProp, type Component, type Layer, type Placement, type Project } from "../../../../core/src/schema";
import { api } from "./api";
import { computeLayout, useEditor } from "./store";

// คำสั่งของระบบคอมโพเนนต์ (ทุกคำสั่ง Undo ได้)

const st = () => useEditor.getState();
const update = (fn: (p: Project) => void, coalesce?: string) => st().update(fn, coalesce);

export const comp = (id: string): Component | undefined => st().project?.components[id];

/** เวลาภายในเลเยอร์ตามเส้นเวลาของคอมโพเนนต์ */
export function layerTime(layer: Pick<Layer, "start">): number {
  const fps = st().project?.fps ?? 30;
  return st().compFrame / fps - layer.start;
}

function uniqueId(p: Project, base: string): string {
  let id = base;
  for (let n = 2; p.components[id]; n++) id = `${base}-${n}`;
  return id;
}

// ---------- คอมโพเนนต์ ----------

export function createComponent(c: Component, id = newId("c")): string {
  const final = uniqueId(st().project!, id);
  update((p) => {
    p.components[final] = c;
  });
  return final;
}

const videoWidth = (p: Project) => (p.format === "16:9" ? 1920 : 1080);

export function addBlankComponent(): string {
  const p = st().project!;
  const video = p.format === "9:16" ? [1080, 1920] : p.format === "1:1" ? [1080, 1080] : [1920, 1080];
  const id = newId("c");
  update((d) => {
    d.components[id] = blankComponent(`คอมโพเนนต์ ${Object.keys(d.components).length + 1}`, video[0], video[1]);
  });
  return id;
}

export async function addTemplateComponent(template: string): Promise<string> {
  const { component } = await api<{ component: Component }>(`/api/projects/${st().name}/component-template`, { method: "POST", body: { template } });
  const id = newId("c");
  update((p) => {
    p.components[id] = component;
  });
  return id;
}

export function duplicateComponent(id: string): string {
  const copy = newId("c");
  update((p) => {
    const c = structuredClone(p.components[id]);
    c.name = `${c.name} (สำเนา)`;
    c.layers = c.layers.map((l) => ({ ...l, id: newId("ly") }));
    p.components[copy] = c;
  });
  return copy;
}

export function deleteComponent(id: string): void {
  const p = st().project!;
  const nested = Object.entries(p.components).filter(([, c]) => c.layers.some((l) => l.type === "component" && l.component === id));
  if (nested.length) throw new Error(`ซ้อนอยู่ใน “${nested.map(([, c]) => c.name).join(", ")}” ลบเลเยอร์นั้นก่อน`);
  update((d) => {
    delete d.components[id];
    d.placements = d.placements.filter((pl) => pl.component !== id);
  });
  if (st().editing === id) st().setEditing(null);
  else st().select({ kind: "project" });
}

export function patchComponent(id: string, patch: Partial<Pick<Component, "name" | "width" | "height" | "duration">>, coalesce?: string): void {
  update((p) => Object.assign(p.components[id], patch), coalesce && `${coalesce}:${id}`);
}

// ---------- การวางในเรื่องหลัก ----------

function sceneAt(p: Project, time: number) {
  const lay = computeLayout(p, st().timeline);
  const s = lay.scenes.find((x) => time < x.start + x.duration) ?? lay.scenes[lay.scenes.length - 1];
  return { id: s.id, offset: Math.max(0, time - s.start) };
}

export function placeComponent(component: string, time?: number): string {
  const p = st().project!;
  const t = time ?? st().frame / p.fps;
  const id = newId("pl");
  update((d) => {
    const at = sceneAt(d, t);
    // ขนาดเริ่มต้น = ขนาดจริงของคอมโพเนนต์ (ไม่เกินความกว้างจอ)
    const scale = Math.min(1, d.components[component].width / videoWidth(d));
    d.placements.push({ id, component, sceneId: at.id, offset: at.offset, x: 0.5, y: 0.5, scale, opacity: 1, volume: 1, loop: false });
  });
  st().select({ kind: "placement", id });
  return id;
}

/** ย้ายการวางไปเริ่มที่เวลา time (หาฉากใหม่ให้เอง) */
export function movePlacement(id: string, time: number): void {
  update((p) => {
    const pl = p.placements.find((x) => x.id === id);
    if (!pl) return;
    const at = sceneAt(p, Math.max(0, time));
    pl.sceneId = at.id;
    pl.offset = at.offset;
  });
}

export function patchPlacement(id: string, patch: Partial<Placement>, coalesce?: string): void {
  update((p) => {
    const pl = p.placements.find((x) => x.id === id);
    if (pl) Object.assign(pl, patch);
  }, coalesce && `${coalesce}:${id}`);
}

export function removePlacement(id: string): void {
  update((p) => {
    p.placements = p.placements.filter((x) => x.id !== id);
  });
  st().select({ kind: "project" });
}

// ---------- เลเยอร์ ----------

const findLayer = (p: Project, compId: string, layerId: string) => p.components[compId]?.layers.find((l) => l.id === layerId);

export const LAYER_TYPES = {
  text: "ข้อความ",
  shape: "รูปทรง",
  image: "รูปภาพ",
  character: "ตัวละคร",
  audio: "เสียง",
  component: "คอมโพเนนต์ซ้อน",
} as const;

/** เพิ่มเลเยอร์กลางคอมโพเนนต์ ยาวเท่าคอมโพเนนต์ */
export function addLayer(compId: string, init: Record<string, unknown> & { type: Layer["type"] }): string {
  const c = comp(compId)!;
  const layer = LayerSchema.parse({ x: c.width / 2, y: c.height / 2, duration: c.duration, name: LAYER_TYPES[init.type], ...init });
  update((p) => {
    p.components[compId].layers.push(layer);
  });
  st().select({ kind: "layer", component: compId, id: layer.id });
  return layer.id;
}

export function patchLayer(compId: string, layerId: string, patch: Record<string, unknown>, coalesce?: string): void {
  update((p) => {
    const l = findLayer(p, compId, layerId);
    if (l) Object.assign(l, patch);
  }, coalesce && `${coalesce}:${layerId}`);
}

export function removeLayer(compId: string, layerId: string): void {
  update((p) => {
    p.components[compId].layers = p.components[compId].layers.filter((l) => l.id !== layerId);
  });
  st().select({ kind: "component", id: compId });
}

export function duplicateLayer(compId: string, layerId: string): void {
  const id = newId("ly");
  update((p) => {
    const layers = p.components[compId].layers;
    const i = layers.findIndex((l) => l.id === layerId);
    layers.splice(i + 1, 0, { ...structuredClone(layers[i]), id, name: `${layers[i].name} (สำเนา)` });
  });
  st().select({ kind: "layer", component: compId, id });
}

/** เลื่อนลำดับชั้น: +1 = ขึ้นบน, -1 = ลงล่าง */
export function moveLayerOrder(compId: string, layerId: string, delta: 1 | -1): void {
  update((p) => {
    const layers = p.components[compId].layers;
    const i = layers.findIndex((l) => l.id === layerId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= layers.length) return;
    [layers[i], layers[j]] = [layers[j], layers[i]];
  });
}

/**
 * ตั้งค่าคุณสมบัติที่เคลื่อนไหวได้ แบบเดียวกับ After Effects:
 * ถ้า prop นั้นมีคีย์เฟรมอยู่แล้ว จะใส่/แก้คีย์ที่เวลาปัจจุบัน ไม่อย่างนั้นแก้ค่าคงที่
 */
export function setAnimValue(compId: string, layerId: string, prop: AnimProp, v: number, coalesce?: string): void {
  setAnimValues(compId, layerId, { [prop]: v }, coalesce && `${coalesce}:${prop}`);
}

/** ตั้งหลายค่าพร้อมกันเป็น Undo ขั้นเดียว (เช่น x และ y ตอนลากบนจอ) */
export function setAnimValues(compId: string, layerId: string, values: Partial<Record<AnimProp, number>>, coalesce?: string): void {
  update((p) => {
    const l = findLayer(p, compId, layerId);
    if (!l) return;
    for (const [prop, v] of Object.entries(values) as [AnimProp, number][]) {
      if (l.keyframes[prop]?.length) setKeyframe(l, prop, Math.max(0, layerTime(l)), v);
      else l[prop] = v;
    }
  }, coalesce && `${coalesce}:${layerId}`);
}

/** ปุ่ม ◆: มีคีย์ที่เวลาปัจจุบัน = ลบ, ไม่มี = เพิ่มคีย์ด้วยค่าปัจจุบัน */
export function toggleKeyframe(compId: string, layerId: string, prop: AnimProp): void {
  update((p) => {
    const l = findLayer(p, compId, layerId);
    if (!l) return;
    const t = Math.max(0, layerTime(l));
    if (hasKeyAt(l, prop, t)) removeKeyframe(l, prop, t);
    else setKeyframe(l, prop, t, valueAt(l, prop, t));
  });
}

export const hasKeyAt = (l: Layer, prop: AnimProp, t: number) => !!l.keyframes[prop]?.some((k) => Math.abs(k.t - t) < 1 / 60);

export function clearKeyframes(compId: string, layerId: string, prop?: AnimProp): void {
  update((p) => {
    const l = findLayer(p, compId, layerId);
    if (!l) return;
    if (prop) {
      // ล้างคีย์แล้วคงค่า ณ เวลาปัจจุบันไว้เป็นค่าคงที่
      l[prop] = valueAt(l, prop, Math.max(0, layerTime(l)));
      delete l.keyframes[prop];
    } else l.keyframes = {};
  });
}

export function applyAnimation(compId: string, layerId: string, preset: AnimPreset): void {
  update((p) => {
    const c = p.components[compId];
    const l = findLayer(p, compId, layerId);
    if (l) applyPreset(l, preset, c.width, c.height);
  });
}

export async function addSfxLayer(compId: string, sfx: string, name: string, start = 0): Promise<void> {
  const { path } = await api<{ path: string }>(`/api/projects/${st().name}/sfx`, { method: "POST", body: { id: sfx } });
  const c = comp(compId)!;
  addLayer(compId, { type: "audio", src: path, name, start: Math.min(start, Math.max(0, c.duration - 0.2)), duration: Math.min(2, c.duration) });
}

/** SFX ลงเรื่องหลักตรงเส้นเวลา: ใช้คอมโพเนนต์เสียงอย่างเดียว (สร้างครั้งแรก ใช้ซ้ำครั้งต่อไป) */
export async function placeSfx(sfx: string, name: string): Promise<void> {
  const { path } = await api<{ path: string }>(`/api/projects/${st().name}/sfx`, { method: "POST", body: { id: sfx } });
  const p = st().project!;
  let id = Object.keys(p.components).find((k) => p.components[k].name === `SFX ${name}`);
  if (!id) {
    const c = blankComponent(`SFX ${name}`, 200, 200);
    c.duration = 1.5;
    c.layers.push(LayerSchema.parse({ type: "audio", name, src: path, duration: 1.5 }));
    id = createComponent(c, `sfx-${sfx}`);
  }
  placeComponent(id);
}
