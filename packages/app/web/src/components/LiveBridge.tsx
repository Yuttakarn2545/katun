import { useEffect, useState } from "react";
import type { AppCommand } from "../../../../core/src/appBridge";
import { api } from "../lib/api";
import { useEditor } from "../lib/store";
import { playerRef } from "./PreviewPlayer";
import { toast } from "./ui";

const sessionId = crypto.randomUUID();
const routeProject = () => /^#\/edit\/([a-zA-Z0-9_-]+)$/.exec(location.hash)?.[1];

export function LiveBridge() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let nextRefresh = 0;
    const executed = new Map<string, string | undefined>();
    const execute = async (command: AppCommand) => {
      if (command.action === "open") {
        if (!(await useEditor.getState().flush())) throw new Error("มีงานที่บันทึกไม่สำเร็จ จึงยังไม่เปลี่ยนโปรเจกต์");
        if (routeProject() === command.project) await useEditor.getState().refreshExternal();
        else location.hash = `#/edit/${command.project}`;
        const deadline = Date.now() + 12000;
        while (!stopped && Date.now() < deadline) {
          if (useEditor.getState().name === command.project && routeProject() === command.project && playerRef.current) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("เปิดโปรเจกต์แล้ว แต่พรีวิวยังไม่พร้อม ตรวจสถานะเสียงในโปรแกรม");
      }
      const state = useEditor.getState();
      const player = playerRef.current;
      if (!routeProject() || !player) throw new Error("เปิดโปรเจกต์และรอพรีวิวพร้อมก่อนควบคุมการเล่น");
      if (state.editing) throw new Error("ออกจากโหมดแก้คอมโพเนนต์ก่อนควบคุมเรื่องหลัก");
      if (command.action === "play") await player.play();
      if (command.action === "pause") player.pause();
      if (command.action === "seek") {
        player.pause();
        player.seekTo(Math.max(0, Math.min(Math.ceil((state.timeline?.duration ?? 0) * (state.project?.fps ?? 30)) - 1, Math.round(command.seconds * (state.project?.fps ?? 30)))));
      }
    };
    const poll = async () => {
      try {
        const project = routeProject();
        const state = useEditor.getState();
        const result = await api<{ commands: AppCommand[] }>("/api/app/sync", { method: "POST", body: {
          id: sessionId, page: project ? "edit" : location.hash === "#/settings" ? "settings" : "home",
          project, frame: project ? state.frame : 0, playing: !!project && !!playerRef.current?.isPlaying(),
          focused: document.hasFocus(), save: project ? state.save.status : "saved",
        } });
        if (stopped) return;
        setConnected(true);
        for (const command of result.commands) {
          if (executed.has(command.id)) {
            await api("/api/app/ack", { method: "POST", body: { sessionId, commandId: command.id, error: executed.get(command.id) } });
            continue;
          }
          let error: string | undefined;
          try { await execute(command); }
          catch (err) { error = (err as Error).message; toast(error, "error"); }
          executed.set(command.id, error);
          if (executed.size > 100) executed.delete(executed.keys().next().value!);
          await api("/api/app/ack", { method: "POST", body: { sessionId, commandId: command.id, error } });
        }
        if (Date.now() >= nextRefresh) {
          nextRefresh = Date.now() + 2000;
          if (routeProject() && useEditor.getState().name === routeProject()) await useEditor.getState().refreshExternal();
          else window.dispatchEvent(new Event("katun:refresh-projects"));
        }
      } catch { if (!stopped) setConnected(false); }
      finally { if (!stopped) timer = setTimeout(() => void poll(), 750); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return <div role="status" title="รับคำสั่งเปิดโปรเจกต์ เล่น และหยุดจาก MCP ในหน้าต่างนี้" className={`fixed bottom-2 right-3 z-30 rounded-md border border-line bg-panel px-2 py-1 text-[11px] ${connected ? "text-ok" : "text-warn"}`}>
    {connected ? "MCP พร้อมรับคำสั่ง · ซิงก์อัตโนมัติ" : "MCP กำลังเชื่อมต่อหน้าต่าง…"}
  </div>;
}
