import { loadFont as chakra } from "@remotion/google-fonts/ChakraPetch";
import { loadFont as itim } from "@remotion/google-fonts/Itim";
import { loadFont as kanit } from "@remotion/google-fonts/Kanit";
import { loadFont as mali } from "@remotion/google-fonts/Mali";
import { loadFont as mitr } from "@remotion/google-fonts/Mitr";
import { loadFont as notoThai } from "@remotion/google-fonts/NotoSansThai";
import { loadFont as prompt } from "@remotion/google-fonts/Prompt";
import { loadFont as sarabun } from "@remotion/google-fonts/Sarabun";

// ฟอนต์ไทยจาก Google Fonts: Remotion รอให้โหลดเสร็จก่อนเรนเดอร์แต่ละเฟรม จึงได้ฟอนต์ถูกต้องทั้งพรีวิวและไฟล์ที่ส่งออก

const opts = (): { weights: ["400", "700"]; subsets: ("thai" | "latin")[] } => ({ weights: ["400", "700"], subsets: ["thai", "latin"] });
const loaders = {
  Kanit: () => kanit("normal", opts()),
  Prompt: () => prompt("normal", opts()),
  Sarabun: () => sarabun("normal", opts()),
  Mitr: () => mitr("normal", opts()),
  "Chakra Petch": () => chakra("normal", opts()),
  Itim: () => itim("normal", { subsets: ["thai", "latin"] }),
  Mali: () => mali("normal", opts()),
  "Noto Sans Thai": () => notoThai("normal", opts()),
};

export const FONT_NAMES = Object.keys(loaders) as (keyof typeof loaders)[];

const loaded = new Map<string, string>();

/** โหลดฟอนต์ครั้งแรกที่ใช้ แล้วคืนชื่อ font-family ที่ใช้ใน CSS (ไม่รู้จักฟอนต์ = ใช้ชื่อตามที่ให้มา) */
export function fontFamily(name: string): string {
  const key = name as keyof typeof loaders;
  if (!loaders[key]) return `"${name}", "Leelawadee UI", Tahoma, sans-serif`;
  if (!loaded.has(name)) loaded.set(name, loaders[key]().fontFamily);
  return `${loaded.get(name)}, "Leelawadee UI", Tahoma, sans-serif`;
}
