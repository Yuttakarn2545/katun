import type { Project, Timeline } from "../../../../core/src/schema";

// เรียก API ของ server ในเครื่อง ทุกคำสั่งที่แก้ข้อมูลต้องมี header X-Katun (กันเว็บอื่นยิงมาสั่งงาน)

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Katun": "1" };
  if (opts.body !== undefined && !opts.raw) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `ผิดพลาด (${res.status})`);
  return data;
}

export type ProjectSummary = {
  project: string;
  title: string;
  format?: "16:9" | "9:16" | "1:1";
  valid: boolean;
  prepared: boolean;
  durationSeconds?: number;
  createdAt?: string;
  updatedAt?: string;
  thumbnailUrl?: string;
  exported: boolean;
  firstBackground?: string;
  colors?: string[];
};

export type TemplateInfo = { id: string; name: string; description: string; format: "16:9" | "9:16" | "1:1" };
export type TrashItem = { id: string; project: string; title: string; deletedAt: string };
export type VoiceOption = { provider: "azure" | "system"; voice: string; label: string; lang: string };

export type ProjectResponse = {
  project: Project;
  timeline?: Timeline;
  assetBase: string;
  videoUrl?: string;
  previewUrl?: string;
  srtUrl?: string;
};

export type JobView = {
  job_id: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  rendered?: number;
  total?: number;
  elapsedSeconds: number;
  output?: string;
  error?: string;
  url?: string;
  stage?: "render" | "loudness";
  loudness?: { before: number; after: number; target: number };
};

const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, s] of units) if (Math.abs(diff) >= s) return rtf.format(Math.round(diff / s), unit);
  return "เมื่อสักครู่";
}

export const fmtTime = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
