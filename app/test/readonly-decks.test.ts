import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { routes } from "../editor-api";

const put = (folder: string, body: unknown) =>
  routes["/api/decks/:folder"].PUT(Object.assign(new Request("http://x/", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { folder } }));
const file = join(import.meta.dir, "..", "..", "decks", "vibe-coding-workshop", "index.html");

test("SLIDEKIT_READONLY_DECKS에 든 덱은 PUT이 403이고 파일이 바뀌지 않는다", async () => {
  const before = statSync(file).mtimeMs;
  process.env.SLIDEKIT_READONLY_DECKS = "other, vibe-coding-workshop";
  try {
    const r = await put("vibe-coding-workshop", { source: '<html data-slidekit=""><section data-slide></section>', base: before, force: true });
    expect(r.status).toBe(403);
    expect(statSync(file).mtimeMs).toBe(before);
    process.env.SLIDEKIT_READONLY_DECKS = "other";
    expect((await put("vibe-coding-workshop", {})).status).toBe(400); // 목록 밖이면 403이 아니라 입력 검사로 간다(쓰지 않는다)
  } finally {
    delete process.env.SLIDEKIT_READONLY_DECKS;
  }
});
