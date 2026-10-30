import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CAMERA_MOVES, EMOTIONS, GESTURES, type Project } from "./schema.js";

// AI ช่วยในโปรแกรม: เขียนบทจากหัวข้อ, ปรับ/แปลบท, แนะนำการแสดง
// เรียก Claude ผ่าน SDK ทางการ ผลลัพธ์บังคับเป็น JSON ตาม schema แล้วโปรแกรมนำไปใช้ต่อ (Undo ได้ในหน้าจอ)

const MODEL = "claude-opus-5-5";

export const BACKGROUNDS = {
  sky: "linear-gradient(#bde0fe, #e0fbfc)",
  pink: "linear-gradient(#ffe5ec, #fff1e6)",
  garden: "linear-gradient(#fdffb6, #caffbf)",
  night: "linear-gradient(#1d3557, #457b9d)",
  sunset: "linear-gradient(#ffd6a5, #ffadad)",
  purple: "linear-gradient(#a0c4ff, #bdb2ff)",
  sea: "linear-gradient(#0f2027, #2c5364)",
  classroom: "linear-gradient(#f1faee, #a8dadc)",
} as const;
const BG_KEYS = Object.keys(BACKGROUNDS) as [keyof typeof BACKGROUNDS, ...(keyof typeof BACKGROUNDS)[]];

export function aiConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

/** เรียก Claude ให้คืน JSON ตาม schema (เปิด fallback ฝั่ง server: ถ้าโมเดลหลักปฏิเสธ ให้โมเดลสำรองทำต่อ) */
async function ask<T extends z.ZodType>(schema: T, system: string, prompt: string, effort: "low" | "medium" | "high" = "medium"): Promise<z.infer<T>> {
  if (!aiConfigured()) throw new Error("ยังไม่ได้ใส่ Claude API key (หน้า ตั้งค่า & เชื่อมต่อ AI)");
  try {
    const res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude ปฏิเสธคำขอนี้ ลองปรับหัวข้อหรือถ้อยคำ");
    if (res.stop_reason === "max_tokens") throw new Error("ผลลัพธ์ยาวเกินไป ลองขอให้สั้นลง");
    if (!res.parsed_output) throw new Error("อ่านผลจาก Claude ไม่ได้ ลองอีกครั้ง");
    return res.parsed_output as z.infer<T>;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Claude API key ไม่ถูกต้อง ตรวจที่หน้า ตั้งค่า");
    if (err instanceof Anthropic.RateLimitError) throw new Error("เรียก Claude ถี่เกินไป รอสักครู่แล้วลองใหม่");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("ติดต่อ Claude ไม่ได้ ตรวจอินเทอร์เน็ต");
    if (err instanceof Anthropic.APIError) throw new Error(`Claude API ผิดพลาด (${err.status}): ${err.message}`);
    throw err;
  }
}

const SYSTEM = `คุณเป็นนักเขียนบทการ์ตูนสั้นสำหรับวิดีโอ 2D ในโปรแกรม Katun Studio
บทพูดแต่ละบรรทัดต้องสั้น พูดจบได้ใน 2–5 วินาที (ภาษาไทยประมาณ 10–30 พยางค์) เป็นภาษาพูดที่เป็นธรรมชาติ
ห้ามใส่คำบรรยายฉาก วงเล็บ หรือชื่อคนพูดในข้อความบท เพราะข้อความจะถูกอ่านออกเสียงด้วย TTS ตรง ๆ`;

// ---------- เขียนบทใหม่จากหัวข้อ ----------

const ScriptSchema = z.object({
  title: z.string(),
  characters: z.array(z.object({ id: z.string().describe("ตัวอักษรอังกฤษเล็ก ไม่มีเว้นวรรค เช่น nok"), name: z.string(), gender: z.enum(["female", "male"]) })),
  scenes: z.array(
    z.object({
      id: z.string().describe("ตัวอักษรอังกฤษเล็ก เช่น intro"),
      background: z.enum(BG_KEYS),
      lines: z.array(z.object({ character: z.string().describe("id ของตัวละคร"), text: z.string(), emotion: z.enum(EMOTIONS), gesture: z.enum(GESTURES) })),
    }),
  ),
});
export type GeneratedScript = z.infer<typeof ScriptSchema>;

const COLORS = ["#f4a261", "#8ecae6", "#90be6d", "#f28482", "#cdb4db", "#ffd166"];

export async function writeScript(input: { topic: string; seconds?: number; characters?: number; language?: string }): Promise<GeneratedScript> {
  const seconds = input.seconds ?? 30;
  return ask(
    ScriptSchema,
    SYSTEM,
    [
      `เขียนบทการ์ตูนเรื่อง: ${input.topic}`,
      `ความยาวรวมประมาณ ${seconds} วินาที (ราว ${Math.max(3, Math.round(seconds / 3.5))} บรรทัด) ตัวละคร ${input.characters ?? 2} ตัว 1–3 ฉาก`,
      `ภาษาของบท: ${input.language ?? "ไทย"}`,
      "ใส่สีหน้า (emotion) และท่าทาง (gesture) ที่เข้ากับแต่ละบรรทัด ใช้ท่าทางเฉพาะบรรทัดที่ควรมี ที่เหลือใช้ none",
    ].join("\n"),
  );
}

/** แปลงบทจาก AI เป็น project.json (ตั้งเสียงตามเพศ: เสียงไทยของ Azure ถ้ามี key ไม่มีก็ใช้เสียงในเครื่อง) */
export function scriptToProject(s: GeneratedScript, format: Project["format"]): Record<string, unknown> {
  const azure = !!process.env.AZURE_SPEECH_KEY;
  const voiceFor = (g: "female" | "male", i: number) =>
    azure
      ? { provider: "azure", voice: g === "male" ? "th-TH-NiwatNeural" : i % 2 ? "th-TH-AcharaNeural" : "th-TH-PremwadeeNeural" }
      : { provider: "system", voice: g === "male" ? "Microsoft David Desktop" : "Microsoft Zira Desktop" };
  const ids = new Set(s.characters.map((c) => c.id));
  const fallbackChar = s.characters[0]?.id ?? "a";
  return {
    title: s.title,
    format,
    voice: voiceFor("female", 0),
    characters: Object.fromEntries(s.characters.map((c, i) => [c.id, { name: c.name, color: COLORS[i % COLORS.length], voice: voiceFor(c.gender, i) }])),
    scenes: s.scenes
      .filter((sc) => sc.lines.length)
      .map((sc, i) => ({
        id: sc.id || `scene${i + 1}`,
        background: BACKGROUNDS[sc.background] ?? BACKGROUNDS.sky,
        lines: sc.lines.map((l) => ({ character: ids.has(l.character) ? l.character : fallbackChar, text: l.text.trim() || "…", emotion: l.emotion, gesture: l.gesture })),
      })),
  };
}

// ---------- ปรับ/แปลบท ----------

export const REWRITE_MODES = {
  shorter: "ทำให้สั้นและกระชับขึ้น คงความหมายเดิม",
  longer: "ขยายให้ละเอียดขึ้นเล็กน้อย แต่ยังพูดจบในบรรทัดละไม่เกิน 6 วินาที",
  funnier: "ทำให้ตลกและมีชีวิตชีวาขึ้น",
  kids: "ปรับให้เด็กเล็กฟังเข้าใจง่าย ใช้คำง่าย ๆ",
  formal: "ปรับให้สุภาพและเป็นทางการขึ้น",
  translate: "แปลเป็นภาษาเป้าหมาย",
} as const;
export type RewriteMode = keyof typeof REWRITE_MODES;

const RewriteSchema = z.object({ lines: z.array(z.object({ id: z.string(), text: z.string() })) });

export async function rewriteLines(project: Project, mode: RewriteMode, target?: string): Promise<{ id: string; text: string }[]> {
  const lines = project.scenes.flatMap((s) => s.lines.map((l) => ({ id: l.id, speaker: project.characters[l.character]?.name ?? l.character, text: l.text })));
  const out = await ask(
    RewriteSchema,
    SYSTEM,
    [
      `งาน: ${REWRITE_MODES[mode]}${mode === "translate" ? ` (ภาษาเป้าหมาย: ${target || "English"})` : ""}`,
      "คืนทุกบรรทัดตาม id เดิม ห้ามเพิ่มหรือลบบรรทัด",
      `เรื่อง: ${project.title}`,
      JSON.stringify(lines),
    ].join("\n"),
    "low",
  );
  const known = new Set(lines.map((l) => l.id));
  return out.lines.filter((l) => known.has(l.id) && l.text.trim());
}

// ---------- แนะนำการแสดง ----------

const DirectSchema = z.object({ lines: z.array(z.object({ id: z.string(), emotion: z.enum(EMOTIONS), gesture: z.enum(GESTURES), camera: z.enum(CAMERA_MOVES) })) });

export async function directLines(project: Project) {
  const lines = project.scenes.flatMap((s) => s.lines.map((l) => ({ id: l.id, scene: s.id, speaker: project.characters[l.character]?.name ?? l.character, text: l.text })));
  const out = await ask(
    DirectSchema,
    "คุณเป็นผู้กำกับการ์ตูน เลือกสีหน้า ท่าทาง และกล้องให้แต่ละบทพูดให้เข้ากับอารมณ์ ใช้ท่าทาง/กล้องเฉพาะจุดที่ช่วยให้ดูสนุกขึ้น (ส่วนใหญ่ควรเป็น none) อย่าใช้กล้องสั่นหรือซูมกระแทกถี่เกินไป",
    `เรื่อง: ${project.title}\n${JSON.stringify(lines)}`,
    "low",
  );
  const known = new Set(lines.map((l) => l.id));
  return out.lines.filter((l) => known.has(l.id));
}
