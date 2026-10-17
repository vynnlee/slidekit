import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { buildDeck } from "../templates";

// 실제 덱(사용자가 고치거나 옮길 수 있다)이 아니라 템플릿으로 만든 덱 하나를 쓴다.
const FIX = "_cli-fixture", fixDir = join(import.meta.dir, "..", "..", "decks", FIX);
mkdirSync(fixDir, { recursive: true });
writeFileSync(join(fixDir, "index.html"), buildDeck("talk", { title: "샘플", date: "2026-10-15", author: "작성자", id: "cli-fixture" }));
process.on("exit", () => rmSync(fixDir, { recursive: true, force: true }));

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
  const ok = run("lint", FIX);
  expect(ok.code).toBe(0);
  expect(ok.out).toContain("통과");
  const missing = run("lint", "no-such-deck-xyz");
  expect(missing.code).toBe(1);
  expect(missing.err).toContain("없는 덱");
});
test("앱 코드가 engine/lint를 먼저 import해 둔 프로세스에서도 lint 명령이 돈다", () => {
  const root = join(import.meta.dir, "..", "..");
  // 서버 모듈 그래프가 lint.ts를 정적으로 import하는 상황을 흉내 낸다: 먼저 import한 뒤 CLI 진입점을 연다.
  const r = Bun.spawnSync(["bun", "-e", `await import("./engine/lint.ts"); process.argv[2] = "${FIX}"; await import("./engine/lint-cli.ts");`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(r.stdout.toString()).toContain("통과");
  expect(r.exitCode).toBe(0);
});
test("new --template: 템플릿마다 lint 종료 코드 0과 placeholder 경고, 첫 슬라이드는 표지, 알 수 없는 id는 목록을 보여 준다", async () => {
  const { readFileSync, rmSync } = await import("node:fs");
  const { TEMPLATE_IDS } = await import("../templates");
  expect(TEMPLATE_IDS).toEqual(["talk", "blank", "workshop"]);
  for (const id of TEMPLATE_IDS) {
    const name = `qa-cli-tpl-${id}`, dir = join(import.meta.dir, "..", "..", "decks", name);
    try {
      expect(run("new", name, "--template", id).code, id).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect(html.match(/<section data-slide="(\w+)"/)![1], id).toBe("cover");
      expect(html.match(/<h1>([^<]*)<\/h1>/)![1], id).toBe("제목을 여기에 적는다"); // 앱의 제목 설정이 첫 h1을 바꾼다
      expect(html).not.toContain("__SLIDES__");
      const l = run("lint", name);
      expect(l.code, id).toBe(0);
      expect(l.out, id).toContain("warn placeholder");
      expect(l.out.split("\n").filter((x) => x.startsWith("warn") || x.startsWith("error")).every((x) => x.startsWith("warn placeholder")), l.out).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const bad = run("new", "qa-cli-tpl-bad", "--template", "nope");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("talk, blank, workshop");
  const noval = run("new", "qa-cli-tpl-bad", "--template");
  expect(noval.code).toBe(1);
});
test("templates: 목록을 사람 글과 JSON으로 낸다", () => {
  const t = run("templates");
  expect(t.code).toBe(0);
  for (const id of ["talk", "blank", "workshop"]) expect(t.out).toContain(id);
  const j = JSON.parse(run("templates", "--json").out);
  expect(j.map((x: { id: string; default: boolean }) => [x.id, x.default])).toEqual([["talk", true], ["blank", false], ["workshop", false]]);
});

test("pdf 옵션 오류: --notes와 --handout 동시, 쪽당 장 수는 2, 3, 4, 6만(브라우저를 띄우기 전에 거부)", () => {
  const both = run("pdf", FIX, "--notes", "--handout");
  expect(both.code).toBe(1);
  expect(both.err).toContain("함께 쓸 수 없다");
  const bad = run("pdf", FIX, "--handout", "5");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("2, 3, 4, 6");
  expect(run("pdf").err).toContain("--notes");
});

test("image: 덱 assets/에 저장하고 상대 경로를 출력, 잘못된 입력은 종료 코드 1", async () => {
  const { readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const name = "qa-cli-image", deckDir = join(import.meta.dir, "..", "..", "decks", name), tmp = mkdtempSync(join(tmpdir(), "sk-img-"));
  try {
    expect(run("new", name).code).toBe(0);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==", "base64");
    writeFileSync(join(tmp, "My Photo.PNG"), png);
    const ok = run("image", name, join(tmp, "My Photo.PNG"));
    expect(ok.code).toBe(0);
    expect(ok.out.trim().split("\n").at(-1)).toBe("assets/my-photo.png");
    expect(existsSync(join(deckDir, "assets", "my-photo.png"))).toBe(true);
    expect(run("image", name, join(tmp, "My Photo.PNG")).out.trim().split("\n").at(-1)).toBe("assets/my-photo-2.png");
    writeFileSync(join(tmp, "x.exe"), "MZ");
    expect(run("image", name, join(tmp, "x.exe")).code).toBe(1);
    writeFileSync(join(tmp, "evil.png"), "<html><script>1</script>");
    expect(run("image", name, join(tmp, "evil.png")).err).toContain("내용이 확장자");
    expect(run("image", "no-such-deck-xyz", join(tmp, "My Photo.PNG")).code).toBe(1);
    expect(run("image", name, join(tmp, "missing.png")).code).toBe(1);
    expect(run("image", "../x", join(tmp, "My Photo.PNG")).code).toBe(1);
    expect(run("image").err).toContain("사용법");
    expect(readFileSync(join(deckDir, "assets", "my-photo.png")).length).toBe(png.length);
  } finally { rmSync(deckDir, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

test("doctor <덱>: 덱 점검 요약과 종료 코드, 없는 덱은 목록과 종료 코드 1", () => {
  const ok = run("doctor", FIX);
  expect(ok.code).toBe(0);
  expect(ok.out).toContain(`덱 ${FIX}`);
  for (const k of ["lint", "크기", "이미지", "노트", "대비"]) expect(ok.out).toContain(k);
  const no = run("doctor", "no-such-deck-xyz");
  expect(no.code).toBe(1);
  expect(no.err).toContain("있는 덱");
});

test("outline: 덱을 Markdown으로 출력하고 노트는 --notes일 때만, 없는 덱과 인자 없음은 안내", () => {
  const plain = run("outline", FIX);
  expect(plain.code).toBe(0);
  expect(plain.out.startsWith("# ")).toBe(true);
  expect(plain.out).not.toContain("Notes:");
  expect(run("outline", FIX, "--notes").out).toContain("> Notes:");
  expect(run("outline", "no-such-deck-xyz").err).toContain("없는 덱: decks/no-such-deck-xyz");
  expect(run("outline").err).toContain("사용법: slidekit outline");
});
