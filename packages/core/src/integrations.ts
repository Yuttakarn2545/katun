import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findRhubarb } from "./lipsync.js";
import { ROOT } from "./pipeline.js";

// เชื่อม MCP กับแอป AI, ตั้งค่า .env และตรวจความพร้อมของเครื่อง

export const KATUN_BIN = join(ROOT, "bin", "katun.js");
export const MCP_ENTRY = { command: process.execPath, args: [KATUN_BIN, "mcp"] };

// ---------- Claude Desktop ----------

export function claudeDesktopConfigPaths(): string[] {
  if (process.platform === "darwin") {
    return [join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")];
  }
  if (process.platform !== "win32") return [];
  const paths = [join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")];
  // เวอร์ชันจาก Microsoft Store เก็บ config ไว้ในโฟลเดอร์ Packages
  const pkgs = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Packages");
  if (existsSync(pkgs)) {
    for (const d of readdirSync(pkgs).filter((n) => n.startsWith("Claude_"))) {
      paths.push(join(pkgs, d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"));
    }
  }
  return paths;
}

type DesktopConfig = { mcpServers?: Record<string, { command: string; args?: string[] }>; [k: string]: unknown };

function readJson(path: string): DesktopConfig {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").replace(/^﻿/, "").trim();
  return text ? (JSON.parse(text) as DesktopConfig) : {};
}

export type ClaudeDesktopStatus = { installed: boolean; configPath?: string; connected: boolean };

export function claudeDesktopStatus(): ClaudeDesktopStatus {
  const paths = claudeDesktopConfigPaths();
  // ถือว่าติดตั้ง Claude Desktop ถ้ามีโฟลเดอร์ของแอปอยู่
  const found = paths.find((p) => existsSync(dirname(p)));
  if (!found) return { installed: false, connected: false };
  try {
    const entry = readJson(found).mcpServers?.katun;
    return { installed: true, configPath: found, connected: !!entry && entry.args?.includes(KATUN_BIN) === true };
  } catch {
    return { installed: true, configPath: found, connected: false };
  }
}

/** เพิ่ม katun ลง claude_desktop_config.json โดยคงค่าอื่นไว้ และสำรองไฟล์เดิมเป็น .bak ก่อนเขียน */
export function connectClaudeDesktop(): string {
  const status = claudeDesktopStatus();
  const path = status.configPath ?? claudeDesktopConfigPaths()[0];
  if (!path) throw new Error("ระบบปฏิบัติการนี้ไม่มี Claude Desktop");
  let config: DesktopConfig;
  try {
    config = readJson(path);
  } catch {
    throw new Error(`อ่าน ${path} ไม่ได้ (JSON ไม่ถูกต้อง) กรุณาแก้ไฟล์ก่อน`);
  }
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  config.mcpServers = { ...config.mcpServers, katun: MCP_ENTRY };
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return path;
}

export function disconnectClaudeDesktop(): void {
  const { configPath } = claudeDesktopStatus();
  if (!configPath || !existsSync(configPath)) return;
  const config = readJson(configPath);
  if (!config.mcpServers?.katun) return;
  copyFileSync(configPath, `${configPath}.bak`);
  delete config.mcpServers.katun;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

// ---------- Claude Code ----------

function runClaude(args: string[]): { ok: boolean; out: string } {
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  // บน Windows คำสั่ง claude เป็น .cmd จึงต้องรันผ่าน shell
  const res = spawnSync("claude", quoted, { shell: true, encoding: "utf8", timeout: 30000 });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
}

export const CLAUDE_CODE_COMMAND = `claude mcp add --scope user katun -- node "${KATUN_BIN}" mcp`;

export function claudeCodeStatus(): { installed: boolean; connected: boolean } {
  const version = runClaude(["--version"]);
  if (!version.ok) return { installed: false, connected: false };
  return { installed: true, connected: runClaude(["mcp", "get", "katun"]).ok };
}

export function connectClaudeCode(): string {
  if (runClaude(["mcp", "get", "katun"]).ok) runClaude(["mcp", "remove", "katun", "--scope", "user"]);
  const res = runClaude(["mcp", "add", "--scope", "user", "katun", "--", "node", KATUN_BIN, "mcp"]);
  if (!res.ok) throw new Error(`เพิ่มใน Claude Code ไม่สำเร็จ: ${res.out}`);
  return res.out;
}

// ---------- การตั้งค่า (.env) ----------

const ENV_FILE = join(ROOT, ".env");
const SETTING_KEYS = ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "RHUBARB_PATH", "ANTHROPIC_API_KEY"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export function loadEnv(): void {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

export function getSettings() {
  const key = process.env.AZURE_SPEECH_KEY ?? "";
  return {
    azureKeySet: key.length > 0,
    azureKeyHint: key ? `••••${key.slice(-4)}` : "",
    azureRegion: process.env.AZURE_SPEECH_REGION ?? "southeastasia",
    anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyHint: process.env.ANTHROPIC_API_KEY ? `••••${process.env.ANTHROPIC_API_KEY.slice(-4)}` : "",
    rhubarbPath: process.env.RHUBARB_PATH ?? "",
  };
}

/** เขียนค่าลง .env โดยคงบรรทัดอื่นไว้ ค่าว่าง = ลบ; อัปเดต process.env ทันทีโดยไม่ต้องรีสตาร์ต */
export function updateSettings(values: Partial<Record<SettingKey, string>>): void {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  for (const key of SETTING_KEYS) {
    if (!(key in values)) continue;
    const value = (values[key] ?? "").trim();
    if (/[\r\n]/.test(value)) throw new Error(`${key} มีขึ้นบรรทัดใหม่ไม่ได้`);
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (value) {
      if (i >= 0) lines[i] = `${key}=${value}`;
      else lines.push(`${key}=${value}`);
      process.env[key] = value;
    } else {
      if (i >= 0) lines.splice(i, 1);
      delete process.env[key];
    }
  }
  writeFileSync(ENV_FILE, lines.filter((l, i, a) => l || i < a.length - 1).join("\n") + "\n");
}

// ---------- ตรวจความพร้อม ----------

export type Check = { name: string; ok: boolean; detail: string; optional?: boolean };

export function doctor(): Check[] {
  const major = Number(process.versions.node.split(".")[0]);
  const rhubarb = findRhubarb(ROOT);
  const remotion = existsSync(join(ROOT, "node_modules", "@remotion", "cli"));
  const browser = existsSync(join(ROOT, "node_modules", ".remotion"));
  const settings = getSettings();
  const desktop = claudeDesktopStatus();
  return [
    { name: "Node.js", ok: major >= 20, detail: `v${process.versions.node}${major >= 20 ? "" : " (ต้องการ 20 ขึ้นไป)"}` },
    { name: "ไลบรารี (npm install)", ok: remotion, detail: remotion ? "ครบ" : "ยังไม่ได้ติดตั้ง ให้รัน install.cmd" },
    {
      name: "Katun MCP server (stdio)",
      ok: existsSync(KATUN_BIN) && existsSync(join(ROOT, "node_modules", "@modelcontextprotocol", "sdk")),
      detail: "ตรวจไฟล์ติดตั้งเท่านั้น ทดสอบการตอบสนองจริงได้ที่หน้าเชื่อมต่อ MCP โดยไม่ต้องใช้ Claude API key",
    },
    { name: "ตัวเรนเดอร์ (Chrome Headless)", ok: browser, detail: browser ? "พร้อม" : "จะดาวน์โหลดอัตโนมัติตอนเรนเดอร์ครั้งแรก", optional: true },
    {
      name: "เสียงไทย (Azure TTS)",
      ok: settings.azureKeySet,
      detail: settings.azureKeySet ? `ตั้งค่าแล้ว (${settings.azureRegion})` : "ยังไม่ได้ใส่ key ใช้ได้เฉพาะเสียงในเครื่องและไฟล์อัดเอง",
      optional: true,
    },
    { name: "Rhubarb (ปากขยับแม่นยำ)", ok: !!rhubarb, detail: rhubarb ?? "ไม่มี ใช้ปากขยับตามความดังเสียงแทน", optional: true },
    {
      name: "AI ช่วย (Claude API)",
      ok: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      detail: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "ตั้งค่าแล้ว" : "ยังไม่ได้ใส่ Claude API key ปุ่ม AI ช่วยในโปรแกรมจะยังใช้ไม่ได้",
      optional: true,
    },
    {
      name: "Claude Desktop (MCP)",
      ok: desktop.connected,
      detail: !desktop.installed ? "ไม่พบ Claude Desktop (ไม่กระทบ MCP server)" : desktop.connected ? "ตั้งค่าแล้ว เปิด Claude Desktop เพื่อตรวจการเชื่อมต่อ" : "ยังไม่ได้ตั้งค่าใน Claude Desktop (ไม่กระทบ MCP server)",
      optional: true,
    },
  ];
}

/** รันสคริปต์ติดตั้ง Rhubarb (ดาวน์โหลดจาก GitHub release) */
export function installRhubarb(): string {
  if (process.platform !== "win32") throw new Error("สคริปต์ติดตั้งรองรับเฉพาะ Windows");
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "setup-rhubarb.ps1")],
    { encoding: "utf8", timeout: 300000 },
  );
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  if (res.status !== 0) throw new Error(`ติดตั้ง Rhubarb ไม่สำเร็จ: ${out}`);
  return out;
}
