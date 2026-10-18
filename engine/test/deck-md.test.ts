import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deckMarkdown } from "../deck-md";
import { outline } from "../outline";
import { TEMPLATE_IDS, buildDeck } from "../templates";

const root = join(import.meta.dir, "..", "..");
const wrap = (sections: string, head = "") => `<!doctype html><html lang="ko" data-slidekit="1"><head><meta charset="utf-8"><title>T</title>${head}<script type="application/json" id="deck-meta">{"title":"제목","subtitle":"부제목","author":"작성자","date":"2026-10-18","lang":"ko"}</script></head><body>${sections}</body></html>`;
const git = (path: string) => { const g = Bun.spawnSync(["git", "show", `HEAD:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 }); return g.exitCode === 0 ? g.stdout.toString() : null; };

test("노트는 기본으로 새지 않는다: aside, 중첩, 주석, 메타 어디에도", () => {
  const html = wrap(`<section data-slide="content"><h2>A</h2><p>본문</p><aside data-notes>SECRETNOTE 하나</aside></section>
<section data-slide="content"><h2>B</h2><div><div><aside data-notes>SECRETNOTE 둘</aside></div></div><!-- SECRETCOMMENT --></section>`);
  const md = deckMarkdown(html);
  expect(md).not.toContain("SECRET");
  expect(md).not.toContain("Notes:");
  expect(deckMarkdown(html, { notes: false })).toBe(md);
  const withNotes = deckMarkdown(html, { notes: true });
  expect(withNotes).toContain("> Notes: SECRETNOTE 하나");
  expect(withNotes).toContain("SECRETNOTE 둘");
  expect(withNotes).not.toContain("SECRETCOMMENT"); // 주석은 어느 경우에도 없다
});

test("이미지: 로컬과 data:는 inline-image, http는 주소 유지, alt는 모두 남는다. 기본 outline은 그대로", () => {
  const html = wrap(`<section data-slide="content"><h2>I</h2><img src="assets/a b.png" alt="로컬 그림"><img src="data:image/png;base64,AAAA" alt="데이터"><img src="https://x.com/p.png" alt="원격"><img src="//cdn.x.com/q.png" alt=""></section>`);
  const md = deckMarkdown(html);
  expect(md).toContain("![로컬 그림](inline-image)");
  expect(md).toContain("![데이터](inline-image)");
  expect(md).toContain("![원격](https://x.com/p.png)");
  expect(md).toContain("![](//cdn.x.com/q.png)");
  expect(outline(html)).toContain("![로컬 그림](assets/a%20b.png)"); // 기본 모드는 경로 그대로
});

test("그림 자리표시자: svg는 제목, aria-label, 글자 순서로, video와 audio는 파일 이름, 숨김과 canvas는 제외", () => {
  const html = wrap(`<section data-slide="content"><h2>F</h2>
<svg><title>구조도</title><text>무시</text></svg>
<svg aria-label="라벨 그림"><rect/></svg>
<svg><text>글자1</text><text>글자2</text></svg>
<svg><rect/></svg>
<video src="media/데모 영상.mp4"></video><audio><source src="a/소리.mp3"></audio><canvas>CANVASTEXT</canvas>
<svg hidden><title>숨김</title></svg></section>`);
  const md = deckMarkdown(html);
  expect(md).toContain("[figure: 구조도]");
  expect(md).toContain("[figure: 라벨 그림]");
  expect(md).toContain("[figure: 글자1 글자2]");
  expect(md).toContain("[figure]");
  expect(md).toContain("[video: 데모 영상.mp4]");
  expect(md).toContain("[audio: 소리.mp3]");
  expect(md).not.toContain("CANVASTEXT");
  expect(md).not.toContain("숨김");
  expect(outline(html)).not.toContain("[figure"); // 기본 모드는 지금처럼 건너뛴다
});

test("표: 파이프 이스케이프와 colspan으로 열 수가 맞는다", () => {
  const html = wrap(`<section data-slide="content"><h2>T</h2><table><tr><th>이름</th><th colspan="2">값</th></tr><tr><td>a|b</td><td>1</td><td>2</td></tr></table></section>`);
  const rows = deckMarkdown(html).split("\n").filter((l) => l.startsWith("|"));
  expect(rows).toEqual(["| 이름 | 값 |  |", "| --- | --- | --- |", "| a\\|b | 1 | 2 |"]);
});

test("머리말: 제목, 부제, 작성자, 날짜, 언어. 슬라이드는 ## n. 제목", () => {
  const md = deckMarkdown(wrap(`<section data-slide="cover"><h1>표지</h1></section>`));
  expect(md.startsWith("# 제목\n\n> 부제목\n\n- Author: 작성자\n- Date: 2026-10-18\n- Language: ko\n\n## 1. 표지")).toBe(true);
});

test("구조: 목록(중첩, 번호), 코드, 인용, 링크, 강조, 단계 요소가 문서 순서대로 남는다", () => {
  const md = deckMarkdown(wrap(`<section data-slide="content"><h2>S</h2><ul><li>하나<ul><li>중첩</li></ul></li><li>둘</li></ul><ol start="3"><li>셋</li></ol>
<pre><code class="language-ts">const a = 1;</code></pre><blockquote>인용</blockquote><p data-step="2">단계 <a href="https://x.com">링크</a> <b>굵게</b></p></section>`));
  for (const piece of ["- 하나\n  - 중첩\n- 둘", "3. 셋", "```ts\nconst a = 1;\n```", "> 인용", "단계 [링크](https://x.com) **굵게**"]) expect(md).toContain(piece);
});

// 글 무손실: HTML의 보이는 글 단어(독립 추출)가 deck.md에 모두 있다
const words = (t: string) => t.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function htmlWords(html: string): string[] {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const t = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg|canvas|video|audio|footer|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<aside\b[^>]*data-notes[^>]*>[\s\S]*?<\/aside>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39|hellip);/g, (m, e) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", hellip: " " })[e as string] ?? m);
  return words(t);
}
const mdWords = (md: string) => {
  const body = md.slice(md.indexOf("\n## 1.")).replace(/^>\s*Notes:/gm, "");
  // 링크와 이미지의 주소 부분은 글이 아니다. 코드 펜스 안은 그대로 둔다(Markdown 예시 글이 `](` 모양을 가질 수 있다)
  return words(body.split(/(^```[\s\S]*?^```$)/m).map((part, i) => (i % 2 ? part : part.replace(/\]\([^)]*\)/g, "]"))).join(""));
};
const count = (ws: string[]) => { const m = new Map<string, number>(); for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1); return m; };

function lossless(name: string, html: string) {
  const a = count(htmlWords(html.slice(html.indexOf("<body")))), b = count(mdWords(deckMarkdown(html)));
  const missing: string[] = [];
  for (const [w, n] of a) if ((b.get(w) ?? 0) < n) missing.push(`${w}(${n}>${b.get(w) ?? 0})`);
  expect([name, missing.slice(0, 8)]).toEqual([name, []]);
}
test("글 무손실: 템플릿 3종과 커밋된 안내 덱과 워크숍 덱", () => {
  for (const id of TEMPLATE_IDS) lossless(`템플릿 ${id}`, buildDeck(id, { title: "샘플", date: "2026-10-18", author: "작성자", id: "s" }));
  for (const d of ["slidekit-guide", "vibe-coding-workshop"]) { const h = git(`decks/${d}/index.html`); if (h) lossless(d, h); }
});

test("실덱: 이미지 수가 같고 노트가 없으며 같은 입력은 같은 출력이고 100ms 안에 끝난다", () => {
  for (const d of ["slidekit-guide", "vibe-coding-workshop"]) {
    const h = git(`decks/${d}/index.html`); if (!h) continue;
    deckMarkdown(h); // 예열
    const t0 = performance.now(); const md = deckMarkdown(h); const ms = performance.now() - t0;
    expect(deckMarkdown(h)).toBe(md);
    expect(ms).toBeLessThan(100);
    expect(md).not.toContain("Notes:");
    const imgs = (h.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "").match(/<img\b/gi) ?? []).length;
    expect((md.match(/!\[/g) ?? []).length).toBe(imgs);
  }
});

// 번들러: dist/<덱>.md와 --alternate
const made: string[] = [];
afterAll(() => { for (const d of made) { rmSync(d, { recursive: true, force: true }); rmSync(join(root, "dist", d.split("/").pop() + ".html"), { force: true }); rmSync(join(root, "dist", d.split("/").pop() + ".md"), { force: true }); } });
test("bundle: dist/<덱>.md를 노트 없이 만들고, --alternate일 때만 번들에 alternate 링크를 넣는다", () => {
  const name = `_dmd-unit-${process.pid}`, dir = join(root, "decks", name);
  made.push(dir); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), `<!doctype html><html data-slidekit="1" lang="ko"><head><meta charset="utf-8"><title>b</title><link rel="stylesheet" href="../../engine/slidekit.css"><script type="application/json" id="deck-meta">{"title":"번들","id":"x"}</script></head><body><section data-slide="cover"><h1>표지</h1><img src="p.png" alt="그림"><aside data-notes>SECRETNOTE</aside></section><script src="../../engine/slidekit.js"></script></body></html>`);
  writeFileSync(join(dir, "p.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const run = (...a: string[]) => Bun.spawnSync(["bun", join(root, "bundler", "bundle.ts"), name, ...a], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(run().exitCode).toBe(0);
  const html0 = readFileSync(join(root, "dist", `${name}.html`), "utf8"), md = readFileSync(join(root, "dist", `${name}.md`), "utf8");
  expect(md).toContain("![그림](inline-image)");
  expect(md).not.toContain("SECRETNOTE");
  expect(html0).not.toContain('rel="alternate"');
  expect(run("--alternate", "deck.md").exitCode).toBe(0);
  const html1 = readFileSync(join(root, "dist", `${name}.html`), "utf8");
  expect(html1).toContain('<link rel="alternate" type="text/markdown" href="deck.md">');
  expect(html1.replace(/\n  <link rel="alternate"[^>]*>/, "")).toBe(html0); // 링크 한 줄 말고는 같다
  expect(run("--alternate", "http://x.com/a.md").exitCode).toBe(1); // 상대 파일 이름만
  expect(existsSync(join(root, "dist", `${name}.md`))).toBe(true);
});
