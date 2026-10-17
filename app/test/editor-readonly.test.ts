// SLIDEKIT_READONLY_DECKS에 든 덱은 PUT이 403이고 파일이 바뀌지 않는지 확인한다.
import { afterAll, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { makeTestDeck } = createRequire(import.meta.url)("../../scripts/lib/test-deck.cjs") as { makeTestDeck: (name: string, from?: string) => { folder: string; file: string; cleanup: () => void } };

const T = makeTestDeck("readonly"); // 사용자의 덱이 아니라 커밋된 내용의 사본
afterAll(() => T.cleanup()); // bun test는 exit 이벤트를 안 불러 사본이 남는다
process.env.SLIDEKIT_READONLY_DECKS = T.folder;
const { routes } = await import("../editor-api");
const file = T.file;

test("읽기 전용 덱의 PUT은 403이고 파일은 그대로", async () => {
  const before = readFileSync(file, "utf8");
  const req = Object.assign(new Request(`http://x/api/decks/${T.folder}`, { method: "PUT", body: JSON.stringify({ source: before, base: 0 }) }), { params: { folder: T.folder } });
  const res = await routes["/api/decks/:folder"].PUT(req);
  expect(res.status).toBe(403);
  expect(readFileSync(file, "utf8")).toBe(before);
});

test("목록 밖 덱은 403이 아니라 입력 검사로 간다(쓰지 않는다)", async () => {
  const req = Object.assign(new Request(`http://x/api/decks/${T.folder}`, { method: "PUT", body: JSON.stringify({}) }), { params: { folder: T.folder } });
  process.env.SLIDEKIT_READONLY_DECKS = "other";
  try {
    expect((await routes["/api/decks/:folder"].PUT(req)).status).toBe(400);
  } finally {
    process.env.SLIDEKIT_READONLY_DECKS = T.folder;
  }
});
