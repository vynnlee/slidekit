// 커서는 이 표에서만 정한다(spec/INTERACTION.md 3절). 컴포넌트는 이름만 쓴다.
export const CURSOR = {
  default: "default",
  move: "move",
  text: "text",
  grab: "grab",
  grabbing: "grabbing",
  "resize-ns": "ns-resize",
  "resize-ew": "ew-resize",
  "resize-nwse": "nwse-resize",
  "resize-nesw": "nesw-resize",
  crosshair: "crosshair",
  "not-allowed": "not-allowed",
} as const;
export type CursorName = keyof typeof CURSOR;
export const cursorOf = (n: CursorName) => CURSOR[n];

// Tailwind가 클래스를 찾을 수 있게 글자로 적어 둔다.
export const CURSOR_CLASS: Record<CursorName, string> = {
  default: "cursor-default",
  move: "cursor-move",
  text: "cursor-text",
  grab: "cursor-grab",
  grabbing: "cursor-grabbing",
  "resize-ns": "cursor-ns-resize",
  "resize-ew": "cursor-ew-resize",
  "resize-nwse": "cursor-nwse-resize",
  "resize-nesw": "cursor-nesw-resize",
  crosshair: "cursor-crosshair",
  "not-allowed": "cursor-not-allowed",
};

/** 리사이즈 핸들 id(n, e, se 등)별 커서 이름 */
export const HANDLE_CURSOR: Record<string, CursorName> = {
  n: "resize-ns", s: "resize-ns", e: "resize-ew", w: "resize-ew",
  nw: "resize-nwse", se: "resize-nwse", ne: "resize-nesw", sw: "resize-nesw",
};
