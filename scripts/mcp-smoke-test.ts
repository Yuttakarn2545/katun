import { createTestProject } from "./test-fixture";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { checkMcpHealth } from "../packages/core/src/mcpHealth";

// ทดสอบ MCP server แบบเดียวกับที่ Claude เรียก: สร้างเรื่อง → ลงเสียง → เตรียม → ดูภาพ → เรนเดอร์
// ใช้เสียงในตัว Windows จึงไม่ต้องมี key  รัน: npm run test:mcp

const ROOT = resolve(import.meta.dirname, "..");
const source = createTestProject("mcp-source");
const target = createTestProject("mcp");
const NAME = target.name;
const DIR = target.dir;

// เรียกแบบเดียวกับที่ Claude Desktop เรียก (node bin/katun.js mcp)
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "bin", "katun.js"), "mcp"],
  stderr: "inherit",
});
const client = new Client({ name: "katun-smoke-test", version: "1.0.0" });

type Content = { type: string; text?: string; data?: string };

async function call(name: string, args: Record<string, unknown> = {}): Promise<Content[]> {
  const res = (await client.callTool({ name, arguments: args })) as { content: Content[]; isError?: boolean };
  const textOut = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (res.isError) throw new Error(`${name} ล้มเหลว: ${textOut}`);
  console.log(`✓ ${name}: ${textOut.split("\n")[0].slice(0, 120)}`);
  return res.content;
}

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ตรวจไม่ผ่าน: ${msg}`);
}

target.cleanup();
const health = await checkMcpHealth();
check(health.ok && health.toolCount === 44 && health.promptCount >= 1, "MCP health check ต้องจับมือกับ server จริงได้");
console.log(`✓ MCP health: ${health.toolCount} tools, ${health.promptCount} prompts`);
await client.connect(transport);

try {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log(`tools (${tools.length}): ${tools.join(", ")}`);
  check(tools.length === 44 && ["get_app_state", "open_in_app", "control_playback"].every((t) => tools.includes(t)), "ต้องมี 44 tools รวมควบคุมหน้าต่างจริง");
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  check(prompts.includes("make_video"), "ต้องมี prompt make_video");
  console.log(`✓ prompts: ${prompts.join(", ")}`);

  await call("check_setup");
  await call("list_voices");
  await call("create_project", { project: NAME, title: "temp", format: "9:16" });
  await call("save_project", {
    project: NAME,
    data: {
      title: "Smoke test",
      format: "9:16",
      voice: { provider: "system", voice: "Microsoft Zira Desktop" },
      characters: { nok: { name: "Nok", color: "#f4a261" } },
      scenes: [{ id: "intro", lines: [{ character: "nok", text: "Hi, I was made by an MCP client." }] }],
    },
  });
  await call("set_character", {
    project: NAME,
    id: "mee",
    character: { name: "Mee", color: "#8ecae6", voice: { provider: "system", voice: "Microsoft David Desktop" } },
  });
  await call("add_scene", {
    project: NAME,
    scene: {
      id: "reply",
      background: "#ffe5ec",
      lines: [
        { character: "mee", text: "This line will use a recorded file." },
        { character: "nok", text: "Great, it works!" },
      ],
    },
  });

  const sample = source.audio;
  await call("attach_voice", { project: NAME, scene_id: "reply", line_index: 0, source_path: sample });

  // ต้อง error แบบอ่านรู้เรื่อง ไม่ใช่ทำให้ server ล่ม
  const bad = (await client.callTool({ name: "get_project", arguments: { project: "../etc" } })) as { isError?: boolean };
  check(bad.isError, "ชื่อโปรเจกต์ที่มี ../ ต้องถูกปฏิเสธ");
  console.log("✓ ปฏิเสธชื่อโปรเจกต์ ../etc");

  await call("add_line", { project: NAME, scene_id: "reply", line: { character: "mee", text: "Temporary line." } });
  await call("update_line", { project: NAME, scene_id: "reply", line_index: 2, text: "Edited line, then removed." });
  await call("remove_line", { project: NAME, scene_id: "reply", line_index: 2 });
  await call("add_scene", { project: NAME, scene: { id: "extra", lines: [{ character: "nok", text: "Bye." }] } });
  await call("remove_scene", { project: NAME, scene_id: "extra" });
  await call("set_background", { project: NAME, scene_id: "intro", background: "linear-gradient(#caffbf, #fdffb6)" });
  await call("set_subtitles", { project: NAME, subtitles: { size: "large", position: "top" } });
  // เพลงประกอบ: ใช้ WAV ตัวอย่างแทนไฟล์เพลงจริง
  await call("set_music", { project: NAME, source_path: sample, volume: 0.2 });

  const saved = JSON.parse((await call("get_project", { project: NAME }))[0].text!) as {
    scenes: { id: string; lines: unknown[]; background: string }[];
    subtitles: { size: string };
    music?: { file: string };
  };
  check(saved.scenes.length === 2 && saved.scenes[1].lines.length === 2, "แก้/ลบบรรทัดและฉากต้องถูกต้อง");
  check(saved.subtitles.size === "large", "ตั้งค่าซับต้องถูกบันทึก");
  check(saved.music?.file.startsWith("assets/"), "เพลงต้องถูกคัดลอกเข้า assets/");

  await call("set_audio_fx", { project: NAME, all_lines_of_character: "nok", fx: { pitch: 5, reverb: "room", denoise: 0.3 } });
  await call("set_mix", { project: NAME, mix: { master: 0.9, targetLufs: -14 }, track_volumes: { mee: 0.8 } });
  const fxSaved = JSON.parse((await call("get_project", { project: NAME }))[0].text!) as {
    scenes: { lines: { character: string; fx: { pitch: number } }[] }[];
    mix: { master: number };
    tracks: Record<string, { volume: number }>;
  };
  check(
    fxSaved.scenes.flatMap((s) => s.lines).every((l) => (l.character === "nok") === (l.fx.pitch === 5)) && fxSaved.mix.master === 0.9 && fxSaved.tracks.mee.volume === 0.8,
    "เอฟเฟกต์และมิกซ์ต้องถูกบันทึก",
  );

  // คอมโพเนนต์: สร้างจากเทมเพลต + สร้างเอง ซ้อนกัน ใส่คีย์เฟรม/แอนิเมชัน/SFX แล้ววางลงเรื่อง
  await call("list_components", { project: NAME });
  await call("create_component", { project: NAME, id: "title", template: "title-pop" });
  await call("create_component", { project: NAME, id: "badge", name: "ป้าย", width: 600, height: 200, duration: 2 });
  const added = JSON.parse(
    (await call("add_layer", { project: NAME, component: "badge", layer: { type: "text", name: "label", text: "ใหม่!", x: 300, y: 100, size: 90, color: "#ff3355" }, animations: ["popIn"] }))[0].text!,
  ) as { added: string };
  await call("update_layer", { project: NAME, component: "badge", layer: "label", patch: { text: "ใหม่ล่าสุด!", box: "#ffffff" } });
  await call("set_keyframe", { project: NAME, component: "badge", layer: added.added, prop: "rotation", t: 0.5, v: 10, ease: "bounce" });
  await call("apply_animation", { project: NAME, component: "badge", layer: "label", preset: "fadeOut" });
  await call("add_sfx", { project: NAME, component: "badge", sfx: "ding", start: 0.1 });
  await call("add_layer", { project: NAME, component: "title", layer: { type: "component", component: "badge", x: 960, y: 300 } });
  const loop = (await client.callTool({ name: "add_layer", arguments: { project: NAME, component: "badge", layer: { type: "component", component: "title" } } })) as { isError?: boolean };
  check(loop.isError, "การซ้อนวน (badge ↔ title) ต้องถูกปฏิเสธ");
  console.log("✓ ปฏิเสธการซ้อนคอมโพเนนต์วน");
  const placed = JSON.parse((await call("place_component", { project: NAME, component: "title", scene_id: "intro", offset: 0.3, y: 0.3, scale: 0.8 }))[0].text!) as { id: string };
  await call("place_component", { project: NAME, placement_id: placed.id, x: 0.45 });
  const comp = JSON.parse((await call("get_component", { project: NAME, component: "badge" }))[0].text!) as {
    layers: { type: string; text?: string; keyframes: Record<string, unknown[]> }[];
  };
  const label = comp.layers.find((l) => l.type === "text")!;
  check(label.text === "ใหม่ล่าสุด!" && label.keyframes.rotation?.length === 1 && label.keyframes.opacity?.length && comp.layers.some((l) => l.type === "audio"), "เลเยอร์ คีย์เฟรม แอนิเมชัน และ SFX ถูกบันทึก");

  // การแสดงและสไตล์ฉาก
  await call("update_line", { project: NAME, scene_id: "intro", line_index: 0, emotion: "happy", gesture: "wave", camera: "punch" });
  await call("set_scene_style", { project: NAME, scene_id: "reply", transition: { type: "iris", duration: 0.6 }, auto_focus: true, cast: { mee: { x: 0.7, enter: "pop" } } });
  await call("set_subtitles", { project: NAME, subtitles: { style: "bold", karaoke: true, font: "Kanit" } });
  const styled = JSON.parse((await call("get_project", { project: NAME }))[0].text!) as {
    scenes: { id: string; transition: { type: string }; autoFocus: boolean; layout: Record<string, { x: number }>; lines: { emotion: string; gesture: string }[] }[];
    subtitles: { style: string; karaoke: boolean };
  };
  const reply = styled.scenes.find((s) => s.id === "reply")!;
  check(
    styled.scenes[0].lines[0].emotion === "happy" && reply.transition.type === "iris" && reply.autoFocus && reply.layout.mee.x === 0.7 && styled.subtitles.karaoke,
    "การแสดง สไตล์ฉาก และสไตล์ซับถูกบันทึก",
  );

  await call("prepare_project", { project: NAME });
  const srt = (await call("get_subtitles", { project: NAME }))[0].text!;
  check(/00:00:00,\d{3} --> /.test(srt), "ต้องได้ SRT");

  const preview = await call("preview_frame", { project: NAME, time_seconds: 1.5, scale: 0.3 });
  const img = preview.find((c) => c.type === "image");
  check(img?.data && Buffer.from(img.data, "base64").subarray(1, 4).toString() === "PNG", "preview_frame ต้องคืนภาพ PNG");

  const started = await call("render_video", { project: NAME, quality: "preview" });
  const { job_id } = JSON.parse(started[0].text!) as { job_id: string };
  const waitJob = async (id: string, label: string) => {
    let status = "queued";
    for (let i = 0; i < 300 && (status === "queued" || status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = (await client.callTool({ name: "get_render_status", arguments: { job_id: id } })) as { content: Content[] };
      const s = JSON.parse(res.content[0].text!) as { status: string; error?: string; output?: string };
      status = s.status;
      if (s.status === "failed") throw new Error(`${label} ล้มเหลว: ${s.error}`);
      if (s.status === "done") console.log(`✓ ${label} → ${s.output}`);
    }
    return status;
  };
  check((await waitJob(job_id, "render_video")) === "done", "เรนเดอร์ต้องเสร็จภายใน 10 นาที");
  check(existsSync(join(DIR, "out", `${NAME}-preview.mp4`)), "ต้องมีไฟล์ MP4");

  const audio = JSON.parse((await call("export_video", { project: NAME, format: "mp3" }))[0].text!) as { job_id: string };
  check((await waitJob(audio.job_id, "export_video mp3")) === "done" && existsSync(join(DIR, "out", `${NAME}-audio.mp3`)), "export_video ส่งออก MP3 ได้");
  const big = JSON.parse((await call("export_video", { project: NAME, format: "webm", resolution: "4k", quality: "high" }))[0].text!) as { job_id: string };
  await call("cancel_export", { job_id: big.job_id });
  check((await waitJob(big.job_id, "export_video webm 4k")) === "canceled", "cancel_export ยกเลิกงานได้");

  const bundled = JSON.parse((await call("export_bundle", { project: NAME }))[0].text!) as { path: string; bytes: number };
  check(existsSync(bundled.path) && bundled.bytes > 0, "export_bundle ได้ไฟล์ .katun");
  const imported = JSON.parse((await call("import_bundle", { path: bundled.path, project: NAME }))[0].text!) as { name: string };
  check(imported.name && imported.name !== NAME && existsSync(join(DIR, "..", imported.name, "project.json")), "import_bundle ได้โปรเจกต์ใหม่ไม่ทับของเดิม");
  rmSync(join(DIR, "..", imported.name), { recursive: true, force: true });

  const blocked = (await client.callTool({ name: "delete_component", arguments: { project: NAME, component: "title" } })) as { isError?: boolean };
  check(blocked.isError, "ลบคอมโพเนนต์ที่วางอยู่โดยไม่ใส่ force ต้องถูกปฏิเสธ");
  await call("delete_component", { project: NAME, component: "title", force: true });
  await call("list_projects");
  console.log("\nผ่านทุกข้อ");
} finally {
  await client.close();
}
