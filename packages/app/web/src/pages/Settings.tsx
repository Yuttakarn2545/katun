import { ArrowLeft, Check, Copy, Minus, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { navigate } from "../App";
import { AsyncButton, toast } from "../components/ui";
import { api } from "../lib/api";

// ตั้งค่า: เสียงพูด (Azure), ตรวจความพร้อม, เชื่อม MCP, คำสั่ง Terminal

type Check = { name: string; ok: boolean; detail: string; optional?: boolean };
type Settings = { azureKeySet: boolean; azureKeyHint: string; azureRegion: string; anthropicKeySet: boolean; anthropicKeyHint: string };
type Integrations = {
  claudeDesktop: { installed: boolean; configPath?: string; connected: boolean };
  claudeCode: { installed: boolean; connected: boolean; command: string };
  mcpEntry: { command: string; args: string[] };
  chatgpt: { note: string };
};

export function Settings() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
        <button className="btn-icon" aria-label="กลับหน้าแรก" onClick={() => navigate("#/")}>
          <ArrowLeft size={17} />
        </button>
        <span className="text-[16px] font-semibold">ตั้งค่าและเชื่อมต่อ AI</span>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <McpCard />
            <ClaudeCard />
            <AzureCard />
          </div>
          <div className="space-y-5">
            <DoctorCard />
            <CliCard />
          </div>
        </div>
      </main>
    </div>
  );
}

function Card({ title, children, desc }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-[12px] text-muted">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${ok ? "bg-ok/15 text-ok" : "bg-panel-3 text-muted"}`}>{children}</span>;
}

function McpCard() {
  const [s, setS] = useState<Integrations | null>(null);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<{ toolCount: number; promptCount: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const load = useCallback(() => api<Integrations>("/api/integrations").then((data) => { setS(data); setError(""); }).catch((err: Error) => setError(err.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card title="เชื่อมต่อ AI ผ่าน MCP" desc="ให้แอป AI ที่รองรับ MCP สั่งสร้างและแก้โปรเจกต์ ดูภาพ และส่งออกวิดีโอได้ ไม่ต้องใส่ Claude API key ใน Katun">
      <div className="mb-4 rounded-lg border border-line bg-app p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-medium">Katun MCP server</span>
          <AsyncButton className="btn" onClick={async () => {
            setHealth(null);
            setError("");
            setChecking(true);
            try {
              setHealth(await api<{ toolCount: number; promptCount: number }>("/api/integrations/mcp/check", { method: "POST" }));
            } catch (err) { setError((err as Error).message); }
            finally { setChecking(false); }
          }}>{checking ? "กำลังทดสอบ…" : "ทดสอบ MCP"}</AsyncButton>
        </div>
        <p className="mt-2 text-[12px] text-muted" role="status">
          {checking ? "กำลังเริ่ม server และตรวจการตอบสนอง…" : health ? `ตอบสนองแล้ว · ${health.toolCount} เครื่องมือ · ${health.promptCount} prompt` : "กดทดสอบเพื่อตรวจว่า server เริ่มทำงานและตอบกลับได้จริง"}
        </p>
        <p className="mt-1 text-[12px] text-muted">สถานะของ server แยกจากการตั้งค่า Claude Desktop / Claude Code และปุ่ม AI ช่วยในโปรแกรม</p>
      </div>
      {error && <div role="alert" className="mb-3 text-[12px] text-danger">{error}</div>}
      {!s && !error ? (
        <div className="text-muted">กำลังตรวจ…</div>
      ) : s ? (
        <div className="divide-y divide-line">
          <div className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                Claude Desktop <Badge ok={s.claudeDesktop.connected}>{!s.claudeDesktop.installed ? "ไม่พบในเครื่อง" : s.claudeDesktop.connected ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า"}</Badge>
              </div>
              {s.claudeDesktop.configPath && <div className="truncate font-mono text-[11px] text-faint">{s.claudeDesktop.configPath}</div>}
            </div>
            {s.claudeDesktop.connected ? (
              <AsyncButton className="btn-ghost" onClick={async () => (await api("/api/integrations/claude-desktop/disconnect", { method: "POST" }), load())}>
                ยกเลิกการเชื่อม
              </AsyncButton>
            ) : (
              <AsyncButton
                className="btn-primary"
                onClick={async () => {
                  await api("/api/integrations/claude-desktop/connect", { method: "POST" });
                  toast("บันทึกการตั้งค่าแล้ว ปิด Claude Desktop ให้สนิท (รวมไอคอนที่มุมจอ) แล้วเปิดใหม่เพื่อตรวจการเชื่อมต่อ");
                  await load();
                }}
              >
                เชื่อมต่อ
              </AsyncButton>
            )}
          </div>
          <div className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                Claude Code <Badge ok={s.claudeCode.connected}>{!s.claudeCode.installed ? "ไม่พบคำสั่ง claude" : s.claudeCode.connected ? "พบการตั้งค่า" : "ยังไม่ได้ตั้งค่า"}</Badge>
              </div>
              <div className="truncate font-mono text-[11px] text-faint">{s.claudeCode.command}</div>
            </div>
            {s.claudeCode.installed && !s.claudeCode.connected ? (
              <AsyncButton className="btn-primary" onClick={async () => (await api("/api/integrations/claude-code/connect", { method: "POST" }), load())}>
                เชื่อมต่อ
              </AsyncButton>
            ) : (
              <AsyncButton className="btn-ghost" onClick={async () => (await navigator.clipboard.writeText(s.claudeCode.command), toast("คัดลอกแล้ว"))}>
                <Copy size={14} /> คัดลอก
              </AsyncButton>
            )}
          </div>
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              ChatGPT <Badge ok={false}>เร็ว ๆ นี้</Badge>
            </div>
            <div className="text-[12px] text-muted">{s.chatgpt.note}</div>
          </div>
          <details className="pt-3 text-[12px]">
            <summary className="cursor-pointer text-muted">ตั้งค่าเองในแอป AI อื่นที่รองรับ MCP</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-app p-3 font-mono text-[11px]">{JSON.stringify({ mcpServers: { katun: s.mcpEntry } }, null, 2)}</pre>
          </details>
        </div>
      ) : <AsyncButton className="btn" onClick={load}>ลองโหลดข้อมูลอีกครั้ง</AsyncButton>}
    </Card>
  );
}

function AzureCard() {
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [region, setRegion] = useState("southeastasia");
  const load = useCallback(
    () =>
      api<Settings>("/api/settings").then((v) => {
        setS(v);
        setRegion(v.azureRegion);
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const regions = ["southeastasia", "eastasia", "japaneast", "eastus", "westus2", "westeurope"];
  return (
    <Card title="เสียงพูดภาษาไทย (Azure TTS)" desc="สร้าง Speech resource ใน Azure แล้วนำ key และ region มาใส่ ค่าจะเก็บในไฟล์ .env บนเครื่องนี้เท่านั้น">
      <label className="label">Speech key</label>
      <input
        className="input mb-3"
        type="password"
        autoComplete="off"
        placeholder={s?.azureKeySet ? `ใส่แล้ว ${s.azureKeyHint} (เว้นว่างไว้ถ้าไม่เปลี่ยน)` : "วาง key ที่นี่"}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <label className="label">Region</label>
      <select className="input mb-4" value={region} onChange={(e) => setRegion(e.target.value)}>
        {[...new Set([...regions, region])].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <AsyncButton
          className="btn-primary"
          onClick={async () => {
            await api("/api/settings", { method: "PUT", body: key.trim() ? { azureKey: key.trim(), azureRegion: region } : { azureRegion: region } });
            setKey("");
            toast("บันทึกการตั้งค่าแล้ว");
            await load();
          }}
        >
          บันทึก
        </AsyncButton>
        {s?.azureKeySet && (
          <AsyncButton className="btn-ghost text-danger" onClick={async () => (await api("/api/settings", { method: "PUT", body: { azureKey: "" } }), load())}>
            ลบ key
          </AsyncButton>
        )}
      </div>
    </Card>
  );
}

function DoctorCard() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const load = useCallback(() => api<Check[]>("/api/doctor").then(setChecks), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card title="ตรวจความพร้อมของเครื่อง">
      {!checks ? (
        <div className="text-muted">กำลังตรวจ…</div>
      ) : (
        <div className="divide-y divide-line">
          {checks.map((c) => (
            <div key={c.name} className="flex items-start gap-3 py-2.5">
              <span className={`mt-0.5 ${c.ok ? "text-ok" : c.optional ? "text-warn" : "text-danger"}`}>
                {c.ok ? <Check size={16} /> : c.optional ? <Minus size={16} /> : <X size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div>
                  {c.name}
                  {c.optional && !c.ok && <span className="text-[11px] text-faint"> (ไม่บังคับ)</span>}
                </div>
                <div className="text-[12px] break-all text-muted">{c.detail}</div>
              </div>
              {c.name.startsWith("Rhubarb") && !c.ok && (
                <AsyncButton
                  className="btn h-7 text-[12px]"
                  onClick={async () => {
                    toast("กำลังดาวน์โหลด Rhubarb จาก GitHub…");
                    await api("/api/rhubarb/install", { method: "POST" });
                    toast("ติดตั้ง Rhubarb แล้ว");
                    await load();
                  }}
                >
                  ติดตั้ง
                </AsyncButton>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CliCard() {
  const cmds: [string, string][] = [
    ["katun", "เปิดโปรแกรมนี้"],
    ["katun list", "ดูโปรเจกต์ทั้งหมด"],
    ['katun new my-story "ชื่อเรื่อง" --template dialogue', "สร้างเรื่องใหม่จากเทมเพลต"],
    ["katun make my-story", "เตรียมเสียงและเรนเดอร์ MP4 + SRT"],
    ["katun doctor", "ตรวจความพร้อมของเครื่อง"],
    ["katun connect claude-desktop", "เชื่อม MCP กับ Claude Desktop"],
    ["katun help", "ดูคำสั่งทั้งหมด"],
  ];
  return (
    <Card title="ใช้ผ่าน Terminal" desc="เปิด PowerShell หรือ Terminal แล้วพิมพ์">
      <div className="space-y-2">
        {cmds.map(([c, d]) => (
          <div key={c}>
            <pre className="overflow-x-auto rounded-md bg-app px-3 py-1.5 font-mono text-[12px]">{c}</pre>
            <div className="mt-0.5 text-[11px] text-muted">{d}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ClaudeCard() {
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const load = useCallback(() => api<Settings>("/api/settings").then(setS), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card title="AI ช่วยในโปรแกรม (Claude API)" desc="สำหรับปุ่ม “ให้ AI ทำให้” และ “AI ช่วย” เท่านั้น แยกจาก MCP การไม่ใส่ key นี้ไม่กระทบ MCP สร้าง key ได้ที่ console.anthropic.com และเก็บในไฟล์ .env บนเครื่องนี้">
      <label className="label">Claude API key</label>
      <input
        className="input mb-4"
        type="password"
        autoComplete="off"
        placeholder={s?.anthropicKeySet ? `ใส่แล้ว ${s.anthropicKeyHint} (เว้นว่างไว้ถ้าไม่เปลี่ยน)` : "sk-ant-…"}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className="flex gap-2">
        <AsyncButton
          className="btn-primary"
          onClick={async () => {
            if (!key.trim()) throw new Error("วาง key ก่อน");
            await api("/api/settings", { method: "PUT", body: { anthropicKey: key.trim() } });
            setKey("");
            toast("บันทึกแล้ว");
            await load();
          }}
        >
          บันทึก
        </AsyncButton>
        {s?.anthropicKeySet && (
          <AsyncButton className="btn-ghost text-danger" onClick={async () => (await api("/api/settings", { method: "PUT", body: { anthropicKey: "" } }), load())}>
            ลบ key
          </AsyncButton>
        )}
      </div>
    </Card>
  );
}
