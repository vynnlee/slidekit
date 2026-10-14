// comments.json이 깨졌을 때 코멘트를 잃지 않는지 확인한다. 실행: bun test app/test/comments.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-comments-"));
mkdirSync(join(dir, "d"));
process.env.SLIDEKIT_DECKS = dir;
const { load, save, remap, sanitize } = await import("../comments");
const file = join(dir, "d", "comments.json");

test("파일이 없으면 빈 목록, 저장 후 다시 읽힘", () => {
  expect(load("d")).toEqual([]);
  const c = { id: "a", slide: 1, path: "", excerpt: "", text: "t", status: "open" as const, createdAt: "2026-10-14T00:00:00Z" };
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

test("sanitize는 형식이 틀린 항목을 버리고 길이를 자른다", () => {
  const ok = { id: "a1", slide: 2, path: "h1", excerpt: "x", text: "t", status: "open", createdAt: "2026-10-14T00:00:00Z" };
  const out = sanitize([
    ok,
    { ...ok, id: "../evil" }, { ...ok, id: "b", slide: "2" }, { ...ok, id: "c", slide: 0 }, { ...ok, id: "d", status: "pwned" },
    { ...ok, id: "e", text: " " }, { ...ok, id: "f", createdAt: "not a date" }, null, 7, "x",
    { ...ok, id: "g", text: "t".repeat(5000), path: "p".repeat(900), reply: "r".repeat(5000), deliveredAt: "<script>" },
  ] as unknown[]);
  expect(out.map((c) => c.id)).toEqual(["a1", "g"]);
  const g = out[1];
  expect(g.text.length).toBe(2000);
  expect(g.path.length).toBe(200);
  expect(g.reply!.length).toBe(2000);
  expect(g.deliveredAt).toBeUndefined();
});

test("remap은 정수가 아닌 값을 슬라이드 번호로 받지 않는다", () => {
  const c = { id: "m1", slide: 1, path: "", excerpt: "", text: "t", status: "open" as const, createdAt: "2026-10-14T00:00:00Z" };
  save("d", [c, { ...c, id: "m2", slide: 2 }, { ...c, id: "m3", slide: 3 }]);
  remap("d", { "1": "<img onerror=x>" as unknown as number, "2": 5, "3": -1 });
  const l = load("d");
  expect(l.find((x) => x.id === "m1")).toMatchObject({ slide: 1, slideDeleted: true });
  expect(l.find((x) => x.id === "m2")?.slide).toBe(5);
  expect(l.find((x) => x.id === "m3")).toMatchObject({ slide: 3, slideDeleted: true });
});
