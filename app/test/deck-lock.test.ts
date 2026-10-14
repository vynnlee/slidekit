import { expect, test } from "bun:test";
import { readOnlyDeck, withDeckLock } from "../deck-lock";

test("같은 덱의 작업은 들어온 순서대로 하나씩 실행된다(읽기와 쓰기 사이 await가 있어도 겹치지 않는다)", async () => {
  const log: string[] = [];
  const job = (n: string, ms: number) => withDeckLock("d", async () => { log.push(`start ${n}`); await Bun.sleep(ms); log.push(`end ${n}`); return n; });
  const r = await Promise.all([job("a", 30), job("b", 1), job("c", 1)]);
  expect(r).toEqual(["a", "b", "c"]);
  expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("다른 덱은 서로 기다리지 않는다", async () => {
  const log: string[] = [];
  await Promise.all([
    withDeckLock("x", async () => { await Bun.sleep(30); log.push("x"); }),
    withDeckLock("y", async () => { log.push("y"); }),
  ]);
  expect(log).toEqual(["y", "x"]);
});

test("한 작업이 실패해도 뒤 작업은 실행되고 실패는 그 호출자에게만 간다", async () => {
  const bad = withDeckLock("e", async () => { throw new Error("boom"); });
  const good = withDeckLock("e", async () => "ok");
  await expect(bad).rejects.toThrow("boom");
  expect(await good).toBe("ok");
});

test("readOnlyDeck: SLIDEKIT_READONLY_DECKS에 든 폴더만", () => {
  process.env.SLIDEKIT_READONLY_DECKS = "a, b";
  expect(readOnlyDeck("a")).toBe(true);
  expect(readOnlyDeck("b")).toBe(true);
  expect(readOnlyDeck("c")).toBe(false);
  delete process.env.SLIDEKIT_READONLY_DECKS;
  expect(readOnlyDeck("a")).toBe(false);
});
