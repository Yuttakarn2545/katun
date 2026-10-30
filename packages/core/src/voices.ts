import type { Voice } from "./schema.js";

// รายชื่อเสียงที่โปรแกรม/MCP แนะนำ (Azure มีเสียงอื่นอีกมาก ใส่ชื่อเองได้)

export type VoiceOption = { provider: Voice["provider"]; voice: string; label: string; lang: string };

export const VOICES: VoiceOption[] = [
  { provider: "azure", voice: "th-TH-PremwadeeNeural", label: "เปรมวดี (หญิง)", lang: "th" },
  { provider: "azure", voice: "th-TH-AcharaNeural", label: "อัจฉรา (หญิง)", lang: "th" },
  { provider: "azure", voice: "th-TH-NiwatNeural", label: "นิวัฒน์ (ชาย)", lang: "th" },
  { provider: "azure", voice: "en-US-JennyNeural", label: "Jenny (female)", lang: "en" },
  { provider: "azure", voice: "en-US-GuyNeural", label: "Guy (male)", lang: "en" },
  { provider: "system", voice: "Microsoft Zira Desktop", label: "Zira ในเครื่อง (อังกฤษ, ทดสอบ)", lang: "en" },
  { provider: "system", voice: "Microsoft David Desktop", label: "David ในเครื่อง (อังกฤษ, ทดสอบ)", lang: "en" },
];
