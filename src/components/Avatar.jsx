import { hueOf } from "../lib/format";

export default function Avatar({ seed, name, size = 44, online }) {
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full select-none items-center justify-center rounded-full font-semibold text-white"
        style={{ background: `hsl(${hueOf(seed || name || "?")} 45% 45%)`, fontSize: size * 0.42 }}
      >
        {letter}
      </div>
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500" title="online" />}
    </div>
  );
}
