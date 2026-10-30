import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PROJECTS, saveProject } from "../packages/core/src/projects";
import { writeWav } from "../packages/core/src/wav";

/** Each test owns a fresh project; never read or overwrite a user's demo project. */
export function createTestProject(label: string, keep = false) {
  mkdirSync(PROJECTS, { recursive: true });
  const dir = mkdtempSync(join(PROJECTS, `test-${label}-`));
  const name = basename(dir);
  const cleanup = () => {
    if (resolve(dir) !== resolve(PROJECTS, name) || !name.startsWith(`test-${label}-`)) {
      throw new Error("Unexpected test project path");
    }
    rmSync(dir, { recursive: true, force: true });
  };
  // Also clean up failed tests; --keep deliberately preserves diagnostic renders.
  if (!keep) process.once("exit", cleanup);
  const voiceDir = join(dir, "voices");
  mkdirSync(voiceDir);
  const rate = 24000;
  const samples = Float32Array.from({ length: rate * 2 }, (_, i) => {
    const t = i / rate;
    const envelope = Math.min(1, t / 0.03, (2 - t) / 0.03);
    return Math.sin(2 * Math.PI * 220 * t) * (0.22 + 0.08 * Math.sin(2 * Math.PI * 4 * t)) * envelope;
  });
  const audio = join(voiceDir, "sample.wav");
  writeWav(audio, samples, rate);
  saveProject(name, {
    title: "Katun integration test",
    voice: { provider: "system", voice: "Microsoft Zira Desktop" },
    characters: { nok: { name: "Nok", color: "#f4a261" }, mee: { name: "Mee", color: "#8ecae6" } },
    scenes: [
      { id: "intro", lines: [
        { id: "line1", character: "nok", text: "Hello from Katun.", audio: "voices/sample.wav" },
        { id: "line2", character: "mee", text: "This is a test.", audio: "voices/sample.wav" },
      ] },
      { id: "reply", lines: [{ id: "line3", character: "nok", text: "See you soon.", audio: "voices/sample.wav" }] },
    ],
  });
  if (keep) console.log(`Test project retained: ${dir}`);
  return { dir, name, audio, cleanup };
}
