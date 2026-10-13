import { expect, test } from "bun:test";
import { lint } from "../lint";

const ok = `<!doctype html><html data-slidekit="1"><head><script type="application/json" id="deck-meta">{"title":"t","date":"2026-10-13"}</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>t</h1></section>
<section data-slide="chapter" data-title="장"><h1>장</h1><aside data-notes>노트</aside></section>
<section data-slide="end"><h1>끝</h1></section>
<script src="../../engine/slidekit.js"></script></body></html>`;
const rules = (h: string) => lint(h).filter((i) => i.level === "error").map((i) => i.rule);

test("정상 덱은 오류가 없다", () => expect(rules(ok)).toEqual([]));
test("어긴 샘플은 규칙별로 잡힌다", () => {
  const bad = (a: string, b: string) => rules(ok.replace(a, b));
  expect(bad(' data-slidekit="1"', "")).toContain("html");
  expect(bad('{"title":"t","date":"2026-10-13"}', "{깨짐")).toContain("deck-meta");
  expect(bad(' data-title="장"', "")).toContain("chapter");
  expect(bad('data-slide="cover"', 'data-slide="end"')).toContain("end");
  expect(bad("<h1>끝</h1>", "<h1>끝 — 감사</h1>")).toContain("chars");
  expect(bad("<h1>끝</h1>", "<h1>끝 \u{1F600}</h1>")).toContain("chars");
  expect(bad("<h1>끝</h1>", '<h1 style="width:100vw">끝</h1>')).toContain("units");
  expect(bad('data-slide="end"', 'data-slide="content" data-steps="3"')).toContain("steps");
  expect(bad("<body>", '<body><div id="stage">')).toContain("wrapper");
  expect(bad("노트</aside>", "노트</aside><aside data-notes>b</aside>")).toContain("notes");
  expect(bad("</body>", "<script>addEventListener('keydown',e=>{if(e.code==='Space')go()})</script></body>")).toContain("nav");
});
