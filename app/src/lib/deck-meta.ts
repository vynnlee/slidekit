// #deck-meta를 읽고 고치는 순수 함수. 편집기(shell.prefix)와 서버(PATCH /api/decks/:folder/meta)가 같은 구현을 쓴다.
// 스키마와 검증은 engine/deck-meta.ts(순수 모듈) 하나다. 비밀번호는 어떤 경로로도 덱에 들어가지 않는다.
import { applyPatch, validatePatch, type MetaIssue } from "../../../engine/deck-meta";

export type DeckMeta = Record<string, unknown>;
export type { MetaIssue };

const RE = /(<script[^>]*id="deck-meta"[^>]*>)([\s\S]*?)(<\/script>)/;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// <script> 안에 JSON을 넣을 때 </script>로 빠져나가거나 줄 구분자로 깨지지 않게 <, U+2028, U+2029를 이스케이프한다(JSON.parse는 그대로 복원한다).
export const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** HTML(또는 head 조각)의 deck-meta 객체. 없거나 깨졌으면 null. */
export function readMeta(html: string): DeckMeta | null {
  const m = html.match(RE);
  if (!m) return null;
  try { const v = JSON.parse(m[2]); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** 변경분을 검증해 적용한 새 HTML. title이 바뀌면 <title>도 같이 바꾼다(표지 h1은 건드리지 않는다). */
export function setMeta(html: string, patch: unknown): { ok: true; html: string; meta: DeckMeta } | { ok: false; issues: MetaIssue[] } {
  const issues = validatePatch(patch);
  if (issues.length) return { ok: false, issues };
  const meta = readMeta(html);
  if (!meta) return { ok: false, issues: [{ field: "", code: "no-meta", msg: "This deck has no readable deck-meta block." }] };
  const next = applyPatch(meta, patch as Record<string, unknown>);
  let out = html.replace(RE, (_, a, _b, c) => `${a}\n    ${safeJson(next)}\n  ${c}`);
  if (typeof next.title === "string" && next.title !== meta.title) out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(next.title as string)}</title>`);
  if ("lang" in (patch as object)) { // 접근성: <html lang>도 같은 값으로 맞춘다(지우면 기본값 ko)
    const lang = typeof next.lang === "string" ? next.lang : "ko";
    out = out.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => (/\blang=(["'])[^"']*\1/i.test(attrs) ? `<html${attrs.replace(/\blang=(["'])[^"']*\1/i, `lang="${lang}"`)}>` : `<html lang="${lang}"${attrs}>`));
  }
  return { ok: true, html: out, meta: next };
}
