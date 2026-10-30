import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  CLAUDE_CODE_COMMAND,
  connectClaudeCode,
  connectClaudeDesktop,
  disconnectClaudeDesktop,
  doctor,
  loadEnv,
} from "../../core/src/integrations.js";
import { outputPath, prepare } from "../../core/src/pipeline.js";
import {
  createProject,
  ExportOptionsSchema,
  exportOutputPath,
  listProjects,
  previewOutputPath,
  ProjectName,
  projectDir,
  renderOptionsFor,
  renderWithMix,
} from "../../core/src/projects.js";
import { exportBundle, importBundle } from "../../core/src/bundle.js";
import { openStudio } from "../../core/src/render.js";

const HELP = `Katun Studio: ทำวิดีโอ AI แบบ 2D

ใช้: katun [คำสั่ง]

  (ไม่ใส่คำสั่ง) | app        เปิดโปรแกรม (หน้าต่างของตัวเอง ปิดหน้าต่าง = ปิดโปรแกรม)
      --port <n>              พอร์ต (ค่าเริ่มต้น 4747)
      --browser               เปิดเป็นแท็บในเบราว์เซอร์แทน
      --no-open               ไม่ต้องเปิดหน้าต่าง (ใช้ตอนพัฒนา)
  list                        ดูโปรเจกต์ทั้งหมด
  new <ชื่อ> [ชื่อเรื่อง]      สร้างเรื่องใหม่  (--format 16:9 | 9:16 | 1:1)
  prepare <โปรเจกต์>          สร้างเสียง + ปากขยับ
  render <โปรเจกต์>           เรนเดอร์ MP4 จากเสียงที่เตรียมไว้  (--preview = ครึ่งความละเอียด)
  make <โปรเจกต์>             prepare แล้ว render ในคำสั่งเดียว
  studio <โปรเจกต์>           เปิด Remotion Studio
  mcp                         รัน MCP server (stdio) ให้ Claude/แอป AI เรียก
  connect claude-desktop      เชื่อม MCP กับ Claude Desktop
  connect claude-code         เชื่อม MCP กับ Claude Code
  disconnect claude-desktop   ยกเลิกการเชื่อมกับ Claude Desktop
  doctor                      ตรวจความพร้อมของเครื่อง
  export <โปรเจกต์>           ส่งออกตามตัวเลือก (--format --resolution --quality --fps)
  bundle <โปรเจกต์> [ไฟล์]     รวมโปรเจกต์พร้อมสื่อเป็นไฟล์ .katun
  import <ไฟล์.katun>          นำเข้าไฟล์ .katun เป็นโปรเจกต์ใหม่

<โปรเจกต์> ใส่ได้ทั้งชื่อใน projects/ หรือ path โฟลเดอร์ที่มี project.json`;

loadEnv();

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const flagValue = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--port", "--format", "--template", "--resolution", "--quality", "--fps"].includes(argv[i - 1])));
const [command = flags.has("--help") ? "help" : "app", arg1, arg2] = positional;

function projectArg(value: string | undefined): string {
  if (!value) throw new Error("ต้องระบุโปรเจกต์ เช่น katun make my-story");
  if (ProjectName.safeParse(value).success && existsSync(projectDir(value))) return projectDir(value);
  const dir = resolve(value);
  if (!existsSync(resolve(dir, "project.json"))) throw new Error(`ไม่พบโปรเจกต์ "${value}" (ดูรายชื่อด้วย katun list)`);
  return dir;
}

async function main(): Promise<void> {
  switch (command) {
    case "app": {
      const { startApp, openAppWindow, openBrowser, DIST } = await import("../../app/src/server.js");
      // หน้าจอยังไม่ถูก build (เช่น ติดตั้งจาก git โดยไม่ได้รัน install) ให้ build ครั้งแรกให้เอง
      if (!existsSync(resolve(DIST, "index.html"))) {
        console.log("กำลัง build หน้าจอโปรแกรมครั้งแรก…");
        const { build } = await import("vite");
        await build({ configFile: resolve(DIST, "..", "vite.config.ts"), logLevel: "warn" });
      }
      const port = Number(flagValue("--port") ?? process.env.KATUN_PORT ?? 4747);
      const { url, alreadyRunning } = await startApp(port);
      if (alreadyRunning) console.log(`Katun Studio เปิดอยู่แล้วที่ ${url}`);
      else console.log(`Katun Studio ทำงานที่ ${url}`);
      if (flags.has("--no-open")) {
        if (alreadyRunning) process.exit(0);
        console.log("กด Ctrl+C เพื่อปิดโปรแกรม");
        break;
      }
      const win = flags.has("--browser") ? undefined : openAppWindow(url);
      if (!win) {
        openBrowser(url);
        if (alreadyRunning) process.exit(0);
        console.log("ปิดหน้าต่างนี้หรือกด Ctrl+C เพื่อปิดโปรแกรม");
        break;
      }
      if (alreadyRunning) process.exit(0);
      // ปิดหน้าต่างโปรแกรม = ปิดโปรแกรม (ถ้า process จบเร็วมาก แปลว่าส่งต่อให้หน้าต่างที่เปิดอยู่แล้ว ให้ทำงานต่อ)
      const opened = Date.now();
      win.on("exit", () => {
        if (Date.now() - opened > 4000) process.exit(0);
        console.log("ปิดหน้าต่างนี้หรือกด Ctrl+C เพื่อปิดโปรแกรม");
      });
      break;
    }
    case "list": {
      const list = listProjects();
      if (!list.length) console.log("ยังไม่มีโปรเจกต์ สร้างด้วย: katun new my-story \"ชื่อเรื่อง\"");
      for (const p of list) {
        const status = [p.prepared ? `เสียงพร้อม ${p.durationSeconds}s` : "ยังไม่เตรียม", p.video ? "มีวิดีโอ" : ""].filter(Boolean).join(", ");
        console.log(`${p.project.padEnd(24)} ${p.title}  (${status})`);
      }
      break;
    }
    case "new": {
      if (!arg1) throw new Error("ใช้: katun new <ชื่อ> [ชื่อเรื่อง] [--format 9:16] [--template dialogue]");
      const format = flagValue("--format") as "16:9" | "9:16" | "1:1" | undefined;
      createProject({ name: arg1, title: arg2 ?? arg1, format, template: flagValue("--template") });
      console.log(`สร้าง ${projectDir(arg1)} แล้ว แก้บทในโปรแกรม (katun) หรือแก้ project.json โดยตรง`);
      break;
    }
    case "prepare":
      await prepare(projectArg(arg1));
      break;
    case "make":
    case "render": {
      const dir = projectArg(arg1);
      if (command === "make") await prepare(dir);
      const preview = flags.has("--preview");
      const name = ProjectName.safeParse(arg1).success && existsSync(projectDir(arg1!)) ? arg1! : undefined;
      const out = preview && name ? previewOutputPath(name) : outputPath(dir);
      const loud = await renderWithMix(dir, out, { inherit: true, scale: preview ? 0.5 : 1, onStage: (s) => s === "loudness" && console.log("ปรับความดังมาตรฐาน…") });
      if (loud) console.log(`ความดัง: ${loud.before.toFixed(1)} → ${loud.after.toFixed(1)} LUFS (เป้า ${loud.target})`);
      console.log(`ได้ไฟล์วิดีโอ: ${out}`);
      break;
    }
    case "export": {
      if (!arg1) throw new Error("ใช้: katun export <โปรเจกต์> [--format mp4|webm|gif|mp3|wav] [--resolution preview|720p|1080p|4k] [--quality draft|standard|high] [--fps 30]");
      const dir = projectArg(arg1);
      const name = basename(dir);
      await prepare(dir);
      const options = ExportOptionsSchema.parse({
        format: flagValue("--format"),
        resolution: flagValue("--resolution"),
        quality: flagValue("--quality"),
        fps: flagValue("--fps") ? Number(flagValue("--fps")) : undefined,
      });
      const out = exportOutputPath(name, options);
      const loud = await renderWithMix(dir, out, { ...renderOptionsFor(options), inherit: true });
      if (loud) console.log(`ความดัง: ${loud.before.toFixed(1)} → ${loud.after.toFixed(1)} LUFS`);
      console.log(`ได้ไฟล์: ${out}`);
      break;
    }
    case "bundle": {
      const dir = projectArg(arg1);
      const out = resolve(arg2 ?? join(dir, "out", `${basename(dir)}.katun`));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, exportBundle(basename(dir)));
      console.log(`ได้ไฟล์โปรเจกต์: ${out}`);
      break;
    }
    case "import": {
      if (!arg1) throw new Error("ใช้: katun import <ไฟล์.katun>");
      const r = importBundle(readFileSync(resolve(arg1)));
      console.log(`นำเข้า “${r.title}” เป็นโปรเจกต์ ${r.name} (${r.files} ไฟล์)`);
      break;
    }
    case "studio":
      await openStudio(projectArg(arg1));
      break;
    case "mcp": {
      const { runMcpServer } = await import("../../mcp-server/src/server.js");
      await runMcpServer();
      break;
    }
    case "connect":
      if (arg1 === "claude-desktop") {
        const path = connectClaudeDesktop();
        console.log(`เชื่อมแล้ว (${path})\nปิด Claude Desktop ให้สนิท (รวมไอคอนที่มุมจอ) แล้วเปิดใหม่`);
      } else if (arg1 === "claude-code") {
        console.log(connectClaudeCode() || "เพิ่ม katun ใน Claude Code แล้ว");
      } else {
        throw new Error(`ใช้: katun connect claude-desktop | claude-code\nหรือรันเอง: ${CLAUDE_CODE_COMMAND}`);
      }
      break;
    case "disconnect":
      if (arg1 !== "claude-desktop") throw new Error("ใช้: katun disconnect claude-desktop");
      disconnectClaudeDesktop();
      console.log("ยกเลิกการเชื่อมกับ Claude Desktop แล้ว");
      break;
    case "doctor": {
      const checks = doctor();
      for (const c of checks) console.log(`${c.ok ? "✓" : c.optional ? "–" : "✕"} ${c.name}: ${c.detail}`);
      if (checks.some((c) => !c.ok && !c.optional)) process.exitCode = 1;
      break;
    }
    case "help":
    case "-h":
      console.log(HELP);
      break;
    default:
      throw new Error(`ไม่รู้จักคำสั่ง "${command}"\n\n${HELP}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
