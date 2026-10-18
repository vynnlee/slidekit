// 읽기 전용 덱(SLIDEKIT_READONLY_DECKS)에는 코멘트도 쓰지 못한다: 시험이 사용자 덱의 comments.json을 오염시키는 사고를 막는다. 실행: bun test app/test/readonly-guard.test.ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-ro-"));
for (const d of ["ro", "rw"]) { mkdirSync(join(dir, d)); writeFileSync(join(dir, d, "index.html"), "<html data-slidekit=1></html>"); }
process.env.SLIDEKIT_DECKS = dir;
process.env.SLIDEKIT_KEY_FILE = join(dir, "test.key");
process.env.SLIDEKIT_READONLY_DECKS = "ro";
const { routes } = await import("../comments");
const post = (path: string, deck: string, body: object = {}, params: Record<string, string> = {}) =>
  (routes as any)[path].POST(Object.assign(new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deck, slide: 1, text: "t", ...body }) }), { params }));

test("읽기 전용 덱: 코멘트 만들기와 모든 변경은 403이고 파일이 생기지 않는다", async () => {
  expect((await post("/api/comments", "ro")).status).toBe(403);
  for (const p of ["/api/comments/send-all", "/api/comments/:id/send", "/api/comments/:id/resend", "/api/comments/:id/cancel", "/api/comments/:id/ack", "/api/comments/:id/reply", "/api/comments/:id/resolve", "/api/comments/:id/delivered", "/api/comments/:id/delete", "/api/comments/:id/trust"]) {
    expect((await post(p, "ro", { reply: "x", resolved: true }, { id: "a1" })).status, p).toBe(403);
  }
  expect(readdirSync(join(dir, "ro")).sort()).toEqual(["index.html"]); // comments.json이 생기지 않았다
});
test("읽기 전용이 아닌 덱은 그대로 쓴다", async () => {
  const r = await post("/api/comments", "rw");
  expect(r.status).toBe(200);
  expect(existsSync(join(dir, "rw", "comments.json"))).toBe(true);
});
