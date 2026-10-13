// 이 덱이 선언한 글꼴 이름을 모은다. 편집기 Typography의 font family 후보 맨 위에 보여 준다.
// 출처: 덱 CSS의 @font-face(font-family), Google Fonts `<link>`의 family 쿼리, `--sk-font` 계열 토큰의 첫 글꼴 이름.
// 입력은 덱 prefix(첫 슬라이드 앞까지)면 충분하다. 시스템 글꼴 이름은 돌려주지 않는다.
import { readTokens } from "./deck-tokens";

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-monospace", "ui-sans-serif", "ui-serif", "ui-rounded", "emoji", "math", "inherit", "initial", "unset"]);
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "").trim();

/** font-family 값 하나에서 이름 목록: `"Noto Sans KR", system-ui` -> ["Noto Sans KR"] (일반 글꼴 이름 제외) */
export function familyNames(value: string): string[] {
  return value.split(",").map(unquote).filter((n) => n && !GENERIC.has(n.toLowerCase()) && !/^var\(/.test(n));
}

export function deckFonts(prefix: string): string[] {
  const out = new Set<string>();
  const css = [...prefix.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  for (const m of css.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
    const f = /font-family\s*:\s*([^;}]+)/i.exec(m[1])?.[1];
    if (f) familyNames(f).forEach((n) => out.add(n));
  }
  for (const m of prefix.matchAll(/<link\b[^>]*href=["']([^"']*fonts\.googleapis\.com\/css2?[^"']*)["']/gi)) {
    try { for (const f of new URL(m[1].replace(/&amp;/g, "&")).searchParams.getAll("family")) out.add(f.split(":")[0].replace(/\+/g, " ")); } catch { /* 깨진 링크는 무시 */ }
  }
  for (const [name, value] of Object.entries(readTokens(prefix))) if (/^--sk-font(-mono)?$/.test(name)) familyNames(value).forEach((n) => out.add(n));
  return [...out];
}
