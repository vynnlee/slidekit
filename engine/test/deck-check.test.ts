import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deckCheck, formatCheck } from "../deck-check";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const mk = (head: string, body: string, files: Record<string, number> = {}) => {
  const d = mkdtempSync(join(tmpdir(), "sk-dc-")); dirs.push(d);
  mkdirSync(join(d, "assets"));
  for (const [p, n] of Object.entries(files)) writeFileSync(join(d, p), Buffer.alloc(n, 1));
  writeFileSync(join(d, "index.html"), `<!doctype html><html lang="ko" data-slidekit="1"><head><meta charset="utf-8"><title>t</title><script type="application/json" id="deck-meta">{"title":"점검 덱","visibility":"password"}</script><link rel="stylesheet" href="../../engine/slidekit.css">${head}</head><body>${body}<script src="../../engine/slidekit.js"></script></body></html>`);
  return d;
};
const long = "가".repeat(900);

test("요약: 장 수, 공개 범위, 노트 없는 장과 긴 노트, 큰 이미지, 크기", () => {
  const d = mk("", `<section data-slide="cover"><h1>a</h1><aside data-notes>짧은 노트</aside></section><section data-slide="content"><h2>b</h2><img src="assets/big.png" alt=""></section><section data-slide="content"><h2>c</h2><aside data-notes>${long}</aside></section>`, { "assets/big.png": 500 * 1024, "assets/small.jpg": 10 });
  const c = deckCheck(d, "x");
  expect(c).toMatchObject({ deck: "x", title: "점검 덱", visibility: "password", slides: 3 });
  expect(c.notes.missing).toEqual([2]);
  expect(c.notes.long).toEqual([{ n: 3, chars: 900 }]);
  expect(c.largeImages.map((r) => r.rel)).toEqual(["assets/big.png"]);
  expect(c.size.estimatedBytes).toBe(c.size.htmlBytes + 500 * 1024); // 참조한 이미지만 센다
  expect(c.lint.errors).toBe(0);
  const text = formatCheck(c).join("\n");
  expect(text).toContain("3장, 비밀번호");
  expect(text).toContain("노트 없는 장 1개(2)");
  expect(text).toContain("800자를 넘는 노트 1개(3번 900자)");
  expect(text).toContain("assets/big.png");
});
test("색 대비: 엔진 기본값은 통과, 덱이 --sk-faint를 어둡게 덮으면 실패와 비율을 보인다", () => {
  const ok = deckCheck(mk("", `<section data-slide="cover"><h1>a</h1></section>`), "x");
  expect(ok.contrast.every((r) => r.level !== "fail" && r.level !== "?")).toBe(true);
  const bad = deckCheck(mk("<style>:root { --sk-faint: #5c5c62; --sk-accent: #222; }</style>", `<section data-slide="cover"><h1>a</h1></section>`), "x");
  const faint = bad.contrast.find((r) => r.name === "--sk-faint")!;
  expect(faint.level).toBe("fail");
  expect(faint.ratio!).toBeCloseTo(3.16, 1);
  expect(bad.contrast.find((r) => r.name === "--sk-accent")!.level).toBe("fail");
  expect(formatCheck(bad).join("\n")).toMatch(/WARN 대비\s+--sk-faint #5c5c62 위 #000 3\.1/);
});
test("노트가 하나도 없으면 따로 알린다", () => {
  const c = deckCheck(mk("", `<section data-slide="cover"><h1>a</h1></section><section data-slide="end"><h1>b</h1></section>`), "x");
  expect(c.notes.missing).toEqual([1, 2]);
  expect(formatCheck(c).join("\n")).toContain("노트가 하나도 없다");
});

test("외부 글꼴: link, @import, @font-face url을 찾아 WARN 글꼴로 알리고, 없으면 OK", () => {
  const body = `<section data-slide="cover"><h1>a</h1><aside data-notes>노트</aside></section>`;
  const d = mk(`<link rel="preconnect" href="https://fonts.gstatic.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR"><style>@import url("https://cdn.example.test/a.css"); @font-face { font-family: X; src: url(https://cdn.example.test/x.woff2) format("woff2"); }</style>`, body);
  const c = deckCheck(d, "f");
  expect(c.externalFonts).toEqual(["https://fonts.googleapis.com/css2?family=Noto+Sans+KR", "https://cdn.example.test/a.css", "https://cdn.example.test/x.woff2"]);
  const line = formatCheck(c).find((l) => /^(OK|WARN)\s+글꼴/.test(l))!;
  expect(line.startsWith("WARN")).toBe(true);
  expect(line).toContain("fonts.googleapis.com");
  expect(line).toContain("slidekit bundle f");
  const none = deckCheck(mk(`<link rel="stylesheet" href="../../engine/slidekit.css"><style>@font-face { font-family: L; src: url(font.woff2); }</style>`, body), "g");
  expect(none.externalFonts).toEqual([]);
  expect(formatCheck(none).find((l) => /^(OK|WARN)\s+글꼴/.test(l))!.startsWith("OK")).toBe(true);
});
