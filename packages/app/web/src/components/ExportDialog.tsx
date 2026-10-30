import { Download, FileArchive, FolderOpen, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type JobView } from "../lib/api";
import { useEditor } from "../lib/store";
import { AsyncButton, Modal, toast } from "./ui";

// ส่งออก: เลือกรูปแบบ/ความละเอียด/คุณภาพ แล้วเข้าคิว (เรนเดอร์ทีละงาน) ติดตามและยกเลิกได้

type Format = "mp4" | "webm" | "gif" | "mp3" | "wav";
type Options = {
  format: Format;
  resolution: "preview" | "720p" | "1080p" | "4k";
  quality: "draft" | "standard" | "high";
  fps?: 24 | 25 | 30 | 60;
  subtitles?: boolean;
  normalize?: boolean;
};
export type QueueJob = JobView & { project: string; title?: string; options: Options; queuePosition?: number };

const FORMATS: [Format, string, string][] = [
  ["mp4", "MP4", "วิดีโอมาตรฐาน YouTube / TikTok"],
  ["webm", "WebM", "วิดีโอสำหรับเว็บ ไฟล์เล็ก"],
  ["gif", "GIF", "ภาพเคลื่อนไหว ไม่มีเสียง"],
  ["mp3", "MP3", "เฉพาะเสียง"],
  ["wav", "WAV", "เฉพาะเสียง คุณภาพเต็ม"],
];

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className={on ? "chip-on h-7" : "chip h-7"} onClick={onClick}>
    {children}
  </button>
);

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const name = useEditor((s) => s.name);
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline);
  const srtUrl = useEditor((s) => s.srtUrl);
  const setOutputs = useEditor((s) => s.setOutputs);
  const [o, setO] = useState<Options>({ format: "mp4", resolution: "1080p", quality: "standard" });
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const video = o.format === "mp4" || o.format === "webm" || o.format === "gif";
  const audioOnly = o.format === "mp3" || o.format === "wav";

  const refresh = useCallback(async () => {
    const list = await api<QueueJob[]>("/api/jobs");
    setJobs(list);
    // อัปเดตลิงก์วิดีโอของหน้าตัดต่อเมื่อไฟล์จริงเสร็จ
    const done = list.find((j) => j.project === name && j.status === "done" && j.options.format === "mp4" && j.options.resolution === "1080p" && !j.options.fps);
    if (done?.url) setOutputs({ videoUrl: done.url });
  }, [name, setOutputs]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const start = async () => {
    const st = useEditor.getState();
    if (!(await st.flush())) throw new Error("แก้ข้อผิดพลาดในบทก่อน");
    if (st.prep.status !== "ready") await st.prepareNow();
    if (useEditor.getState().prep.status !== "ready") throw new Error(useEditor.getState().prep.error ?? "เตรียมเสียงไม่สำเร็จ");
    await api(`/api/projects/${name}/export`, { method: "POST", body: o });
    toast("เพิ่มเข้าคิวแล้ว");
    await refresh();
  };

  const mine = jobs.filter((j) => j.project === name);
  const others = jobs.filter((j) => j.project !== name && (j.status === "running" || j.status === "queued"));
  const base = timeline ? Math.min(timeline.width, timeline.height) : 1080;
  const resLabel = (r: Options["resolution"]) => (r === "preview" ? `ตัวอย่าง (${Math.round(base / 2)}p)` : r === "4k" ? "4K" : r);

  return (
    <Modal title="ส่งออก" onClose={onClose} width={720}>
      <div className="space-y-4">
        <div>
          <div className="label">รูปแบบ</div>
          <div className="grid grid-cols-5 gap-2">
            {FORMATS.map(([f, label, hint]) => (
              <button
                key={f}
                onClick={() => setO({ ...o, format: f })}
                className={`rounded-lg border p-2 text-left ${o.format === f ? "border-accent bg-accent/10" : "border-line hover:border-line-strong"}`}
              >
                <div className="text-[13px] font-semibold">{label}</div>
                <div className="text-[10px] leading-tight text-muted">{hint}</div>
              </button>
            ))}
          </div>
        </div>

        {video && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label">ความละเอียด</div>
              <div className="flex flex-wrap gap-1.5">
                {(["preview", "720p", "1080p", "4k"] as const).map((r) => (
                  <Chip key={r} on={o.resolution === r} onClick={() => setO({ ...o, resolution: r })}>
                    {resLabel(r)}
                  </Chip>
                ))}
              </div>
              {o.format === "gif" && <div className="mt-1 text-[11px] text-faint">GIF ย่อไม่เกินครึ่ง และเก็บทุก 2 เฟรม เพื่อให้ไฟล์ไม่ใหญ่เกิน</div>}
            </div>
            {o.format !== "gif" && (
              <div>
                <div className="label">คุณภาพ</div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["draft", "ร่าง (เล็ก)"],
                      ["standard", "มาตรฐาน"],
                      ["high", "สูง (ใหญ่)"],
                    ] as const
                  ).map(([q, label]) => (
                    <Chip key={q} on={o.quality === q} onClick={() => setO({ ...o, quality: q })}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="label">เฟรมต่อวินาที</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip on={!o.fps} onClick={() => setO({ ...o, fps: undefined })}>
                  ตามโปรเจกต์ ({project.fps})
                </Chip>
                {([24, 30, 60] as const).map((f) => (
                  <Chip key={f} on={o.fps === f} onClick={() => setO({ ...o, fps: f })}>
                    {f}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 text-[12px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={o.subtitles ?? project.subtitles.enabled} onChange={(e) => setO({ ...o, subtitles: e.target.checked })} />
                ฝังซับไตเติลในภาพ
              </label>
              {o.format !== "gif" && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={o.normalize ?? project.mix.normalize} onChange={(e) => setO({ ...o, normalize: e.target.checked })} />
                  ปรับความดังมาตรฐาน ({project.mix.targetLufs} LUFS)
                </label>
              )}
            </div>
          </div>
        )}
        {audioOnly && (
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={o.normalize ?? project.mix.normalize} onChange={(e) => setO({ ...o, normalize: e.target.checked })} />
            ปรับความดังมาตรฐาน ({project.mix.targetLufs} LUFS)
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton className="btn-primary" onClick={start}>
            เพิ่มเข้าคิวส่งออก
          </AsyncButton>
          <span className="flex-1" />
          {srtUrl && (
            <>
              <a className="btn-ghost h-8" href={srtUrl} download>
                <Download size={14} /> ซับ .srt
              </a>
              <a className="btn-ghost h-8" href={srtUrl.replace(/\.srt(\?|$)/, ".vtt$1")} download>
                <Download size={14} /> ซับ .vtt
              </a>
            </>
          )}
          <a className="btn-ghost h-8" href={`/api/projects/${name}/bundle`} download title="ไฟล์โปรเจกต์พร้อมสื่อทั้งหมด ย้ายเครื่องหรือส่งต่อให้คนอื่นแก้ได้">
            <FileArchive size={14} /> ไฟล์โปรเจกต์ .katun
          </a>
        </div>

        <div className="border-t border-line pt-3">
          <div className="mb-2 text-[13px] font-semibold">คิวส่งออก</div>
          {mine.length === 0 && others.length === 0 ? (
            <div className="text-[12px] text-muted">ยังไม่มีงาน</div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {[...others, ...mine].map((j) => (
                <JobRow key={j.job_id} job={j} foreign={j.project !== name} onChange={refresh} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function describe(o: Options) {
  const fmt = o.format.toUpperCase();
  if (o.format === "mp3" || o.format === "wav") return `${fmt} เฉพาะเสียง`;
  return `${fmt} · ${o.resolution === "preview" ? "ตัวอย่าง" : o.resolution}${o.format !== "gif" ? ` · ${o.quality === "draft" ? "ร่าง" : o.quality === "high" ? "สูง" : "มาตรฐาน"}` : ""}${o.fps ? ` · ${o.fps}fps` : ""}`;
}

function JobRow({ job, foreign, onChange }: { job: QueueJob; foreign: boolean; onChange: () => Promise<void> }) {
  const pct = job.total ? Math.round(((job.rendered ?? 0) / job.total) * 100) : 0;
  const isMedia = job.options.format !== "mp3" && job.options.format !== "wav";
  return (
    <div className="rounded-lg bg-app/60 p-2.5">
      <div className="flex items-center gap-2 text-[12px]">
        {job.status === "running" && <Loader2 size={13} className="animate-spin text-accent" />}
        <span className="font-semibold">{describe(job.options)}</span>
        {foreign && <span className="text-faint">· {job.title}</span>}
        <span className="flex-1" />
        <span className={job.status === "done" ? "text-ok" : job.status === "failed" ? "text-danger" : "text-muted"}>
          {job.status === "queued"
            ? `รอคิวที่ ${job.queuePosition}`
            : job.status === "running"
              ? job.stage === "loudness"
                ? "ปรับความดัง…"
                : job.total
                  ? `${job.rendered}/${job.total} เฟรม`
                  : "กำลังเริ่ม…"
              : job.status === "done"
                ? `เสร็จใน ${job.elapsedSeconds} วิ`
                : job.status === "canceled"
                  ? "ยกเลิกแล้ว"
                  : "ล้มเหลว"}
        </span>
        {(job.status === "queued" || job.status === "running") && (
          <AsyncButton className="btn-icon h-6 w-6" title="ยกเลิก" onClick={async () => (await api(`/api/jobs/${job.job_id}/cancel`, { method: "POST" }), onChange())}>
            <X size={13} />
          </AsyncButton>
        )}
      </div>
      {job.status === "running" && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${job.stage === "loudness" ? 100 : pct}%` }} />
        </div>
      )}
      {job.status === "failed" && <div className="mt-1 max-h-16 overflow-auto text-[11px] whitespace-pre-wrap text-danger">{job.error}</div>}
      {job.status === "done" && job.url && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
          {job.loudness && <span className="text-muted">ความดัง {job.loudness.before.toFixed(1)} → {job.loudness.after.toFixed(1)} LUFS</span>}
          <span className="flex-1" />
          {isMedia && job.options.format !== "gif" && (
            <a className="btn-ghost h-6 px-2 text-[11px]" href={job.url} target="_blank" rel="noreferrer">
              ดู
            </a>
          )}
          <a className="btn h-6 px-2 text-[11px]" href={job.url} download>
            <Download size={12} /> ดาวน์โหลด
          </a>
          <AsyncButton className="btn-ghost h-6 px-2 text-[11px]" onClick={() => api(`/api/projects/${job.project}/open-folder`, { method: "POST" })}>
            <FolderOpen size={12} /> โฟลเดอร์
          </AsyncButton>
        </div>
      )}
    </div>
  );
}
