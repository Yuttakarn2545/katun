import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// หน้าจอ Katun Studio: build เป็นไฟล์ static ใน packages/app/dist ให้ server ในเครื่องส่ง
// ตอนพัฒนา: npm run dev:web (Vite) คู่กับ katun app --no-open (API ที่พอร์ต 4747)
export default defineConfig({
  root: resolve(import.meta.dirname, "web"),
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/files", "/cache"].map((p) => [p, { target: "http://127.0.0.1:4747", headers: { host: "127.0.0.1:4747" } }]),
    ),
  },
});
