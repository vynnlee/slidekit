// SLIDEKIT_READONLY_DECKS에 든 덱은 PUT이 403이고 파일이 바뀌지 않는지 확인한다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.SLIDEKIT_READONLY_DECKS = "vibe-coding-workshop";
const { routes } = await import("../editor-api");
const file = join(import.meta.dir, "..", "..", "decks", "vibe-coding-workshop", "index.html");

test("읽기 전용 덱의 PUT은 403이고 파일은 그대로", async () => {
  const before = readFileSync(file, "utf8");
  const req = Object.assign(new Request("http://x/api/decks/vibe-coding-workshop", { method: "PUT", body: JSON.stringify({ source: before, base: 0 }) }), { params: { folder: "vibe-coding-workshop" } });
  const res = await routes["/api/decks/:folder"].PUT(req);
  expect(res.status).toBe(403);
  expect(readFileSync(file, "utf8")).toBe(before);
});
