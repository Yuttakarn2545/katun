import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { loadProject } from "./pipeline.js";
import { createProjectName, PROJECTS, ProjectName, projectDir, requireProject, validateProject } from "./projects.js";

// ไฟล์โปรเจกต์ .katun = zip ที่รวม project.json และสื่อทั้งหมด (เสียงอัด รูป เพลง SFX)
// ไม่รวม build/ และ out/ ซึ่งสร้างใหม่ได้ ย้ายเครื่องหรือส่งให้คนอื่นแก้ต่อได้ทันที

const MANIFEST = "katun.json";
const MAX_ENTRIES = 5000;
const MAX_TOTAL = 2 * 1024 ** 3; // 2 GB หลังแตกไฟล์

// ---------- zip (deflate) ----------

type Entry = { name: string; data: Buffer };

export function writeZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const comp = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // ชื่อไฟล์เป็น UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // เวลา/วันที่ (ไม่ใช้)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** path ในไฟล์ zip ต้องเป็น path ย่อยแบบปลอดภัย (กัน ../ , path เต็ม, ไดรฟ์) */
function safeName(name: string): string {
  const n = name.replace(/\\/g, "/");
  if (!n || n.startsWith("/") || /^[a-zA-Z]:/.test(n) || n.split("/").some((p) => p === ".." || p === "")) {
    throw new Error(`ไฟล์ในแพ็กเกจมี path ไม่ปลอดภัย: ${name}`);
  }
  return n;
}

export function readZip(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ไม่ใช่ไฟล์ .katun (zip) ที่ถูกต้อง");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error("ไฟล์ในแพ็กเกจมากเกินไป");
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("โครงสร้าง zip เสียหาย");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const rawName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (rawName.endsWith("/")) continue; // โฟลเดอร์
    const name = safeName(rawName);
    total += size;
    if (total > MAX_TOTAL) throw new Error("แพ็กเกจใหญ่เกินไป");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const comp = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(comp) : method === 8 ? inflateRawSync(comp) : null;
    if (!data) throw new Error(`ไม่รองรับการบีบอัดแบบ ${method} (${name})`);
    if (data.length !== size || crc32(data) !== crc) {
      throw new Error(`ไฟล์ ${name} ในแพ็กเกจเสียหาย`);
    }
    out.push({ name, data });
  }
  return out;
}

// ---------- ส่งออก / นำเข้าโปรเจกต์ ----------

function walk(dir: string, base: string, acc: string[]): void {
  for (const f of readdirSync(dir)) {
    const abs = join(dir, f);
    const rel = relative(base, abs).split(sep).join("/");
    if (/^(build|out)(\/|$)/.test(rel) || /\.backup\.json$/.test(rel) || rel === MANIFEST) continue;
    if (statSync(abs).isDirectory()) walk(abs, base, acc);
    else acc.push(rel);
  }
}

export function exportBundle(name: string): Buffer {
  const dir = requireProject(name);
  const project = loadProject(dir);
  const files: string[] = [];
  walk(dir, dir, files);
  const manifest = { format: "katun", version: 1, title: project.title, project: name, exportedAt: new Date().toISOString(), files: files.length };
  return writeZip([{ name: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...files.map((f) => ({ name: f, data: readFileSync(join(dir, f)) }))]);
}

/** นำเข้าไฟล์ .katun เป็นโปรเจกต์ใหม่ (ไม่ทับของเดิม) คืนชื่อโปรเจกต์ */
export function importBundle(buf: Buffer, preferred?: string): { name: string; title: string; files: number } {
  const entries = readZip(buf);
  const manifestEntry = entries.find((e) => e.name === MANIFEST);
  if (!manifestEntry) throw new Error("ไม่ใช่ไฟล์ .katun (ไม่มี katun.json)");
  const manifest = JSON.parse(manifestEntry.data.toString("utf8")) as { format?: string; version?: number };
  if (manifest.format !== "katun") throw new Error("ไม่ใช่ไฟล์ .katun");
  if ((manifest.version ?? 1) > 1) throw new Error("ไฟล์นี้มาจาก Katun Studio รุ่นใหม่กว่า กรุณาอัปเดตโปรแกรมก่อน");
  const pj = entries.find((e) => e.name === "project.json");
  if (!pj) throw new Error("ไม่มี project.json ในแพ็กเกจ");
  const project = validateProject(JSON.parse(pj.data.toString("utf8").replace(/^﻿/, "")));

  const want = preferred && ProjectName.safeParse(preferred).success ? preferred : undefined;
  const name = want && !existsSync(join(PROJECTS, want)) ? want : createProjectName();
  const dir = projectDir(name);
  mkdirSync(dir, { recursive: true });
  for (const e of entries) {
    if (e.name === MANIFEST) continue;
    const abs = join(dir, ...e.name.split("/"));
    if (!abs.startsWith(dir + sep)) throw new Error(`path ไม่ปลอดภัย: ${e.name}`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, e.data);
  }
  return { name, title: project.title, files: entries.length - 1 };
}
