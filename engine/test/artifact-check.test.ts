import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { artifactCheck, artifactIssues, formatArtifact } from "../artifact-check";

const root = join(import.meta.dir, "..", "..");
const made: string[] = [];
let n = 0;
/** 덱 폴더 하나를 decks/_art-unit-N에 만든다(엔진을 상대 경로로 읽으므로 저장소 안에 둔다). */
function deck(body: string, o: { head?: string; scripts?: string; files?: Record<string, string | Buffer> } = {}) {
  const dir = join(root, "decks", `_art-unit-${process.pid}-${n++}`);
  made.push(dir); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), `<!doctype html><html data-slidekit="1" lang="ko"><head><meta charset="utf-8">${o.head ?? ""}<link rel="stylesheet" href="../../engine/slidekit.css"></head><body><section data-slide="cover"><h1>t</h1>${body}</section>${o.scripts ?? ""}<script src="../../engine/slidekit.js"></script></body></html>`);
  for (const [f, c] of Object.entries(o.files ?? {})) writeFileSync(join(dir, f), c);
  return dir;
}
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const lv = (dir: string, opts = {}) => Object.fromEntries(artifactCheck(dir, opts).checks.map((c) => [c.id, c.level]));

test("정상 덱은 전부 OK이고 올릴 수 있다", () => {
  const r = artifactCheck(deck('<p>hi</p><a href="https://example.com">링크</a><svg xmlns="http://www.w3.org/2000/svg"></svg><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'));
  expect(r.checks.map((c) => c.level)).toEqual(["OK", "OK", "OK", "OK", "OK"]);
  expect(r.ok).toBe(true);
  expect(formatArtifact(r).at(-1)).toBe("Artifact로 올릴 수 있음");
});

test("storage: localStorage, sessionStorage, indexedDB, cookie, on* 속성은 FAIL, 주석과 JSON 스크립트는 통과", () => {
  for (const code of ["localStorage.setItem('a','1')", "sessionStorage.x", "indexedDB.open('d')", "document.cookie = 'a=1'", "window.caches.open('c')"])
    expect(lv(deck("", { scripts: `<script>${code}</script>` })).storage).toBe("FAIL");
  expect(lv(deck('<p onclick="localStorage.clear()">x</p>')).storage).toBe("FAIL");
  expect(lv(deck("", { scripts: "<script>// localStorage 쓰지 않는다\n/* sessionStorage */ var a = 1;</script>" })).storage).toBe("OK");
  expect(lv(deck("", { scripts: '<script type="application/json">{"k":"localStorage"}</script>' })).storage).toBe("OK");
  const r = artifactCheck(deck("", { scripts: "<script>\nvar a=1;\nlocalStorage.x=1;\n</script>" }));
  expect(r.checks.find((c) => c.id === "storage")!.items[0]).toMatch(/index\.html:\d+\)/); // 줄 번호를 보여 준다
});

test("network: fetch, XHR, WebSocket, EventSource, sendBeacon, 동적 import는 FAIL(상대 경로 fetch도)", () => {
  for (const code of ["fetch('./a.json')", "new XMLHttpRequest()", "new WebSocket('wss://x')", "new EventSource('/e')", "navigator.sendBeacon('/b')", "import('./m.js')"])
    expect(lv(deck("", { scripts: `<script>${code}</script>` })).network).toBe("FAIL");
  expect(lv(deck("", { scripts: "<script>var fetchLater = 1; var prefetched = 2;</script>" })).network).toBe("OK"); // 단어 일부는 아니다
});

test("hosts: 자원 속성의 외부 주소는 FAIL, a href와 xmlns와 data:는 통과, 글꼴 CSP 호스트는 글꼴 CSS에만 허용", () => {
  const h = (body: string, head = "", opts = {}) => lv(deck(body, { head }), opts).hosts;
  expect(h('<img src="https://example.com/a.png" alt="">')).toBe("FAIL");
  expect(h('<img srcset="https://a.com/a.png 1x" alt="">')).toBe("FAIL");
  expect(h('<iframe src="https://x.com"></iframe>')).toBe("FAIL");
  expect(h('<video poster="//cdn.x.com/p.jpg"></video>')).toBe("FAIL");
  expect(h("", '<style>.a{background:url(https://x.com/a.png)}</style>')).toBe("FAIL");
  expect(h("", '<script src="https://cdn.jsdelivr.net/npm/x.js"></script>')).toBe("FAIL"); // 스크립트는 글꼴 호스트여도 안 된다
  expect(h("", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR">')).toBe("OK");
  expect(h("", '<style>@import url("https://fonts.googleapis.com/css2?family=X");</style>')).toBe("OK");
  expect(h("", '<link rel="stylesheet" href="https://fonts.example.com/css">')).toBe("FAIL");
  expect(h("", '<link rel="stylesheet" href="https://fonts.example.com/css">', { allowHosts: ["fonts.example.com"] })).toBe("OK");
  expect(h("", '<!-- <img src="https://x.com/a.png"> -->')).toBe("OK"); // 주석 안
});

test("bundle: 없는 파일, 덱 폴더 밖, 번들러가 안 담는 iframe 로컬 파일은 FAIL", () => {
  expect(lv(deck('<img src="nope.png" alt="">')).bundle).toBe("FAIL");
  expect(lv(deck('<img src="../../deploy/deploy.ts" alt="">')).bundle).toBe("FAIL");
  expect(lv(deck('<img src="../../.env" alt="">')).bundle).toBe("FAIL");
  expect(lv(deck('<iframe src="x.html"></iframe>', { files: { "x.html": "<p>x</p>" } })).bundle).toBe("FAIL");
  expect(lv(deck('<img src="a.png" alt="">', { files: { "a.png": Buffer.from([1, 2, 3]) } })).bundle).toBe("OK");
});

test("size: 예상 크기가 16 MiB를 넘으면 FAIL, 12 MiB 이상이면 WARN, 큰 덱도 0.5초 안에 검사한다", () => {
  const big = (mb: number) => deck('<img src="b.png" alt="">', { files: { "b.png": Buffer.alloc(mb * 1024 * 1024) } });
  const t0 = performance.now();
  expect(lv(big(13)).size).toBe("FAIL"); // 13 MiB x 4/3 = 17.3 MiB
  expect(lv(big(9.5 as unknown as number)).size).toBe("WARN"); // 12.7 MiB
  expect(lv(big(2)).size).toBe("OK");
  expect(performance.now() - t0).toBeLessThan(1500); // 세 덱을 만들고 쓰는 시간 포함
  const d = big(13); const t1 = performance.now(); artifactCheck(d); expect(performance.now() - t1).toBeLessThan(500);
});

test("요약: FAIL이 있으면 올릴 수 없음과 이유, issues는 artifact-* error", () => {
  const dir = deck("", { scripts: "<script>localStorage.x=1; fetch('/a')</script>" });
  const r = artifactCheck(dir);
  expect(r.ok).toBe(false);
  const last = formatArtifact(r).at(-1)!;
  expect(last).toContain("Artifact로 올릴 수 없음");
  expect(last).toContain("브라우저 저장소");
  expect(last).toContain("외부로 나가는 요청");
  expect(artifactIssues(dir).map((i) => [i.level, i.rule]).sort()).toEqual([["error", "artifact-network"], ["error", "artifact-storage"]]);
});

test("엔진 파일은 저장소, 네트워크 식별자와 외부 주소가 없다(번들이 청정하다)", () => {
  for (const f of ["slidekit.js", "slidekit.css", "template/shell.html"]) {
    const text = readFileSync(join(root, "engine", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(text).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
    expect(text.replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, "")).not.toMatch(/https?:\/\//);
  }
});

test("시험용 덱 둘은 정적 검사를 통과한다", () => {
  const { makeTestDeck } = createRequire(import.meta.url)("../../scripts/lib/test-deck.cjs");
  for (const from of ["guide", "sample"]) {
    const t = makeTestDeck(`art-${from.slice(0, 5)}`, from);
    try {
      const r = artifactCheck(t.dir);
      expect([from, r.reasons]).toEqual([from, []]);
    } finally { t.cleanup(); }
  }
});

test("CLI: doctor --artifact와 lint --artifact의 출력과 종료 코드, --json", () => {
  const ok = deck("<p>x</p>"), bad = deck("", { scripts: "<script>fetch('/a')</script>" });
  const run = (...a: string[]) => { const r = Bun.spawnSync(["bun", join(root, "app", "server.ts"), ...a], { stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };
  const nm = (d: string) => d.split("/").pop()!;
  const a = run("doctor", nm(ok), "--artifact");
  expect(a.code).toBe(0); expect(a.out).toContain("Artifact로 올릴 수 있음");
  const b = run("doctor", nm(bad), "--artifact");
  expect(b.code).toBe(1); expect(b.out).toContain("Artifact로 올릴 수 없음"); expect(b.out).toContain("fetch(");
  const j = JSON.parse(run("doctor", nm(bad), "--artifact", "--json").out);
  expect(j.ok).toBe(false); expect(j.checks.map((c: { id: string }) => c.id)).toEqual(["bundle", "hosts", "size", "storage", "network"]);
  expect(run("lint", nm(bad)).out).not.toContain("artifact-");
  const l = run("lint", nm(bad), "--artifact");
  expect(l.code).toBe(1); expect(l.out).toContain("error artifact-network");
  expect(run("lint", nm(ok), "--artifact").out).not.toContain("artifact-"); // 다른 lint 오류는 이 시험의 관심 밖
});
