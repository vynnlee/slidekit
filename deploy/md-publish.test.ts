import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MD_MAX, notesLeak, withAlternate } from "./md-publish";

const root = join(import.meta.dir, "..");
const doc = (body: string, head = "") => `<!doctype html><html data-slidekit="1"><head><script type="application/json" id="deck-meta">{"title":"t","id":"x","visibility":"public"}</script>${head}</head><body>${body}</body></html>`;

test("withAlternate: </head> 앞에 한 번만 넣고, 이미 있으면 그대로, head가 없으면 그대로", () => {
  const html = doc("<section data-slide=\"cover\"><h1>A</h1></section>");
  const out = withAlternate(html, "my-deck");
  expect(out).toContain('<link rel="alternate" type="text/markdown" href="/my-deck/deck.md"></head>');
  expect(out.replace('<link rel="alternate" type="text/markdown" href="/my-deck/deck.md">', "")).toBe(html); // 그 한 줄 말고는 바이트가 같다
  expect(withAlternate(out, "my-deck")).toBe(out);
  expect(withAlternate(doc("x", '<link type="text/markdown" rel="alternate" href="/other">'), "my-deck")).toContain('href="/other"');
  expect(withAlternate("<p>no head</p>", "d")).toBe("<p>no head</p>");
  expect((withAlternate(out, "my-deck").match(/rel="alternate"/g) ?? []).length).toBe(1);
});

test("notesLeak: 노트의 줄이 md에 있으면 알리고, 8자 미만 줄과 노트가 없는 md는 통과", () => {
  const html = doc(`<section data-slide="content"><h2>T</h2><aside data-notes>비밀 발표 대본 첫째 줄입니다\n둘째 줄도 충분히 깁니다<br>짧다</aside></section>`);
  expect(notesLeak(html, "# T\n\n## 1. T\n")).toBeNull();
  expect(notesLeak(html, "# T\n\n비밀 발표 대본 첫째 줄입니다\n")).toBe("비밀 발표 대본 첫째 줄입니다");
  expect(notesLeak(html, "x   둘째 줄도\n   충분히 깁니다 y")).toBe("둘째 줄도 충분히 깁니다"); // 공백이 달라도 잡는다
  expect(notesLeak(html, "짧다")).toBeNull(); // 8자 미만은 우연히 겹칠 수 있어 보지 않는다
  expect(notesLeak(doc("<section data-slide=\"content\"><h2>T</h2></section>"), "# T")).toBeNull();
  expect(MD_MAX).toBe(2 * 1024 * 1024);
});

// deploy.ts를 드라이런으로 실제 실행해 deck.md 줄과 노트 중단을 본다(원격 호출 없음, dist에 임시 파일을 쓰고 지운다).
const NAME = "qa-md-notes", html = doc(`<section data-slide="cover"><h1>제목</h1></section><section data-slide="content"><h2>본문</h2><p>공개 문장입니다</p><aside data-notes>SECRET-NOTE-LINE-12345 발표자만 봅니다</aside></section>`, "");
const files = [join(root, "dist", `${NAME}.html`), join(root, "dist", `${NAME}.md`)];
mkdirSync(join(root, "dist"), { recursive: true });
afterAll(() => { for (const f of files) rmSync(f, { force: true }); });
const run = () => Bun.spawnSync(["bun", join(import.meta.dir, "deploy.ts"), NAME, "--dry-run"], { cwd: root, env: { ...process.env, CLOUDFLARE_API_TOKEN: "x" }, stdout: "pipe", stderr: "pipe" });

test("deploy 드라이런: 노트 글이 deck.md에 있으면 중단(종료 1)하고 노트 글을 출력에 되풀이하지 않는 일은 없다(어느 줄인지는 알린다)", () => {
  writeFileSync(files[0], html);
  writeFileSync(files[1], "# 제목\n\n## 2. 본문\n\n공개 문장입니다\n\nSECRET-NOTE-LINE-12345 발표자만 봅니다\n");
  const r = run();
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("발표자 노트 글이 들어 있어 올리지 않습니다");
  expect(r.stderr.toString()).toContain("SECRET-NOTE-LINE-12345");
  expect(r.stdout.toString()).not.toContain("DRY RUN"); // 올리지 않는다
});

test("deploy 드라이런: 노트 없는 deck.md면 통과하고 크기와 확인 문구를 보인다", () => {
  writeFileSync(files[0], html);
  writeFileSync(files[1], "# 제목\n\n## 2. 본문\n\n공개 문장입니다\n");
  const r = run();
  expect(r.exitCode).toBe(0);
  const out = r.stdout.toString();
  expect(out).toContain("deck.md");
  expect(out).toContain("발표자 노트 글 없음 확인");
  expect(out).toContain("DRY RUN");
  expect(out + r.stderr.toString()).not.toContain("SECRET-NOTE");
});

test("deploy 드라이런: dist의 .md가 없으면 번들 HTML에서 만들고(노트 없음) 통과한다", () => {
  writeFileSync(files[0], html);
  rmSync(files[1], { force: true });
  const r = run();
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("발표자 노트 글 없음 확인");
});
