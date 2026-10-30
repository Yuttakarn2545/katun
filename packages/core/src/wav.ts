import { readFileSync, writeFileSync } from "node:fs";

// อ่าน WAV แบบ PCM 16-bit (ทั้ง TTS และไฟล์ที่ผู้ใช้ให้มาต้องเป็นแบบนี้ในเฟส 1)

export type Wav = { sampleRate: number; channels: number; samples: Float32Array };

export function readWav(path: string): Wav {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path} ไม่ใช่ไฟล์ WAV (เฟส 1 รองรับเฉพาะ .wav)`);
  }
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error(`${path}: ไม่พบ fmt chunk ก่อน data`);
      // 0xFFFE = WAVE_FORMAT_EXTENSIBLE ซึ่งส่วนใหญ่ก็เป็น PCM
      if ((fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.bits !== 16) {
        throw new Error(`${path}: รองรับเฉพาะ PCM 16-bit (ไฟล์นี้ format=${fmt.format}, bits=${fmt.bits})`);
      }
      const end = Math.min(body + size, buf.length);
      const frames = Math.floor((end - body) / (2 * fmt.channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          sum += buf.readInt16LE(body + (i * fmt.channels + c) * 2);
        }
        samples[i] = sum / fmt.channels / 32768;
      }
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: ไม่พบ data chunk`);
}

/** เขียน WAV PCM 16-bit mono */
export function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** ตัดหัว/ท้ายเสียง (วินาที) พร้อม fade สั้น ๆ กันเสียงคลิกที่รอยตัด */
export function trimWav(wav: Wav, start: number, end: number): Float32Array {
  const a = Math.min(wav.samples.length, Math.max(0, Math.round(start * wav.sampleRate)));
  const b = Math.max(a, wav.samples.length - Math.max(0, Math.round(end * wav.sampleRate)));
  const out = wav.samples.slice(a, b);
  const fade = Math.min(Math.round(wav.sampleRate * 0.008), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    if (start > 0) out[i] *= g;
    if (end > 0) out[out.length - 1 - i] *= g;
  }
  return out;
}

export function wavDuration(wav: Wav): number {
  return wav.samples.length / wav.sampleRate;
}
