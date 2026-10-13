// comments.json이 깨졌을 때 코멘트를 잃지 않는지 확인한다. 실행: bun test app/test/comments.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-comments-"));
mkdirSync(join(dir, "d"));
process.env.SLIDEKIT_DECKS = dir;
const { load, save } = await import("../comments");
const file = join(dir, "d", "comments.json");

test("파일이 없으면 빈 목록, 저장 후 다시 읽힘", () => {
  expect(load("d")).toEqual([]);
  const c = { id: "a", slide: 1, path: "", excerpt: "", text: "t", status: "open" as const, createdAt: "x" };
  save("d", [c]);
  expect(load("d")).toEqual([c]);
  expect(readdirSync(join(dir, "d")).some((n) => n.includes(".tmp-"))).toBe(false);
});

test("깨진 JSON은 오류를 던지고 원본과 사본을 보존", () => {
  writeFileSync(file, '[{"id": "a", ');
  expect(() => load("d")).toThrow("손상");
  expect(readFileSync(file, "utf8")).toBe('[{"id": "a", ');
  const keep = readdirSync(join(dir, "d")).find((n) => n.startsWith(".comments.json.corrupt-"));
  expect(keep).toBeDefined();
  expect(readFileSync(join(dir, "d", keep!), "utf8")).toBe('[{"id": "a", ');
  writeFileSync(file, '{"not":"array"}');
  expect(() => load("d")).toThrow("손상");
});
