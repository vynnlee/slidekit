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

test("속성 안의 >와 생략된 닫는 태그에도 거짓 오류가 없다", () => {
  const h = ok.replace('data-title="장"', 'data-title="A > B"').replace("<h1>장</h1>", "<h1>A > B</h1><ul><li>a<li>b</ul><p>열린 문단");
  expect(rules(h)).toEqual([]);
});

test("data-step: 정수 2 이상만 허용, 번호의 빈칸은 정상(런타임이 압축)", () => {
  const slide = (body: string) => ok.replace("<h1>끝</h1>", body);
  const lintOf = (h: string) => lint(h);
  expect(lintOf(slide('<h1 data-step="2">a</h1><p data-step="3">b</p>')).filter((i) => i.rule === "data-step")).toEqual([]);
  expect(rules(slide('<h1 data-step="1">a</h1>'))).toContain("data-step");
  expect(rules(slide('<h1 data-step="x">a</h1>'))).toContain("data-step");
  expect(rules(slide('<h1 data-step="2.5">a</h1>'))).toContain("data-step");
  expect(lintOf(slide('<h1 data-step="2">a</h1><p data-step="4">b</p>')).filter((i) => i.rule === "data-step")).toEqual([]); // v2: 빈칸 경고 없음
  expect(rules(slide('<h1 data-step="4e0">a</h1>'))).toContain("data-step"); // 엄격한 숫자 문법
  expect(rules(slide('<h1 data-step="2">a</h1><p data-step="4">b</p>'))).not.toContain("data-step");
});

test("덱 스크립트의 네트워크 호출은 경고(fetch, XMLHttpRequest, WebSocket, /api/)", () => {
  const withJs = (js: string) => ok.replace("</body>", `<script>${js}</script></body>`);
  for (const js of ["fetch('/x')", "new XMLHttpRequest()", "new WebSocket('ws://x')", "new EventSource('/e')", "const u = '/api/decks'"]) {
    const w = lint(withJs(js)).filter((i) => i.rule === "network");
    expect(w.length, js).toBe(1);
    expect(w[0].level).toBe("warn");
  }
  expect(lint(withJs("const a = 1; // fetched later")).filter((i) => i.rule === "network")).toEqual([]);
});

test("예제 문구가 남은 덱은 placeholder 경고(템플릿 문구, 제목/내용 새 슬라이드), 실제 문구는 경고 없음", () => {
  const withBody = (b: string) => ok.replace("</body>", `${b}</body>`);
  const w = (h: string) => lint(h).filter((i) => i.rule === "placeholder");
  expect(w(ok)).toEqual([]);
  expect(w(withBody('<section data-slide="content"><h2>핵심 문장 하나</h2></section>')).length).toBe(1);
  expect(w(withBody('<section data-slide="content"><h2>제목</h2>\n<p>내용</p></section>')).length).toBe(1);
  expect(w(ok.replace('"title"', '"title": "제목을 여기에 적는다", "x"')).length).toBe(1);
  expect(w(withBody('<!-- 핵심 문장 하나 --><section data-slide="content"><h2>실제 제목</h2></section>'))).toEqual([]);
});

test("data-layout은 지원이 끝났다: 경고 한 줄(오류 아님)로 알리고 값이 무엇이든 같다", () => {
  const w = (b: string) => lint(ok.replace("</body>", `${b}</body>`)).filter((i) => i.rule === "layout");
  for (const v of ["two-column", "quote", "nope"]) {
    const r = w(`<section data-slide="content" data-layout="${v}"><h2>x</h2></section>`);
    expect(r.length, v).toBe(1);
    expect(r[0].level).toBe("warn");
    expect(r[0].msg).toContain("지원이 끝났다");
  }
  expect(w('<section data-slide="content"><h2>x</h2></section>')).toEqual([]);
});

test("img에 alt가 없으면 경고, alt=\"\"(장식)는 통과", () => {
  const w = (b: string) => lint(ok.replace("</body>", `${b}</body>`)).filter((i) => i.rule === "img-alt");
  expect(w('<section data-slide="content"><img src="a.png"></section>').length).toBe(1);
  expect(w('<section data-slide="content"><img src="a.png"><img src="b.png" alt="설명"></section>')[0].msg).toContain("1개");
  expect(w('<section data-slide="content"><img src="a.png" alt=""><img src="b.png" alt="설명"></section>')).toEqual([]);
});

test("data-step-out: 정수가 아니거나 2 미만이면 오류, 등장 이하면 오류, blur 3개 이상 경고, 단계 요소가 있으면 data-steps만으로도 오류 아님", () => {
  const w = (b: string, rule: string) => lint(ok.replace("</body>", `${b}</body>`)).filter((i) => i.rule === rule);
  const sec = (inner: string, attrs = "") => `<section data-slide="content"${attrs}><h2>x</h2>${inner}</section>`;
  expect(w(sec('<p data-step-out="abc">a</p>'), "data-step-out")[0]?.level).toBe("error");
  expect(w(sec('<p data-step-out="1">a</p>'), "data-step-out")[0]?.level).toBe("error");
  expect(w(sec('<p data-step-out="2.5">a</p>'), "data-step-out")[0]?.level).toBe("error");
  expect(w(sec('<p data-step="3" data-step-out="3">a</p>'), "data-step-out")[0]?.level).toBe("error");
  expect(w(sec('<p data-step="3" data-step-out="2">a</p>'), "data-step-out")[0]?.level).toBe("error");
  expect(w(sec('<p data-step="2" data-step-out="3">a</p>'), "data-step-out")).toEqual([]);
  expect(w(sec('<p data-step-out="3">a</p>'), "data-step-out")).toEqual([]); // 등장 없이 퇴장만
  expect(w(sec('<p data-step="2">a</p><p data-step-out="4">b</p>'), "data-step")).toEqual([]); // 번호의 빈칸은 정상
  expect(w(sec('<p data-step="2" data-step-effect="blur">a</p><p data-step="2" style="--sk-away-blur:8px">b</p><p data-step="3" data-step-effect="blur">c</p>'), "step-blur").length).toBe(1);
  expect(w(sec('<p data-step="2" data-step-effect="blur">a</p>'), "step-blur")).toEqual([]);
  const st = lint(ok.replace("</body>", `${sec('<p data-step="2">a</p>', ' data-steps="4"')}</body>`)).filter((i) => i.rule === "steps");
  expect(st.map((i) => i.level)).toEqual(["warn"]); // 단계 요소가 있으면 data-steps는 무시된다(오류 아님)
  expect(lint(ok.replace("</body>", `${sec("<p>a</p>", ' data-steps="3"')}</body>`)).filter((i) => i.rule === "steps").length).toBeGreaterThan(0);
});

test("단계 시간 변수: 단위와 범위(0~10000ms)와 쓰이지 않는 퇴장 값", () => {
  const w = (style: string, attrs = 'data-step="2"') => lint(ok.replace("</body>", `<section data-slide="content"><h2>x</h2><p ${attrs} style="${style}">a</p></section></body>`)).filter((i) => i.rule === "step-time" || i.rule === "step-out-vars");
  expect(w("--sk-step-ms:360ms;--sk-step-delay:0.2s")).toEqual([]);
  expect(w("--sk-step-ms:360").map((i) => i.level)).toEqual(["error"]); // 단위 없음
  expect(w("--sk-step-delay:-5ms").map((i) => i.level)).toEqual(["error"]);
  expect(w("--sk-out-ms:11s", 'data-step="2" data-step-out="3"').map((i) => i.level)).toEqual(["error"]);
  expect(w("--sk-out-ms:300ms").map((i) => [i.rule, i.level])).toEqual([["step-out-vars", "warn"]]); // data-step-out이 없다
});
