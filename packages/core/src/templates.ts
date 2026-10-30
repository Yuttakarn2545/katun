import type { z } from "zod";
import type { ProjectSchema } from "./schema.js";

// เทมเพลตเริ่มต้นสำหรับหน้าแรก (เสียงจะถูกเลือกตอนสร้าง ตามว่ามี Azure key หรือไม่)

type ProjectInput = z.input<typeof ProjectSchema>;
export type Template = {
  id: string;
  name: string;
  description: string;
  format: "16:9" | "9:16" | "1:1";
  build: () => Omit<ProjectInput, "title" | "format" | "voice">;
};

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "ว่าง",
    description: "ตัวละคร 1 ตัว ฉากเดียว",
    format: "16:9",
    build: () => ({
      characters: { nok: { name: "น้องนก", color: "#f4a261" } },
      scenes: [{ id: "scene1", background: "linear-gradient(#bde0fe, #e0fbfc)", lines: [{ character: "nok", text: "สวัสดีค่ะ" }] }],
    }),
  },
  {
    id: "dialogue",
    name: "บทสนทนา 2 ตัวละคร",
    description: "คุยกันสองคน เหมาะกับคลิปเล่าเรื่อง",
    format: "16:9",
    build: () => ({
      characters: {
        nok: { name: "น้องนก", color: "#f4a261" },
        mee: { name: "พี่หมี", color: "#8ecae6" },
      },
      scenes: [
        {
          id: "talk",
          background: "linear-gradient(#bde0fe, #e0fbfc)",
          lines: [
            { character: "nok", text: "พี่หมี วันนี้เราจะไปไหนกันดีคะ" },
            { character: "mee", text: "ไปสวนสาธารณะกันไหมครับ อากาศดีมากเลย" },
            { character: "nok", text: "ดีเลยค่ะ ไปกันเลย!" },
          ],
        },
      ],
    }),
  },
  {
    id: "kids-lesson",
    name: "สอนเด็ก (แนวตั้ง)",
    description: "ครูการ์ตูนสอนเรื่องสั้น ๆ สำหรับ TikTok / Reels",
    format: "9:16",
    build: () => ({
      characters: { teacher: { name: "ครูนก", color: "#90be6d" } },
      subtitles: { size: "large", position: "top" },
      scenes: [
        {
          id: "lesson",
          background: "linear-gradient(#fdffb6, #caffbf)",
          lines: [
            { character: "teacher", text: "สวัสดีค่ะเด็ก ๆ วันนี้เรามานับเลขกัน" },
            { character: "teacher", text: "หนึ่ง สอง สาม เก่งมากเลยค่ะ!" },
          ],
        },
      ],
    }),
  },
  {
    id: "product-review",
    name: "รีวิวสินค้า (แนวตั้ง)",
    description: "มาสคอตแนะนำสินค้า 3 จุดเด่น",
    format: "9:16",
    build: () => ({
      characters: { mascot: { name: "มาสคอต", color: "#cdb4db" } },
      subtitles: { size: "large" },
      scenes: [
        { id: "hook", background: "#ffe5ec", lines: [{ character: "mascot", text: "รู้ไหม สินค้าตัวนี้ดีกว่าที่คิดเยอะเลย!" }] },
        {
          id: "points",
          background: "#fff1e6",
          lines: [
            { character: "mascot", text: "ข้อแรก ใช้ง่ายมาก" },
            { character: "mascot", text: "ข้อสอง ราคาคุ้มค่า" },
            { character: "mascot", text: "ข้อสาม ส่งไวทันใจ" },
          ],
        },
      ],
    }),
  },
  {
    id: "bedtime-story",
    name: "นิทานก่อนนอน",
    description: "ผู้บรรยายกับตัวละคร บรรยากาศกลางคืน",
    format: "16:9",
    build: () => ({
      characters: {
        narrator: { name: "ผู้เล่า", color: "#a2d2ff" },
        rabbit: { name: "กระต่าย", color: "#ffc8dd" },
      },
      scenes: [
        {
          id: "night",
          background: "linear-gradient(#1d3557, #457b9d)",
          lines: [
            { character: "narrator", text: "กาลครั้งหนึ่ง ในป่าที่เงียบสงบ มีกระต่ายน้อยตัวหนึ่ง" },
            { character: "rabbit", text: "คืนนี้ดาวสวยจังเลย" },
          ],
        },
      ],
    }),
  },
];
