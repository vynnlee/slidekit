// 스타일 복사와 붙여넣기(Cmd+Alt+C, Cmd+Alt+V)가 다루는 속성. Inspector가 고치는 모양 속성만 있고 크기, 위치, 배치(width, translate, flex 등)는 뺐다.
// 값은 요소의 인라인 style에서만 읽고 쓴다(클래스가 주는 모양은 복사 대상이 아니다).
const SIDES = ["top", "right", "bottom", "left"];
export const STYLE_PROPS: string[] = [
  "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration-line", "text-transform",
  "background-color", "background-image", "opacity", "box-shadow",
  ...SIDES.flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  ...SIDES.map((s) => `padding-${s}`), ...SIDES.map((s) => `margin-${s}`),
];

/** 요소의 인라인 style에서 STYLE_PROPS에 든 속성만 모은다 */
export function readStyle(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of STYLE_PROPS) { const v = el.style.getPropertyValue(p); if (v) out[p] = v; }
  return out;
}

/** 값을 인라인 style에 적용한다. 빈 값은 그 속성을 지운다. */
export function writeStyle(el: HTMLElement, map: Record<string, string>) {
  for (const [p, v] of Object.entries(map)) { if (v) el.style.setProperty(p, v); else el.style.removeProperty(p); }
}
