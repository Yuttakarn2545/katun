import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { doctor } from "../../core/src/integrations.js";
import { loadProject, prepare, srtPath, toSrt } from "../../core/src/pipeline.js";
import {
  createProject,
  getJob,
  jobView,
  listProjects,
  ProjectName,
  readTimeline,
  requireProject,
  saveProject,
  startRender,
  startExport,
  cancelJob,
  ExportOptionsSchema,
  storeAsset,
  storeVoice,
} from "../../core/src/projects.js";
import { renderStill } from "../../core/src/render.js";
import {
  ANIM_PROPS,
  CAMERA_MOVES,
  CastPlacementSchema,
  EMOTIONS,
  GESTURES,
  TransitionSchema,
  AudioFxSchema,
  CharacterSchema,
  ComponentSchema,
  EASES,
  LayerSchema,
  LineSchema,
  MixSchema,
  newId,
  PlacementSchema,
  ProjectSchema,
  SceneSchema,
  SubtitleSchema,
  TrackStateSchema,
  type Component,
  type Project,
} from "../../core/src/schema.js";
import { ANIM_PRESETS, applyPreset, removeKeyframe, setKeyframe, type AnimPreset } from "../../core/src/anim.js";
import { blankComponent, COMPONENT_TEMPLATES } from "../../core/src/componentTemplates.js";
import { ensureSfx, SFX, type SfxId } from "../../core/src/sfx.js";
import { exportBundle, importBundle } from "../../core/src/bundle.js";
import { NEUTRAL_FX } from "../../core/src/dsp.js";
import { TEMPLATES } from "../../core/src/templates.js";
import { VOICES } from "../../core/src/voices.js";
import { listAppSessions, queueAppCommand, appCommandStatus } from "../../core/src/appBridge.js";

// MCP server (stdio) ให้ Claude / แอป AI สั่งทำวิดีโอ 2D ได้
// ห้ามเขียนอะไรลง stdout นอกจากโปรโตคอล MCP: log ทั้งหมดต้องไปที่ stderr หรือคืนในผลลัพธ์ของ tool

type Result = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

function text(value: unknown): Result {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

// ห่อทุก tool ให้ error กลายเป็นข้อความที่ AI อ่านแล้วแก้ต่อได้ แทนที่จะทำให้ server ล่ม
function safe<A>(fn: (args: A) => Promise<Result> | Result): (args: A) => Promise<Result> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return { content: [{ type: "text", text: `ผิดพลาด: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "katun", version: "0.3.0" });

  server.registerTool("get_app_state", {
    description: "ดูหน้าต่าง Katun ที่เปิดอยู่จริง พร้อมโปรเจกต์ เฟรม สถานะเล่น/บันทึก และผลคำสั่งควบคุมหน้าจอ",
    inputSchema: { command_id: z.string().uuid().optional() },
  }, safe(({ command_id }) => text({ sessions: listAppSessions(), command: command_id ? appCommandStatus(command_id) : undefined })));
  server.registerTool("open_in_app", {
    description: "เปิดโปรเจกต์ในหน้าต่าง Katun ที่ผู้ใช้เปิดอยู่ ไม่เปิดแท็บใหม่ คืน queued แล้วใช้ get_app_state ตรวจผล",
    inputSchema: { project: ProjectName, session_id: z.string().uuid().optional() },
  }, safe(({ project, session_id }) => { requireProject(project); return text(queueAppCommand({ action: "open", project }, session_id)); }));
  server.registerTool("control_playback", {
    description: "สั่งเล่น หยุด หรือเลื่อนพรีวิวในหน้าต่าง Katun ที่เปิดอยู่ ใช้ get_app_state ตรวจผลคำสั่ง",
    inputSchema: { action: z.enum(["play", "pause", "seek"]), seconds: z.number().min(0).max(86400).optional(), session_id: z.string().uuid().optional() },
  }, safe(({ action, seconds, session_id }) => {
    if (action === "seek" && seconds === undefined) throw new Error("ระบุ seconds เมื่อ action เป็น seek");
    return text(queueAppCommand(action === "seek" ? { action, seconds: seconds! } : { action }, session_id));
  }));

  server.registerTool(
    "list_projects",
    { description: "ดูรายชื่อโปรเจกต์วิดีโอทั้งหมด พร้อมสถานะว่าเตรียมเสียงแล้วหรือเรนเดอร์แล้ว" },
    safe(() => text(listProjects())),
  );

  server.registerTool(
    "get_project",
    {
      description: "อ่าน project.json ของโปรเจกต์ (บท ฉาก ตัวละคร เสียง) เพื่อนำไปแก้แล้วบันทึกด้วย save_project",
      inputSchema: { project: ProjectName },
    },
    safe(({ project }) => text(loadProject(requireProject(project)))),
  );

  server.registerTool(
    "save_project",
    {
      description: [
        "สร้างหรือเขียนทับ project.json ทั้งไฟล์ ใช้ทั้งตอนสร้างเรื่องใหม่และตอนแก้บท",
        "โครงสร้าง: title, format (16:9 | 9:16 | 1:1), fps, voice (เสียงเริ่มต้น), characters (id → {name, color, voice?}),",
        "scenes[] (id, background = สี CSS/gradient หรือ path รูป, cast?, lines[] = {character, text, audio?, pauseAfter?})",
        "หนึ่งบรรทัดบทควรเป็นประโยคพูดสั้น ๆ 1–2 ประโยค ดูเสียงที่ใช้ได้ด้วย list_voices",
        "ผู้ใช้เปิดแก้โปรเจกต์เดียวกันในโปรแกรม Katun Studio ได้ด้วย",
      ].join(" "),
      inputSchema: { project: ProjectName, data: ProjectSchema },
    },
    safe(({ project, data }) => {
      const p = saveProject(project, data);
      const lines = p.scenes.reduce((n, s) => n + s.lines.length, 0);
      return text(`บันทึก ${project}: ${p.scenes.length} ฉาก ${lines} บรรทัด ขั้นต่อไปคือ prepare_project`);
    }),
  );

  server.registerTool(
    "add_scene",
    {
      description: "เพิ่มฉากต่อท้ายเรื่อง หรือแทนที่ฉากเดิมถ้า id ซ้ำ (โปรเจกต์ต้องมีอยู่แล้ว)",
      inputSchema: { project: ProjectName, scene: SceneSchema },
    },
    safe(({ project, scene }) => {
      const p = loadProject(requireProject(project));
      const i = p.scenes.findIndex((s) => s.id === scene.id);
      if (i >= 0) p.scenes[i] = scene;
      else p.scenes.push(scene);
      saveProject(project, p);
      return text(`${i >= 0 ? "แทนที่" : "เพิ่ม"}ฉาก ${scene.id} แล้ว (ทั้งหมด ${p.scenes.length} ฉาก)`);
    }),
  );

  server.registerTool(
    "set_character",
    {
      description: "เพิ่มหรือแก้ตัวละคร: ชื่อที่แสดงในซับ สีตัว และเสียงเฉพาะตัว (ถ้าไม่ใส่ voice จะใช้เสียงเริ่มต้นของโปรเจกต์)",
      inputSchema: { project: ProjectName, id: z.string().describe("id ที่ใช้อ้างใน lines[].character"), character: CharacterSchema },
    },
    safe(({ project, id, character }) => {
      const p = loadProject(requireProject(project));
      p.characters[id] = character;
      saveProject(project, p);
      return text(`ตั้งค่าตัวละคร ${id} (${character.name}) แล้ว`);
    }),
  );

  server.registerTool(
    "list_voices",
    { description: "รายชื่อเสียงพูดที่ใช้ได้ (ใส่ใน voice ของโปรเจกต์หรือของตัวละครเป็น {provider, voice})" },
    safe(() =>
      text({
        azureReady: !!process.env.AZURE_SPEECH_KEY,
        azureNote: process.env.AZURE_SPEECH_KEY
          ? "ใช้เสียง azure ได้ ใส่ rate เช่น \"+10%\" หรือ pitch เช่น \"+2st\" ได้"
          : "ยังไม่ได้ใส่ Azure key (ผู้ใช้ตั้งได้ในหน้า ตั้งค่า ของโปรแกรม) ตอนนี้ใช้ได้เฉพาะเสียง system หรือไฟล์อัดเอง",
        voices: VOICES,
        ownRecording: "ใช้ attach_voice เพื่อผูกไฟล์ WAV ที่อัดเองเข้ากับบรรทัดบท",
      }),
    ),
  );

  server.registerTool(
    "attach_voice",
    {
      description: "ช่องลงเสียง: ผูกไฟล์เสียง WAV (PCM 16-bit) ที่อัดเองหรืออัปโหลดเข้ากับบรรทัดบท บรรทัดนั้นจะใช้ไฟล์นี้แทน TTS",
      inputSchema: {
        project: ProjectName,
        scene_id: z.string(),
        line_index: z.number().int().min(0).describe("ลำดับบรรทัดในฉาก เริ่มที่ 0"),
        source_path: z.string().describe("path เต็มของไฟล์ .wav ในเครื่อง"),
      },
    },
    safe(({ project, scene_id, line_index, source_path }) => {
      const p = loadProject(requireProject(project));
      const scene = p.scenes.find((s) => s.id === scene_id);
      if (!scene) throw new Error(`ไม่มีฉาก ${scene_id}`);
      const line = scene.lines[line_index];
      if (!line) throw new Error(`ฉาก ${scene_id} มี ${scene.lines.length} บรรทัด (index 0–${scene.lines.length - 1})`);
      const src = resolve(source_path);
      if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`ไม่พบไฟล์ ${src}`);
      if (extname(src).toLowerCase() !== ".wav") throw new Error("รองรับเฉพาะไฟล์ .wav (ไฟล์อื่นให้ลงผ่านหน้าโปรแกรม ซึ่งแปลงให้อัตโนมัติ)");
      const stored = storeVoice(project, readFileSync(src));
      line.audio = stored.path;
      line.takes = [...new Set([...line.takes, stored.path])];
      saveProject(project, p);
      return text(`ผูกเสียง ${stored.duration.toFixed(1)} วินาทีกับ "${line.text}" แล้ว`);
    }),
  );

  server.registerTool(
    "prepare_project",
    {
      description: "สร้างเสียงพูด (TTS) ทุกบรรทัด คำนวณปากขยับ และจัดเวลา ต้องรันก่อน preview_frame / render_video และทุกครั้งที่แก้บท",
      inputSchema: { project: ProjectName },
    },
    safe(async ({ project }) => {
      const logs: string[] = [];
      const timeline = await prepare(requireProject(project), (m) => logs.push(m));
      return text({
        durationSeconds: Number(timeline.duration.toFixed(2)),
        fps: timeline.fps,
        lines: timeline.lines.map((l) => ({
          character: l.character,
          text: l.text,
          start: Number(l.start.toFixed(2)),
          duration: Number(l.duration.toFixed(2)),
        })),
        log: logs,
      });
    }),
  );

  server.registerTool(
    "preview_frame",
    {
      description: "เรนเดอร์ภาพนิ่งหนึ่งเฟรม ณ วินาทีที่กำหนด แล้วส่งภาพกลับมาให้ดู ใช้เช็กฉาก ตัวละคร และซับก่อนเรนเดอร์ทั้งเรื่อง",
      inputSchema: {
        project: ProjectName,
        time_seconds: z.number().min(0),
        scale: z.number().min(0.1).max(1).default(0.4).describe("ย่อภาพ ค่าน้อยเร็วกว่า"),
      },
    },
    safe(async ({ project, time_seconds, scale }) => {
      const dir = requireProject(project);
      const timeline = readTimeline(dir);
      if (!timeline) throw new Error("ยังไม่ได้ prepare_project");
      const last = Math.max(0, Math.ceil(timeline.duration * timeline.fps) - 1);
      const frame = Math.min(last, Math.round(time_seconds * timeline.fps));
      const out = join(dir, "out", "preview", `frame-${frame}.png`);
      await renderStill(dir, frame, out, scale);
      return {
        content: [
          { type: "image", data: readFileSync(out).toString("base64"), mimeType: "image/png" },
          { type: "text", text: `เฟรม ${frame} (${(frame / timeline.fps).toFixed(2)} วิ) บันทึกที่ ${out}` },
        ],
      };
    }),
  );

  server.registerTool(
    "render_video",
    {
      description:
        "เริ่มเรนเดอร์วิดีโอ MP4 เบื้องหลัง แล้วคืน job_id ทันที ใช้ get_render_status ติดตามผล preview = ครึ่งความละเอียด เร็วกว่า, final = เต็มความละเอียด",
      inputSchema: { project: ProjectName, quality: z.enum(["preview", "final"]).default("preview") },
    },
    safe(({ project, quality }) => text(jobView(startRender(project, quality)))),
  );

  server.registerTool(
    "get_render_status",
    {
      description: "ดูสถานะงานเรนเดอร์จาก render_video",
      inputSchema: { job_id: z.string() },
    },
    safe(({ job_id }) => {
      const job = getJob(job_id);
      if (!job) throw new Error(`ไม่พบงาน ${job_id} (งานจะหายเมื่อ server รีสตาร์ต)`);
      return text(jobView(job));
    }),
  );

  server.registerTool(
    "create_project",
    {
      description: `สร้างโปรเจกต์ใหม่จากเทมเพลต แล้วค่อยแก้ด้วย save_project หรือเครื่องมืออื่น เทมเพลต: ${TEMPLATES.map((t) => `${t.id} (${t.name})`).join(", ")}`,
      inputSchema: {
        project: ProjectName,
        title: z.string(),
        format: z.enum(["16:9", "9:16", "1:1"]).optional().describe("ไม่ใส่ = ใช้ขนาดของเทมเพลต"),
        template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).default("blank"),
      },
    },
    safe(({ project, title, format, template }) => text(createProject({ name: project, title, format, template }).project)),
  );

  const findScene = (project: string, sceneId: string) => {
    const p = loadProject(requireProject(project));
    const scene = p.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`ไม่มีฉาก ${sceneId} (มี: ${p.scenes.map((s) => s.id).join(", ")})`);
    return { p, scene };
  };

  server.registerTool(
    "add_line",
    {
      description: "เพิ่มบทพูดหนึ่งบรรทัดในฉาก (ต่อท้าย หรือแทรกที่ index)",
      inputSchema: {
        project: ProjectName,
        scene_id: z.string(),
        line: LineSchema,
        index: z.number().int().min(0).optional().describe("ตำแหน่งที่จะแทรก ไม่ใส่ = ต่อท้าย"),
      },
    },
    safe(({ project, scene_id, line, index }) => {
      const { p, scene } = findScene(project, scene_id);
      scene.lines.splice(index ?? scene.lines.length, 0, line);
      saveProject(project, p);
      return text(`เพิ่มบทในฉาก ${scene_id} แล้ว (${scene.lines.length} บรรทัด)`);
    }),
  );

  server.registerTool(
    "update_line",
    {
      description: "แก้บทพูดหนึ่งบรรทัด: ข้อความ ตัวละคร ช่วงเว้น ตัดเสียง การแสดง (สีหน้า ท่าทาง กล้อง) หรือเอาเสียงที่อัดเองออก (clear_audio) เพื่อกลับไปใช้ TTS",
      inputSchema: {
        project: ProjectName,
        scene_id: z.string(),
        line_index: z.number().int().min(0),
        text: z.string().min(1).optional(),
        character: z.string().optional(),
        pause_after: z.number().min(0).optional(),
        trim_start: z.number().min(0).optional().describe("ตัดหัวเสียง (วินาที)"),
        trim_end: z.number().min(0).optional().describe("ตัดท้ายเสียง (วินาที)"),
        emotion: z.enum(EMOTIONS).optional().describe("สีหน้า: neutral happy laugh surprised sad angry confused shy"),
        gesture: z.enum(GESTURES).optional().describe("ท่าทางระหว่างพูด: none wave nod shake jump point tremble"),
        camera: z.enum(CAMERA_MOVES).optional().describe("กล้อง: none zoomIn punch shake"),
        clear_audio: z.boolean().optional(),
      },
    },
    safe(({ project, scene_id, line_index, text: newText, character, pause_after, trim_start, trim_end, clear_audio, emotion, gesture, camera }) => {
      const { p, scene } = findScene(project, scene_id);
      const line = scene.lines[line_index];
      if (!line) throw new Error(`ฉาก ${scene_id} มี ${scene.lines.length} บรรทัด (index 0–${scene.lines.length - 1})`);
      if (newText !== undefined) line.text = newText;
      if (character !== undefined) line.character = character;
      if (pause_after !== undefined) line.pauseAfter = pause_after;
      if (trim_start !== undefined) line.trimStart = trim_start;
      if (trim_end !== undefined) line.trimEnd = trim_end;
      if (clear_audio) delete line.audio;
      if (emotion) line.emotion = emotion;
      if (gesture) line.gesture = gesture;
      if (camera) line.camera = camera;
      saveProject(project, p);
      return text(`แก้บรรทัด ${line_index} ของฉาก ${scene_id} แล้ว: "${line.text}"`);
    }),
  );

  server.registerTool(
    "remove_line",
    {
      description: "ลบบทพูดหนึ่งบรรทัด (ฉากต้องเหลืออย่างน้อย 1 บรรทัด)",
      inputSchema: { project: ProjectName, scene_id: z.string(), line_index: z.number().int().min(0) },
    },
    safe(({ project, scene_id, line_index }) => {
      const { p, scene } = findScene(project, scene_id);
      if (!scene.lines[line_index]) throw new Error(`ไม่มีบรรทัด ${line_index}`);
      if (scene.lines.length === 1) throw new Error("ฉากต้องมีอย่างน้อย 1 บรรทัด ถ้าจะลบทั้งฉากใช้ remove_scene");
      const [removed] = scene.lines.splice(line_index, 1);
      saveProject(project, p);
      return text(`ลบ "${removed.text}" แล้ว`);
    }),
  );

  server.registerTool(
    "remove_scene",
    {
      description: "ลบทั้งฉาก (เรื่องต้องเหลืออย่างน้อย 1 ฉาก)",
      inputSchema: { project: ProjectName, scene_id: z.string() },
    },
    safe(({ project, scene_id }) => {
      const p = loadProject(requireProject(project));
      if (p.scenes.length === 1) throw new Error("เรื่องต้องมีอย่างน้อย 1 ฉาก");
      const i = p.scenes.findIndex((s) => s.id === scene_id);
      if (i < 0) throw new Error(`ไม่มีฉาก ${scene_id}`);
      p.scenes.splice(i, 1);
      saveProject(project, p);
      return text(`ลบฉาก ${scene_id} แล้ว (เหลือ ${p.scenes.length} ฉาก)`);
    }),
  );

  server.registerTool(
    "set_background",
    {
      description: "ตั้งพื้นหลังของฉาก: สี CSS (#bde0fe), gradient (linear-gradient(...)) หรือ path เต็มของไฟล์รูปในเครื่อง (png/jpg/webp)",
      inputSchema: { project: ProjectName, scene_id: z.string(), background: z.string() },
    },
    safe(({ project, scene_id, background }) => {
      const { p, scene } = findScene(project, scene_id);
      const abs = resolve(background);
      if (/[\\/]/.test(background) && existsSync(abs) && statSync(abs).isFile()) {
        scene.background = storeAsset(project, readFileSync(abs), extname(abs));
      } else {
        scene.background = background;
      }
      saveProject(project, p);
      return text(`ตั้งพื้นหลังฉาก ${scene_id} เป็น ${scene.background}`);
    }),
  );

  server.registerTool(
    "set_music",
    {
      description: "ใส่ เปลี่ยน หรือเอาเพลงประกอบออก เพลงจะวนซ้ำและเบาลงอัตโนมัติตอนตัวละครพูด source_path = path เต็มของไฟล์ mp3/wav/m4a/ogg, ไม่ใส่ = ปรับแค่ความดัง, remove = เอาออก",
      inputSchema: {
        project: ProjectName,
        source_path: z.string().optional(),
        volume: z.number().min(0).max(1).optional(),
        duck_to: z.number().min(0).max(1).optional().describe("ความดังตอนมีคนพูด"),
        remove: z.boolean().optional(),
      },
    },
    safe(({ project, source_path, volume, duck_to, remove }) => {
      const p = loadProject(requireProject(project));
      if (remove) {
        delete p.music;
        saveProject(project, p);
        return text("เอาเพลงประกอบออกแล้ว");
      }
      let file = p.music?.file;
      if (source_path) {
        const abs = resolve(source_path);
        if (!existsSync(abs)) throw new Error(`ไม่พบไฟล์ ${abs}`);
        file = storeAsset(project, readFileSync(abs), extname(abs));
      }
      if (!file) throw new Error("ยังไม่มีเพลง ต้องใส่ source_path");
      p.music = { file, volume: volume ?? p.music?.volume ?? 0.25, duckTo: duck_to ?? p.music?.duckTo ?? 0.08 };
      saveProject(project, p);
      return text(`ตั้งเพลงประกอบแล้ว (ความดัง ${p.music.volume}, ตอนพูด ${p.music.duckTo})`);
    }),
  );

  server.registerTool(
    "set_subtitles",
    {
      description: "ตั้งค่าซับไตเติลที่ฝังในวิดีโอ: เปิด/ปิด ตำแหน่ง ขนาด และการแสดงชื่อคนพูด (ไฟล์ .srt สร้างให้เสมอ)",
      inputSchema: { project: ProjectName, subtitles: SubtitleSchema.partial() },
    },
    safe(({ project, subtitles }) => {
      const p = loadProject(requireProject(project));
      p.subtitles = { ...p.subtitles, ...subtitles };
      saveProject(project, p);
      return text({ subtitles: p.subtitles });
    }),
  );

  server.registerTool(
    "get_subtitles",
    {
      description: "อ่านซับไตเติลแบบ SRT ของเรื่อง (ต้อง prepare_project ก่อน) ใช้ตรวจคำผิดหรือส่งให้ผู้ใช้อัปโหลดขึ้น YouTube/TikTok",
      inputSchema: { project: ProjectName },
    },
    safe(({ project }) => {
      const dir = requireProject(project);
      const timeline = readTimeline(dir);
      if (!timeline) throw new Error("ยังไม่ได้ prepare_project");
      return text(`ไฟล์: ${srtPath(dir)}\n\n${toSrt({ ...timeline, subtitles: timeline.subtitles ?? loadProject(dir).subtitles })}`);
    }),
  );

  server.registerTool(
    "set_audio_fx",
    {
      description: [
        "ปรับเสียงของบทพูดหนึ่งบรรทัด (หรือทุกบรรทัดของตัวละครเมื่อใส่ all_lines_of_character) แบบไม่ทำลายไฟล์ต้นฉบับ:",
        "gain 0–2, fadeIn/fadeOut (วิ), speed 0.5–2 (เสียงไม่เพี้ยน), pitch -12..12 semitone (ตัวการ์ตูน ≈ +7, ยักษ์ ≈ -6),",
        "reverse, denoise 0–1 (ลดเสียงรบกวนจากไมค์), normalize, compressor, highpass, eq {low,mid,high} dB,",
        "voice: none|radio|phone|robot|megaphone|underwater, echo 0–1, reverb: none|room|hall|cave",
        "ใส่เฉพาะค่าที่จะเปลี่ยน; reset=true คืนค่าเริ่มต้นทั้งหมด แล้ว prepare_project เพื่อฟังผล",
      ].join(" "),
      inputSchema: {
        project: ProjectName,
        scene_id: z.string().optional(),
        line_index: z.number().int().min(0).optional(),
        all_lines_of_character: z.string().optional(),
        fx: AudioFxSchema.partial().optional(),
        reset: z.boolean().optional(),
      },
    },
    safe(({ project, scene_id, line_index, all_lines_of_character, fx, reset }) => {
      const p = loadProject(requireProject(project));
      const targets = all_lines_of_character
        ? p.scenes.flatMap((s) => s.lines.filter((l) => l.character === all_lines_of_character))
        : (() => {
            const scene = p.scenes.find((s) => s.id === scene_id);
            const line = scene?.lines[line_index ?? -1];
            if (!line) throw new Error("ระบุ scene_id + line_index หรือ all_lines_of_character");
            return [line];
          })();
      if (!targets.length) throw new Error(`ไม่มีบทของตัวละคร ${all_lines_of_character}`);
      for (const line of targets) {
        const base = reset ? structuredClone(NEUTRAL_FX) : line.fx;
        line.fx = AudioFxSchema.parse({ ...base, ...fx, eq: { ...base.eq, ...fx?.eq } });
      }
      saveProject(project, p);
      return text({ updated: targets.length, fx: targets[0].fx });
    }),
  );

  server.registerTool(
    "set_mix",
    {
      description: "ตั้งค่ามิกซ์ทั้งเรื่อง: master 0–1, duckFade (วิที่เพลงค่อย ๆ เบาลงรอบช่วงพูด), normalize (ปรับความดังตอนส่งออก), targetLufs (-14 สำหรับ YouTube/TikTok) และ track_volumes {ตัวละคร: 0–1}",
      inputSchema: { project: ProjectName, mix: MixSchema.partial().optional(), track_volumes: z.record(z.string(), z.number().min(0).max(1)).optional() },
    },
    safe(({ project, mix, track_volumes }) => {
      const p = loadProject(requireProject(project));
      p.mix = { ...p.mix, ...mix };
      for (const [id, volume] of Object.entries(track_volumes ?? {})) {
        if (!p.characters[id]) throw new Error(`ไม่มีตัวละคร ${id}`);
        p.tracks[id] = Object.assign({ muted: false, solo: false, locked: false, hidden: false, volume: 1 }, p.tracks[id], { volume });
      }
      saveProject(project, p);
      return text({ mix: p.mix, tracks: p.tracks });
    }),
  );

  // ---------- คอมโพเนนต์ (precomp แบบ After Effects) ----------

  const getComp = (p: Project, id: string) => {
    const c = p.components[id];
    if (!c) throw new Error(`ไม่มีคอมโพเนนต์ "${id}" (มี: ${Object.keys(p.components).join(", ") || "ยังไม่มี"})`);
    return c;
  };
  const getLayer = (c: Component, layerId: string) => {
    const l = c.layers.find((x) => x.id === layerId || x.name === layerId);
    if (!l) throw new Error(`ไม่มีเลเยอร์ "${layerId}" (มี: ${c.layers.map((x) => `${x.id} ${x.name}`).join(", ")})`);
    return l;
  };
  const summary = (id: string, c: Component) => ({
    id,
    name: c.name,
    size: `${c.width}x${c.height}`,
    duration: c.duration,
    layers: c.layers.map((l) => ({ id: l.id, name: l.name, type: l.type, start: l.start, duration: l.duration, animated: Object.keys(l.keyframes) })),
  });

  server.registerTool(
    "list_components",
    {
      description:
        "ดูคอมโพเนนต์ในโปรเจกต์ (เหมือน precomp ของ After Effects: ชิ้นงานที่มีเลเยอร์ข้อความ/รูปทรง/รูป/ตัวละคร/เสียง/คอมโพเนนต์ซ้อน พร้อมคีย์เฟรม แล้วนำไปวางซ้ำได้หลายที่) พร้อมรายชื่อเทมเพลต SFX ในตัว พรีเซตแอนิเมชัน และฟอนต์",
      inputSchema: { project: ProjectName },
    },
    safe(({ project }) => {
      const p = loadProject(requireProject(project));
      return text({
        components: Object.entries(p.components).map(([id, c]) => summary(id, c)),
        placements: p.placements,
        templates: COMPONENT_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
        sfx: Object.entries(SFX).map(([id, s]) => ({ id, ...s })),
        animationPresets: ANIM_PRESETS,
        fonts: ["Kanit", "Prompt", "Sarabun", "Mitr", "Chakra Petch", "Itim", "Mali", "Noto Sans Thai"],
      });
    }),
  );

  server.registerTool(
    "create_component",
    {
      description: "สร้างคอมโพเนนต์ใหม่ จากเทมเพลต (เช่น title-pop, lower-third, speech-bubble, star-sticker, correct, subscribe, countdown) หรือว่าง พิกัดเลเยอร์เป็นพิกเซลในคอมโพเนนต์ (0,0 = มุมซ้ายบน)",
      inputSchema: {
        project: ProjectName,
        id: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().describe("ไม่ใส่ = ตั้งให้อัตโนมัติ"),
        template: z.string().optional(),
        name: z.string().optional(),
        width: z.number().int().min(16).max(4096).optional(),
        height: z.number().int().min(16).max(4096).optional(),
        duration: z.number().min(0.1).max(600).optional(),
      },
    },
    safe(({ project, id, template, name, width, height, duration }) => {
      const dir = requireProject(project);
      const p = loadProject(dir);
      const cid = id ?? newId("c");
      if (p.components[cid]) throw new Error(`มีคอมโพเนนต์ "${cid}" อยู่แล้ว`);
      let comp: Component;
      if (template) {
        const t = COMPONENT_TEMPLATES.find((x) => x.id === template);
        if (!t) throw new Error(`ไม่มีเทมเพลต "${template}"`);
        comp = t.build((s) => ensureSfx(dir, s));
        if (name) comp.name = name;
      } else {
        comp = blankComponent(name, width, height);
        if (duration) comp.duration = duration;
      }
      p.components[cid] = comp;
      saveProject(project, p);
      return text(summary(cid, comp));
    }),
  );

  server.registerTool(
    "get_component",
    { description: "อ่านคอมโพเนนต์ทั้งก้อน (ทุกเลเยอร์และคีย์เฟรม)", inputSchema: { project: ProjectName, component: z.string() } },
    safe(({ project, component }) => text(getComp(loadProject(requireProject(project)), component))),
  );

  server.registerTool(
    "save_component",
    {
      description: "เขียนทับคอมโพเนนต์ทั้งก้อน (สร้างใหม่ได้ถ้า id ยังไม่มี) เหมาะเมื่อจะออกแบบหลายเลเยอร์พร้อมกัน",
      inputSchema: { project: ProjectName, component: z.string().regex(/^[a-zA-Z0-9_-]+$/), data: ComponentSchema },
    },
    safe(({ project, component, data }) => {
      const p = loadProject(requireProject(project));
      p.components[component] = data;
      saveProject(project, p);
      return text(summary(component, data));
    }),
  );

  server.registerTool(
    "delete_component",
    { description: "ลบคอมโพเนนต์ (ต้องไม่ถูกวางในเรื่องหรือซ้อนในคอมโพเนนต์อื่นอยู่ เว้นแต่ force=true ซึ่งจะลบการวางทั้งหมดด้วย)", inputSchema: { project: ProjectName, component: z.string(), force: z.boolean().optional() } },
    safe(({ project, component, force }) => {
      const p = loadProject(requireProject(project));
      getComp(p, component);
      const nestedIn = Object.entries(p.components).filter(([, c]) => c.layers.some((l) => l.type === "component" && l.component === component)).map(([id]) => id);
      if (nestedIn.length) throw new Error(`ซ้อนอยู่ในคอมโพเนนต์ ${nestedIn.join(", ")} ลบเลเยอร์นั้นก่อน`);
      const used = p.placements.filter((pl) => pl.component === component).length;
      if (used && !force) throw new Error(`วางอยู่ในเรื่อง ${used} จุด ใส่ force=true เพื่อลบพร้อมการวาง`);
      p.placements = p.placements.filter((pl) => pl.component !== component);
      delete p.components[component];
      saveProject(project, p);
      return text(`ลบคอมโพเนนต์ ${component} แล้ว`);
    }),
  );

  server.registerTool(
    "add_layer",
    {
      description: [
        "เพิ่มเลเยอร์ในคอมโพเนนต์ type: text | shape (rect/ellipse/star/bubble) | image (src ใน assets/) | character (id ตัวละคร) | audio (src ใน assets/ หรือใช้ add_sfx) | component (ซ้อนคอมโพเนนต์อื่น)",
        "x,y = จุดกึ่งกลางเป็นพิกเซลในคอมโพเนนต์; start/duration เป็นวินาที; animations = พรีเซตที่ใส่ให้ทันที เช่น [\"popIn\",\"fadeOut\"]",
      ].join(" "),
      inputSchema: {
        project: ProjectName,
        component: z.string(),
        layer: LayerSchema,
        index: z.number().int().min(0).optional().describe("ตำแหน่งในลำดับชั้น ไม่ใส่ = บนสุด"),
        animations: z.array(z.enum(Object.keys(ANIM_PRESETS) as [AnimPreset, ...AnimPreset[]])).optional(),
      },
    },
    safe(({ project, component, layer, index, animations }) => {
      const p = loadProject(requireProject(project));
      const c = getComp(p, component);
      for (const a of animations ?? []) applyPreset(layer, a, c.width, c.height);
      c.layers.splice(index ?? c.layers.length, 0, layer);
      saveProject(project, p);
      return text({ added: layer.id, name: layer.name, type: layer.type });
    }),
  );

  server.registerTool(
    "update_layer",
    {
      description: "แก้ค่าของเลเยอร์ (ใส่เฉพาะฟิลด์ที่เปลี่ยน เช่น {text, color, x, y, size, start, duration, hidden}) อ้างเลเยอร์ด้วย id หรือชื่อ",
      inputSchema: { project: ProjectName, component: z.string(), layer: z.string(), patch: z.record(z.string(), z.unknown()), move_to_index: z.number().int().min(0).optional() },
    },
    safe(({ project, component, layer, patch, move_to_index }) => {
      const p = loadProject(requireProject(project));
      const c = getComp(p, component);
      const old = getLayer(c, layer);
      const next = LayerSchema.parse({ ...old, ...patch, id: old.id, type: (patch.type as string) ?? old.type });
      const i = c.layers.indexOf(old);
      c.layers.splice(i, 1);
      c.layers.splice(move_to_index ?? i, 0, next);
      saveProject(project, p);
      return text(next);
    }),
  );

  server.registerTool(
    "remove_layer",
    { description: "ลบเลเยอร์ออกจากคอมโพเนนต์", inputSchema: { project: ProjectName, component: z.string(), layer: z.string() } },
    safe(({ project, component, layer }) => {
      const p = loadProject(requireProject(project));
      const c = getComp(p, component);
      const l = getLayer(c, layer);
      c.layers = c.layers.filter((x) => x !== l);
      saveProject(project, p);
      return text(`ลบเลเยอร์ ${l.name || l.id} แล้ว`);
    }),
  );

  server.registerTool(
    "set_keyframe",
    {
      description: "ใส่/แก้/ลบคีย์เฟรม prop: x | y | scale | rotation | opacity; t = วินาทีจากต้นเลเยอร์; ease ของคีย์นี้ไปคีย์ถัดไป: linear | easeIn | easeOut | easeInOut | bounce | hold",
      inputSchema: {
        project: ProjectName,
        component: z.string(),
        layer: z.string(),
        prop: z.enum(ANIM_PROPS),
        t: z.number().min(0),
        v: z.number().optional(),
        ease: z.enum(EASES).optional(),
        remove: z.boolean().optional(),
      },
    },
    safe(({ project, component, layer, prop, t, v, ease, remove }) => {
      const p = loadProject(requireProject(project));
      const l = getLayer(getComp(p, component), layer);
      if (remove) removeKeyframe(l, prop, t);
      else {
        if (v === undefined) throw new Error("ต้องใส่ v (ค่า) หรือ remove=true");
        setKeyframe(l, prop, t, v, ease);
      }
      saveProject(project, p);
      return text({ layer: l.id, prop, keyframes: l.keyframes[prop] ?? [] });
    }),
  );

  server.registerTool(
    "apply_animation",
    { description: `ใส่แอนิเมชันสำเร็จรูปให้เลเยอร์: ${Object.entries(ANIM_PRESETS).map(([k, v]) => `${k} (${v})`).join(", ")}`, inputSchema: { project: ProjectName, component: z.string(), layer: z.string(), preset: z.enum(Object.keys(ANIM_PRESETS) as [AnimPreset, ...AnimPreset[]]), length: z.number().min(0.05).max(5).optional() } },
    safe(({ project, component, layer, preset, length }) => {
      const p = loadProject(requireProject(project));
      const c = getComp(p, component);
      const l = getLayer(c, layer);
      applyPreset(l, preset, c.width, c.height, length);
      saveProject(project, p);
      return text({ layer: l.id, keyframes: l.keyframes });
    }),
  );

  server.registerTool(
    "add_sfx",
    {
      description: `เพิ่มเสียงประกอบ (SFX) ในตัวลงคอมโพเนนต์เป็นเลเยอร์เสียง: ${Object.entries(SFX).map(([k, s]) => `${k} (${s.name}: ${s.desc})`).join(", ")}`,
      inputSchema: { project: ProjectName, component: z.string(), sfx: z.enum(Object.keys(SFX) as [SfxId, ...SfxId[]]), start: z.number().min(0).default(0), volume: z.number().min(0).max(1).default(1) },
    },
    safe(({ project, component, sfx, start, volume }) => {
      const dir = requireProject(project);
      const p = loadProject(dir);
      const c = getComp(p, component);
      const layer = LayerSchema.parse({ type: "audio", name: SFX[sfx].name, src: ensureSfx(dir, sfx), start, volume, duration: Math.max(0.2, Math.min(3, c.duration - start)) });
      c.layers.push(layer);
      saveProject(project, p);
      return text({ added: layer.id, sfx, start });
    }),
  );

  server.registerTool(
    "place_component",
    {
      description: "วางคอมโพเนนต์ลงเรื่องหลัก ยึดกับฉาก (offset = วินาทีจากต้นฉาก เลื่อนตามเมื่อบทเปลี่ยน) x,y = ตำแหน่งกึ่งกลางบนจอ 0–1, scale 1 = กว้างเท่าจอ; ใส่ placement_id เพื่อแก้การวางเดิม หรือ remove=true เพื่อเอาออก",
      inputSchema: {
        project: ProjectName,
        component: z.string().optional(),
        placement_id: z.string().optional(),
        scene_id: z.string().optional(),
        offset: z.number().min(0).optional(),
        duration: z.number().min(0.05).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        scale: z.number().min(0.01).optional(),
        opacity: z.number().min(0).max(1).optional(),
        volume: z.number().min(0).max(1).optional(),
        loop: z.boolean().optional(),
        remove: z.boolean().optional(),
      },
    },
    safe(({ project, placement_id, remove, ...rest }) => {
      const p = loadProject(requireProject(project));
      const patch = Object.fromEntries(Object.entries({ ...rest, sceneId: rest.scene_id, scene_id: undefined }).filter(([, v]) => v !== undefined));
      if (placement_id) {
        const i = p.placements.findIndex((x) => x.id === placement_id);
        if (i < 0) throw new Error(`ไม่มีการวาง ${placement_id}`);
        if (remove) p.placements.splice(i, 1);
        else p.placements[i] = PlacementSchema.parse({ ...p.placements[i], ...patch });
      } else {
        if (!rest.component) throw new Error("ต้องใส่ component");
        getComp(p, rest.component);
        p.placements.push(PlacementSchema.parse({ sceneId: rest.scene_id ?? p.scenes[0].id, ...patch }));
      }
      const saved = saveProject(project, p);
      return text(remove ? `เอาการวาง ${placement_id} ออกแล้ว` : (placement_id ? saved.placements.find((x) => x.id === placement_id) : saved.placements[saved.placements.length - 1]));
    }),
  );

  server.registerTool(
    "export_video",
    {
      description: [
        "ส่งออกไฟล์ (เข้าคิว เรนเดอร์ทีละงาน) คืน job_id ให้ติดตามด้วย get_render_status:",
        "format mp4 | webm | gif | mp3 | wav (mp3/wav = เฉพาะเสียง), resolution preview | 720p | 1080p | 4k, quality draft | standard | high,",
        "fps 24|25|30|60 (ไม่ใส่ = ตามโปรเจกต์), subtitles = ฝังซับในภาพ, normalize = ปรับความดังมาตรฐาน; ซับ .srt/.vtt อยู่ใน out/ เสมอหลัง prepare_project",
      ].join(" "),
      inputSchema: { project: ProjectName, ...ExportOptionsSchema.partial().shape },
    },
    safe(({ project, ...options }) => text(jobView(startExport(project, options)))),
  );

  server.registerTool(
    "cancel_export",
    { description: "ยกเลิกงานส่งออกที่รอคิวหรือกำลังทำอยู่", inputSchema: { job_id: z.string() } },
    safe(({ job_id }) => text(jobView(cancelJob(job_id)))),
  );

  server.registerTool(
    "export_bundle",
    {
      description: "รวมโปรเจกต์พร้อมสื่อทั้งหมดเป็นไฟล์ .katun (zip) สำหรับย้ายเครื่องหรือส่งต่อ ไม่ใส่ path = บันทึกที่ projects/<ชื่อ>/out/<ชื่อ>.katun",
      inputSchema: { project: ProjectName, path: z.string().optional().describe("path เต็มของไฟล์ปลายทาง (.katun)") },
    },
    safe(({ project, path }) => {
      const dir = requireProject(project);
      const out = path ? resolve(path) : join(dir, "out", `${project}.katun`);
      mkdirSync(dirname(out), { recursive: true });
      const buf = exportBundle(project);
      writeFileSync(out, buf);
      return text({ path: out, bytes: buf.length });
    }),
  );

  server.registerTool(
    "import_bundle",
    {
      description: "นำเข้าไฟล์ .katun เป็นโปรเจกต์ใหม่ (ไม่ทับของเดิม) คืนชื่อโปรเจกต์",
      inputSchema: { path: z.string().describe("path เต็มของไฟล์ .katun"), project: ProjectName.optional().describe("ชื่อโฟลเดอร์ที่อยากได้ (ถ้าซ้ำจะตั้งให้ใหม่)") },
    },
    safe(({ path, project }) => {
      const file = resolve(path);
      if (!existsSync(file)) throw new Error(`ไม่พบไฟล์ ${file}`);
      return text(importBundle(readFileSync(file), project));
    }),
  );

  server.registerTool(
    "set_scene_style",
    {
      description: [
        "ตั้งสไตล์ของฉาก: transition = ทรานสิชันตอนเข้าฉาก {type: none|fade|slideLeft|slideUp|wipe|zoom|iris, duration วิ},",
        "auto_focus = กล้องซูมเข้าหาคนพูดอัตโนมัติ,",
        "cast = ตำแหน่งตัวละคร {id: {x 0–1 ของความกว้างจอ, scale, facing 1|-1|0 (0=หันเข้ากลางจอ), enter: none|left|right|bottom|pop}} ใส่ null เพื่อกลับไปจัดอัตโนมัติ",
      ].join(" "),
      inputSchema: {
        project: ProjectName,
        scene_id: z.string(),
        transition: TransitionSchema.partial().optional(),
        auto_focus: z.boolean().optional(),
        cast: z.record(z.string(), CastPlacementSchema.partial().nullable()).optional(),
      },
    },
    safe(({ project, scene_id, transition, auto_focus, cast }) => {
      const p = loadProject(requireProject(project));
      const scene = p.scenes.find((s) => s.id === scene_id);
      if (!scene) throw new Error(`ไม่มีฉาก ${scene_id}`);
      if (transition) scene.transition = { ...scene.transition, ...transition };
      if (auto_focus !== undefined) scene.autoFocus = auto_focus;
      for (const [id, v] of Object.entries(cast ?? {})) {
        if (!p.characters[id]) throw new Error(`ไม่มีตัวละคร ${id}`);
        if (v === null) delete scene.layout[id];
        else scene.layout[id] = CastPlacementSchema.parse({ ...scene.layout[id], ...v });
      }
      saveProject(project, p);
      return text({ scene: scene_id, transition: scene.transition, autoFocus: scene.autoFocus, cast: scene.layout });
    }),
  );

  server.registerTool(
    "set_track",
    {
      description: "ตั้งสถานะแทร็กของตัวละคร: muted (ปิดเสียง), solo (ฟังเดี่ยว), locked (ล็อกไม่ให้แก้ในไทม์ไลน์), hidden (ไม่วาดตัวละครในวิดีโอ)",
      inputSchema: { project: ProjectName, character: z.string(), state: TrackStateSchema.partial() },
    },
    safe(({ project, character, state }) => {
      const p = loadProject(requireProject(project));
      if (!p.characters[character]) throw new Error(`ไม่มีตัวละคร ${character}`);
      p.tracks[character] = Object.assign({ muted: false, solo: false, locked: false, hidden: false, volume: 1 }, p.tracks[character], state);
      saveProject(project, p);
      return text({ character, track: p.tracks[character] });
    }),
  );

  server.registerTool(
    "check_setup",
    { description: "ตรวจความพร้อมของเครื่อง (Node, ตัวเรนเดอร์, Azure TTS, Rhubarb) ใช้เมื่อมีอะไรทำงานไม่ได้ หรือก่อนเลือกเสียง" },
    safe(() => text(doctor())),
  );

  server.registerPrompt(
    "make_video",
    {
      title: "ทำวิดีโอ 2D จากหัวข้อ",
      description: "ให้ AI เขียนบท สร้างเสียง ตรวจภาพ และเรนเดอร์วิดีโอจากหัวข้อเดียว",
      argsSchema: {
        topic: z.string().describe("เรื่องที่อยากทำ เช่น น้องนกสอนนับเลข 1–3"),
        format: z.string().optional().describe("16:9, 9:16 หรือ 1:1"),
        seconds: z.string().optional().describe("ความยาวโดยประมาณ (วินาที)"),
      },
    },
    ({ topic, format, seconds }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `ช่วยทำวิดีโอการ์ตูน 2D เรื่อง: ${topic}`,
              `ขนาด ${format || "16:9"} ยาวประมาณ ${seconds || "30"} วินาที`,
              "ขั้นตอน: 1) check_setup และ list_voices เพื่อเลือกเสียงที่ใช้ได้จริง",
              "2) save_project เขียนบท ตัวละคร 1–3 ตัว แต่ละบรรทัดสั้นพูดจบใน 2–5 วินาที (ภาษาไทยประมาณ 10–25 คำ)",
              "3) prepare_project แล้วดูความยาวจริง ถ้ายาว/สั้นไปให้แก้บทแล้ว prepare ใหม่",
              "4) preview_frame อย่างน้อย 2 จุดเพื่อตรวจฉากและซับ",
              "5) render_video แบบ preview แล้ว get_render_status จนเสร็จ บอก path ไฟล์และไฟล์ .srt ให้ผู้ใช้",
              "ถามผู้ใช้ก่อนเรนเดอร์แบบ final",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
  console.error("katun MCP server พร้อมทำงาน (stdio)");
}
