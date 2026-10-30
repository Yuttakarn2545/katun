import { useEffect, useState } from "react";
import { useEditor } from "./store";

// waveform ของคลิป: ดึงค่า peak จาก server (100 จุดต่อวินาที) แล้ว cache ตามไฟล์

const cache = new Map<string, Promise<number[]>>();

export function usePeaks(audio: string | undefined): number[] | null {
  const name = useEditor((s) => s.name);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!audio) return setPeaks(null);
    const key = `${name}/${audio}`;
    let p = cache.get(key);
    if (!p) {
      p = fetch(`/api/projects/${name}/peaks?audio=${encodeURIComponent(audio)}`)
        .then((r) => (r.ok ? r.json() : { peaks: [] }))
        .then((d: { peaks: number[] }) => d.peaks)
        .catch(() => []);
      cache.set(key, p);
    }
    let alive = true;
    void p.then((v) => alive && setPeaks(v));
    return () => {
      alive = false;
    };
  }, [name, audio]);
  return peaks;
}
