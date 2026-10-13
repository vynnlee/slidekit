import { expect, test } from "bun:test";
import { deckFonts, familyNames } from "../src/lib/deck-fonts";

const head = (body: string) => `<!doctype html><html><head>${body}</head><body>`;

test("familyNames: 따옴표 제거, 일반 글꼴과 var() 제외", () => {
  expect(familyNames(`"Noto Sans KR", 'Apple SD Gothic Neo', system-ui, sans-serif`)).toEqual(["Noto Sans KR", "Apple SD Gothic Neo"]);
  expect(familyNames("var(--x), monospace")).toEqual([]);
});
test("@font-face, Google Fonts 링크, --sk-font 토큰에서 모은다(중복 제거, 주석 무시)", () => {
  const p = head(`
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&amp;family=JetBrains+Mono&display=swap">
    <style>
      /* @font-face { font-family: "Hidden"; } */
      @font-face { font-family: "Pretendard Variable"; src: url(./p.woff2); }
      @font-face { font-family: Local; src: url(l.woff2); }
      :root { --sk-font: "Noto Sans KR", system-ui; --sk-font-mono: "JetBrains Mono", monospace; --sk-accent: #fff; }
    </style>`);
  expect(deckFonts(p)).toEqual(["Pretendard Variable", "Local", "Noto Sans KR", "JetBrains Mono"]);
});
test("시스템 글꼴만 쓰는 덱은 빈 목록", () => {
  expect(deckFonts(head(`<style>:root { --sk-font: system-ui, sans-serif; }</style>`))).toEqual([]);
  expect(deckFonts("<html>")).toEqual([]);
});
