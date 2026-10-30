import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_ENTRY } from "./integrations.js";

/** A real stdio handshake, without reading or modifying projects or calling AI. */
export async function checkMcpHealth() {
  const client = new Client({ name: "katun-health-check", version: "1.0.0" });
  const transport = new StdioClientTransport({ ...MCP_ENTRY, stderr: "ignore" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        const [tools, prompts] = await Promise.all([client.listTools(), client.listPrompts()]);
        if (!tools.tools.length || !prompts.prompts.some((p) => p.name === "make_video")) {
          throw new Error("MCP ตอบสนองแต่ไม่พบเครื่องมือหรือ prompt make_video");
        }
        return { ok: true as const, toolCount: tools.tools.length, promptCount: prompts.prompts.length, checkedAt: new Date().toISOString() };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("MCP ไม่ตอบสนองภายใน 15 วินาที ลองตรวจด้วย npm run doctor")), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    await transport.close();
  }
}
