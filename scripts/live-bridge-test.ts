import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { acknowledgeAppCommand, appCommandStatus, listAppSessions, queueAppCommand, syncAppSession } from "../packages/core/src/appBridge";
import { loadProject, prepare, ROOT } from "../packages/core/src/pipeline";
import { useEditor } from "../packages/app/web/src/lib/store";
import { createTestProject } from "./test-fixture";
import { startApp } from "../packages/app/src/server";
import { saveProject } from "../packages/core/src/projects";

const fixture = createTestProject("live");
const ids = [randomUUID(), randomUUID()];
const commandIds: string[] = [];
const originalFetch = globalThis.fetch;
let closeApp: (() => Promise<void>) | undefined;
try {
  for (const id of ids) syncAppSession({ id, page: "home" }, "http://127.0.0.1:4999");
  assert(ids.every((id) => listAppSessions().some((s) => s.id === id)));
  const command = queueAppCommand({ action: "open", project: fixture.name }, ids[0]);
  commandIds.push(command.command_id);
  assert.equal(syncAppSession({ id: ids[1], page: "home" }, "http://127.0.0.1:4999").length, 0);
  assert.equal(syncAppSession({ id: ids[0], page: "home" }, "http://127.0.0.1:4999")[0].action, "open");
  assert.throws(() => acknowledgeAppCommand(ids[1], command.command_id));
  acknowledgeAppCommand(ids[0], command.command_id);
  assert.deepEqual((appCommandStatus(command.command_id) as { status: string }).status, "done");
  assert.equal(syncAppSession({ id: ids[0], page: "edit", project: fixture.name }, "http://127.0.0.1:4999").length, 0);
  console.log("✓ คำสั่ง MCP ส่งไปเฉพาะหน้าต่างที่ระบุ และตรวจผลตอบรับได้");

  const project = loadProject(fixture.dir);
  const timeline = await prepare(fixture.dir, () => {});
  const remote = structuredClone(project);
  remote.title = "Updated through MCP";
  useEditor.setState({ name: fixture.name, project, timeline, frame: 18, save: { status: "saved" }, past: [project], future: [] });
  globalThis.fetch = async (_url, options) => Response.json(options?.method === "POST" ? { timeline, srtUrl: "test.srt" } : { project: remote, timeline });
  assert.equal(await useEditor.getState().refreshExternal(), true);
  assert.equal(useEditor.getState().project?.title, remote.title);
  assert.equal(useEditor.getState().frame, 18);
  assert.equal(useEditor.getState().past.length, 0);
  console.log("✓ รับการแก้จาก MCP อัตโนมัติ โดยคงเส้นเวลาและล้าง Undo ที่เก่าแล้ว");

  useEditor.setState({ save: { status: "pending" } });
  globalThis.fetch = async () => { throw new Error("Must not fetch while dirty"); };
  assert.equal(await useEditor.getState().refreshExternal(), false);
  console.log("✓ ไม่แทนที่งานในหน้าจอขณะที่ผู้ใช้มีการแก้ที่ยังไม่บันทึก");

  let release: (response: Response) => void = () => {};
  let started: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const sent: { project: typeof project; expectedUpdatedAt?: string }[] = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    sent.push(body);
    if (sent.length === 1) {
      started();
      return new Promise<Response>((resolve) => { release = resolve; });
    }
    return Response.json({ ...body.project, meta: { ...body.project.meta, updatedAt: "saved-2" } });
  };
  useEditor.setState({ project, diskUpdatedAt: project.meta.updatedAt, save: { status: "pending" } });
  const firstSave = useEditor.getState().flush();
  await firstStarted;
  useEditor.getState().update((draft) => { draft.title = "Typed during saving"; });
  release(Response.json({ ...project, meta: { ...project.meta, updatedAt: "saved-1" } }));
  await firstSave;
  assert.equal(useEditor.getState().save.status, "pending");
  assert.equal(useEditor.getState().project?.title, "Typed during saving");
  await useEditor.getState().flush();
  assert.equal(sent[1].project.title, "Typed during saving");
  assert.equal(sent[1].expectedUpdatedAt, "saved-1");
  assert.equal(useEditor.getState().save.status, "saved");
  console.log("✓ การพิมพ์ระหว่างบันทึกถูกบันทึกต่อ และส่งเวอร์ชันเดิมเพื่อตรวจการชนกัน");

  globalThis.fetch = async () => Response.json({ error: "Project changed through MCP" }, { status: 409 });
  useEditor.setState({ save: { status: "pending" } });
  assert.equal(await useEditor.getState().flush(), false);
  assert.equal(useEditor.getState().save.status, "error");
  assert.equal(useEditor.getState().project?.title, "Typed during saving");
  console.log("✓ เมื่อข้อมูลชนกัน คงงานผู้ใช้ไว้และแสดงข้อผิดพลาด");

  globalThis.fetch = originalFetch;
  const port = 20000 + Math.floor(Math.random() * 30000);
  const app = await startApp(port);
  closeApp = app.close;
  assert.equal(app.alreadyRunning, false, "Test port must belong to this test");
  const before = loadProject(fixture.dir);
  const updated = structuredClone(before);
  updated.title = "Remote edit must survive";
  saveProject(fixture.name, updated);
  const conflict = await fetch(`${app.url}/api/projects/${fixture.name}`, {
    method: "PUT", headers: { "Content-Type": "application/json", "X-Katun": "1" },
    body: JSON.stringify({ project: before, expectedUpdatedAt: before.meta.updatedAt }),
  });
  assert.equal(conflict.status, 409);
  await conflict.json();
  assert.equal(loadProject(fixture.dir).title, updated.title);
  const forbidden = await fetch(`${app.url}/api/app/sync`, { method: "POST", body: JSON.stringify({ id: ids[0], page: "home" }) });
  assert.equal(forbidden.status, 403);
  await forbidden.json();
  const sync = await fetch(`${app.url}/api/app/sync`, { method: "POST", headers: { "X-Katun": "1" }, body: JSON.stringify({ id: ids[0], page: "home" }) });
  assert.equal(sync.status, 200);
  await sync.json();
  console.log("✓ API จริงปฏิเสธการบันทึกทับเวอร์ชันใหม่ และป้องกันคำสั่งข้ามเว็บไซต์");
} finally {
  await closeApp?.();
  globalThis.fetch = originalFetch;
  for (const id of ids) rmSync(join(ROOT, ".cache", "app-bridge", "sessions", `${id}.json`), { force: true });
  for (const id of commandIds) for (const group of ["commands", "acks"]) rmSync(join(ROOT, ".cache", "app-bridge", group, `${id}.json`), { force: true });
  fixture.cleanup();
}
console.log("ผ่านทุกข้อ");
process.exitCode = 0;
