// 텍스트 스타일 프리셋(Figma의 Text styles): 한 번에 글자 모양 속성 여섯 개를 인라인 style로 넣는다. 크기와 색은 덱 토큰 var()로 연결해
// 토큰(SPEC 4절의 --sk-fs-*, --sk-fg, --sk-muted, --sk-font*)을 바꾸면 따라 바뀐다. 위계는 큰 것부터 Title(h1), Heading(h2), Body, Caption(small), Code(mono)다.
export type TextStyle = { id: string; label: string; props: Record<string, string> };

const make = (id: string, label: string, size: string, weight: string, lh: string, ls: string, color: string, font = "var(--sk-font)"): TextStyle => ({
  id, label,
  props: { "font-family": font, "font-size": `var(${size})`, "font-weight": weight, "line-height": lh, "letter-spacing": ls, color: `var(${color})` },
});

export const TEXT_STYLES: TextStyle[] = [
  make("title", "Title", "--sk-fs-h1", "700", "1.1", "-0.02em", "--sk-fg"),
  make("heading", "Heading", "--sk-fs-h2", "700", "1.2", "-0.01em", "--sk-fg"),
  make("body", "Body", "--sk-fs-body", "400", "1.5", "0px", "--sk-fg"),
  make("caption", "Caption", "--sk-fs-small", "400", "1.4", "0px", "--sk-muted"),
  make("code", "Code", "--sk-fs-small", "400", "1.5", "0px", "--sk-fg", "var(--sk-font-mono)"),
];

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");
/** 인라인 style이 어느 프리셋과 모두 같은지(없으면 null) */
export function currentTextStyle(inline: (prop: string) => string): TextStyle | null {
  return TEXT_STYLES.find((t) => Object.entries(t.props).every(([k, v]) => norm(inline(k)) === norm(v))) ?? null;
}
