import { expect, test } from "bun:test";
import { join } from "node:path";

const run = (...args: string[]) => {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "app", "server.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

test("알 수 없는 하위 명령은 서버를 띄우지 않고 사용법과 가까운 명령을 알려 준다", () => {
  const r = run("nwe", "x");
  expect(r.code).toBe(1);
  expect(r.err).toContain("알 수 없는 명령: nwe");
  expect(r.err).toContain("new을 말한 것인가");
  expect(r.err).toContain("사용법: slidekit");
});
test("help와 --help는 사용법을 출력하고 종료 코드 0", () => {
  for (const a of ["help", "--help"]) { const r = run(a); expect(r.code).toBe(0); expect(r.out).toContain("lint <덱>"); }
});
test("new: 이름 규칙 위반은 입력값과 예시를, 인자 없음은 사용법을 보여 준다", () => {
  expect(run("new", "My Talk").err).toContain('이름 "My Talk"은 쓸 수 없다');
  expect(run("new").err).toContain("사용법: slidekit new <이름>");
});
test("lint와 bundle: 없는 덱이면 있는 덱 목록과 만드는 법을 알려 준다", () => {
  const l = run("lint", "no-such-deck-xyz");
  expect(l.code).toBe(1);
  expect(l.err).toContain("없는 덱: decks/no-such-deck-xyz");
  expect(l.err).toContain("slidekit new");
  const b = run("bundle", "no-such-deck-xyz");
  expect(b.code).toBe(1);
  expect(b.err).toContain("없는 덱");
});

test("new: author는 placeholder 문구 없이 git 사용자 이름이나 빈 값이고, lint를 통과한다", async () => {
  const { readFileSync, rmSync } = await import("node:fs");
  const dir = join(import.meta.dir, "..", "..", "decks", "qa-cli-author");
  try {
    expect(run("new", "qa-cli-author").code).toBe(0);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).not.toContain("이름을 여기에 적는다");
    expect(html).not.toContain("__AUTHOR__");
    expect(JSON.parse(html.match(/id="deck-meta">([\s\S]*?)<\/script>/)![1]).author).toBeString();
    expect(run("lint", "qa-cli-author").code).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lint는 출력과 종료 코드를 낸다(조용한 종료 회귀 방지)", () => {
  const ok = run("lint", "slidekit-guide");
  expect(ok.code).toBe(0);
  expect(ok.out).toContain("통과");
  const missing = run("lint", "no-such-deck-xyz");
  expect(missing.code).toBe(1);
  expect(missing.err).toContain("없는 덱");
});
test("앱 코드가 engine/lint를 먼저 import해 둔 프로세스에서도 lint 명령이 돈다", () => {
  const root = join(import.meta.dir, "..", "..");
  // 서버 모듈 그래프가 lint.ts를 정적으로 import하는 상황을 흉내 낸다: 먼저 import한 뒤 CLI 진입점을 연다.
  const r = Bun.spawnSync(["bun", "-e", `await import("./engine/lint.ts"); process.argv[2] = "slidekit-guide"; await import("./engine/lint-cli.ts");`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(r.stdout.toString()).toContain("통과");
  expect(r.exitCode).toBe(0);
});
test("layouts: 프리셋 목록을 사람 글과 JSON으로 낸다", () => {
  const t = run("layouts");
  expect(t.code).toBe(0);
  for (const id of ["title-body", "two-column", "big-number", "quote", "image-full"]) expect(t.out).toContain(id);
  const j = JSON.parse(run("layouts", "--json").out);
  expect(j.map((l: { id: string }) => l.id)).toEqual(["title-body", "two-column", "big-number", "quote", "image-full"]);
  expect(j.every((l: { html: string }) => l.html.startsWith("<section data-slide=\"content\""))).toBe(true);
});
