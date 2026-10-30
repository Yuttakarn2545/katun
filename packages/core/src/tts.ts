import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Voice } from "./schema.js";

// สร้างไฟล์เสียง WAV จากข้อความ

export async function synthesize(text: string, voice: Voice, outPath: string): Promise<void> {
  if (voice.provider === "azure") return azure(text, voice, outPath);
  return windowsSystem(text, voice, outPath);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&${{ "<": "lt", ">": "gt", "&": "amp", "'": "apos", '"': "quot" }[c]};`);
}

async function azure(text: string, voice: Voice, outPath: string): Promise<void> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error("ต้องตั้ง AZURE_SPEECH_KEY และ AZURE_SPEECH_REGION ในไฟล์ .env ก่อนใช้ provider azure");
  }
  const lang = voice.voice.split("-").slice(0, 2).join("-"); // th-TH-PremwadeeNeural → th-TH
  const prosody = [voice.rate && `rate="${voice.rate}"`, voice.pitch && `pitch="${voice.pitch}"`]
    .filter(Boolean)
    .join(" ");
  const inner = prosody ? `<prosody ${prosody}>${escapeXml(text)}</prosody>` : escapeXml(text);
  const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice.voice}">${inner}</voice></speak>`;

  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
      "User-Agent": "katun",
    },
    body: ssml,
  });
  if (!res.ok) {
    throw new Error(`Azure TTS ล้มเหลว (${res.status}): ${await res.text()}`);
  }
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

// เสียงในตัว Windows (System.Speech) ไว้ทดสอบ pipeline โดยไม่ต้องมี key; ปกติไม่มีเสียงภาษาไทย
function windowsSystem(text: string, voice: Voice, outPath: string): void {
  if (process.platform !== "win32") throw new Error("provider system ใช้ได้เฉพาะบน Windows");
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($env:KATUN_VOICE)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:KATUN_OUT, $fmt)
$s.Speak($env:KATUN_TEXT)
$s.Dispose()`;
  // ส่งข้อความผ่าน env เพื่อไม่ต้อง escape สำหรับ PowerShell
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, KATUN_VOICE: voice.voice, KATUN_OUT: outPath, KATUN_TEXT: text },
    stdio: ["ignore", "ignore", "pipe"],
  });
}
