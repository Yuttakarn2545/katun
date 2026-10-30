import { Composition, type CalculateMetadataFunction } from "remotion";
import { SubtitleSchema, type Timeline } from "../../core/src/schema";
import { Video } from "./Video";

// ค่าจริงมาจาก --props=build/timeline.json ที่ core สร้างให้
const placeholder: Timeline = {
  title: "katun",
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 2,
  characters: { a: { name: "ตัวอย่าง", color: "#f4a261" } },
  scenes: [{ id: "s1", background: "#bde0fe", cast: ["a"], start: 0, duration: 2 }],
  lines: [],
  subtitles: SubtitleSchema.parse({}),
};

const calculateMetadata: CalculateMetadataFunction<Timeline> = ({ props }) => ({
  fps: props.fps,
  width: props.width,
  height: props.height,
  durationInFrames: Math.max(1, Math.ceil(props.duration * props.fps)),
});

export const Root: React.FC = () => (
  <Composition
    id="Main"
    component={Video}
    defaultProps={placeholder}
    calculateMetadata={calculateMetadata}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={60}
  />
);
