import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ROOT } from "./pipeline.js";

// Disk mailbox shared by independent app and MCP processes on this machine.
const BASE = join(ROOT, ".cache", "app-bridge");
const Id = z.string().uuid();
export const AppSessionSchema = z.object({
  id: Id,
  page: z.enum(["home", "edit", "settings"]),
  project: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).optional(),
  frame: z.number().int().nonnegative().default(0),
  playing: z.boolean().default(false),
  focused: z.boolean().default(false),
  save: z.enum(["saved", "pending", "saving", "error"]).default("saved"),
});
export type AppSession = z.infer<typeof AppSessionSchema> & { url: string; lastSeen: number };
export const AppCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), project: z.string() }),
  z.object({ action: z.literal("play") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("seek"), seconds: z.number().min(0).max(86400) }),
]);
export type AppCommand = z.infer<typeof AppCommandSchema> & { id: string; sessionId: string; createdAt: number };

function file(group: string, id: string) {
  Id.parse(id);
  return join(BASE, group, `${id}.json`);
}
function write(group: string, id: string, value: unknown) {
  mkdirSync(join(BASE, group), { recursive: true });
  const target = file(group, id);
  const temp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, target);
}
function read<T>(group: string, id: string): T | undefined {
  const path = file(group, id);
  if (!existsSync(path)) return;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function listAppSessions(): AppSession[] {
  if (!existsSync(join(BASE, "sessions"))) return [];
  return readdirSync(join(BASE, "sessions")).filter((f) => /^[a-f0-9-]{36}\.json$/i.test(f)).flatMap((f) => {
    try {
      const session = read<AppSession>("sessions", f.slice(0, -5));
      return session && Date.now() - session.lastSeen < 15000 ? [session] : [];
    } catch { return []; }
  }).sort((a, b) => b.lastSeen - a.lastSeen);
}
export function syncAppSession(input: unknown, url: string) {
  const session = AppSessionSchema.parse(input);
  write("sessions", session.id, { ...session, url, lastSeen: Date.now() });
  const dir = join(BASE, "commands");
  const commands: AppCommand[] = [];
  if (existsSync(dir)) for (const name of readdirSync(dir).filter((f) => /^[a-f0-9-]{36}\.json$/i.test(f))) {
    const command = read<AppCommand>("commands", name.slice(0, -5));
    if (command?.sessionId === session.id && Date.now() - command.createdAt < 30000 && !read("acks", command.id)) commands.push(command);
  }
  return commands.sort((a, b) => a.createdAt - b.createdAt);
}
export function queueAppCommand(input: z.infer<typeof AppCommandSchema>, sessionId?: string) {
  const sessions = listAppSessions();
  const focused = sessions.filter((s) => s.focused);
  const session = sessionId ? sessions.find((s) => s.id === Id.parse(sessionId)) : sessions.length === 1 ? sessions[0] : focused.length === 1 ? focused[0] : undefined;
  if (!session) throw new Error(sessions.length ? "มีหลายหน้าต่าง ระบุ session_id จาก get_app_state" : "ยังไม่พบหน้าต่าง Katun ที่รองรับ live MCP เปิดหรือรีเฟรชโปรแกรมก่อน");
  const command: AppCommand = { ...AppCommandSchema.parse(input), id: randomUUID(), sessionId: session.id, createdAt: Date.now() };
  write("commands", command.id, command);
  return { command_id: command.id, session_id: session.id, status: "queued", url: session.url };
}
export function acknowledgeAppCommand(sessionId: string, commandId: string, error?: string) {
  const command = read<AppCommand>("commands", commandId);
  if (!command || command.sessionId !== Id.parse(sessionId)) throw new Error("ไม่พบคำสั่งของหน้าต่างนี้");
  write("acks", commandId, { status: error ? "failed" : "done", error, completedAt: Date.now() });
}
export function appCommandStatus(id: string) {
  const command = read<AppCommand>("commands", id);
  if (!command) throw new Error("ไม่พบคำสั่ง");
  return read("acks", id) ?? { status: Date.now() - command.createdAt >= 30000 ? "expired" : "queued" };
}
