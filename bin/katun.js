#!/usr/bin/env node
// จุดเริ่มของคำสั่ง katun: ลงทะเบียน tsx ใน process เดียวกัน (stdin/stdout ไม่ถูกคั่นกลาง ซึ่ง MCP แบบ stdio ต้องการ)
import { register } from "tsx/esm/api";

register();
await import("../packages/cli/src/main.ts");
