// 덱 복제는 history/, comments.json, 점으로 시작하는 이름(.versions, .publish.json 같은 이 기기의 상태)을 복사하지 않는다.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-dup-"));
process.env.SLIDEKIT_DECKS = dir;
const html = `<!doctype html><html><head><title>t</title><script type="application/json" id="deck-meta">{"title":"t","id":"a"}</script></head><body data-slidekit="1"><section data-slide="content"><h1>a</h1></section></body></html>`;
const src = join(dir, "a");
mkdirSync(join(src, "history"), { recursive: true });
mkdirSync(join(src, ".versions"), { recursive: true });
mkdirSync(join(src, "img"), { recursive: true });
writeFileSync(join(src, "index.html"), html);
for (const f of ["comments.json", ".publish.json", ".versions/20261014T100000Z-save-1-abcd.html", "history/old.html", "history-notes.md", "notes.md", "img/a.png", ".hidden"]) writeFileSync(join(src, f), "x");

const { duplicateDeck } = await import("../decks-api");

test("복제: 상태 파일은 빼고 형제 이름과 일반 파일은 복사한다", async () => {
  const res = await duplicateDeck(Object.assign(new Request("http://x/", { method: "POST" }), { params: { folder: "a" } }) as any);
  expect(res.status).toBe(201);
  const copy = join(dir, ((await res.json()) as { folder: string }).folder);
  for (const f of ["index.html", "notes.md", "history-notes.md", "img/a.png"]) expect(existsSync(join(copy, f))).toBe(true);
  for (const f of ["comments.json", ".publish.json", ".versions", ".hidden", "history"]) expect(existsSync(join(copy, f))).toBe(false);
});
