import { expect, test } from "bun:test";
import { formatLayout, injectedScript, parseLayoutResult } from "../layout-check";

const dom = (j: unknown) => `<html><body><pre id="sk-layout-result">${JSON.stringify(j).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}</pre></body></html>`;

test("결과 읽기: <pre>의 JSON을 읽고, 없거나 깨졌거나 형식이 틀리면 null", () => {
  const r = parseLayoutResult(dom({ slides: 3, issues: [{ slide: 2, kind: "outside", dx: 40, dy: 0, path: "div > p", text: "a<b" }, { slide: 9, kind: "weird", dx: 0, dy: 0, path: "", text: "" }] }));
  expect(r?.slides).toBe(3);
  expect(r?.issues.length).toBe(1); // 알 수 없는 kind는 버린다
  expect(r?.issues[0].text).toBe("a<b");
  expect(parseLayoutResult("<html></html>")).toBeNull();
  expect(parseLayoutResult('<pre id="sk-layout-result">{</pre>')).toBeNull();
  expect(parseLayoutResult(dom({ slides: "x", issues: [] }))).toBeNull();
});
test("doctor 줄: 문제 없음은 OK, 있으면 WARN과 슬라이드 번호와 상위 5건, 실패는 WARN 한 줄", () => {
  expect(formatLayout({ ok: true, result: { slides: 4, issues: [] } })[0]).toMatch(/^OK {3}넘침 .*4장/);
  const issues = Array.from({ length: 7 }, (_, i) => ({ slide: i + 1, kind: "outside" as const, dx: 10, dy: -20, path: "p", text: `t${i}` }));
  const out = formatLayout({ ok: true, result: { slides: 9, issues } });
  expect(out[0]).toMatch(/^WARN 넘침 .*7곳\(슬라이드 1, 2, 3, 4, 5, 6, 7\)/);
  expect(out.length).toBe(1 + 5 + 1);
  expect(out.at(-1)).toContain("2곳은 생략");
  expect(formatLayout({ ok: false, error: "Chrome를 찾지 못해" })).toEqual(["WARN 넘침     Chrome를 찾지 못해"]);
});
test("주입 스크립트는 findOverflow 소스를 담고 모든 단계를 보이게 한다", () => {
  const s = injectedScript("function findOverflow(s){return [];}");
  expect(s).toContain("function findOverflow");
  expect(s).toContain("data-sk-show-steps");
  expect(s).toContain("sk-layout-result");
});
