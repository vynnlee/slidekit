// deck.md 배포 보조(spec/DECK-MD-DEPLOY.md): alternate 링크 삽입과 발표자 노트 누출 검사. deploy.ts가 쓴다. 의존성 없음.
export const MD_MAX = 2 * 1024 * 1024; // KV에 올리는 deck.md의 상한

/** 올리는 HTML의 <head> 끝에 <link rel="alternate" type="text/markdown">를 넣는다(이미 있으면 그대로). 로컬 번들과 원본 덱에는 쓰지 않는다. */
export function withAlternate(html: string, deck: string): string {
  if (/<link\b[^>]*\brel=["']?alternate["']?[^>]*\btype=["']?text\/markdown/i.test(html) || /<link\b[^>]*\btype=["']?text\/markdown[^>]*\brel=["']?alternate/i.test(html)) return html;
  const i = html.search(/<\/head\s*>/i);
  if (i < 0) return html;
  return html.slice(0, i) + `<link rel="alternate" type="text/markdown" href="/${deck}/deck.md">` + html.slice(i);
}

const textOf = (s: string) => s.replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|blockquote|pre|tr)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** 번들 HTML의 발표자 노트(aside[data-notes]) 글이 md에 한 줄이라도 있으면 그 줄(80자까지)을 돌려준다. 8자 미만의 줄은 우연히 겹칠 수 있어 보지 않는다. */
export function notesLeak(html: string, md: string): string | null {
  const flat = squash(md);
  for (const m of html.matchAll(/<aside\b[^>]*\bdata-notes\b[^>]*>([\s\S]*?)<\/aside>/gi)) {
    for (const line of textOf(m[1]).split("\n")) {
      const t = squash(line);
      if (t.length >= 8 && flat.includes(t)) return t.slice(0, 80);
    }
  }
  return null;
}
