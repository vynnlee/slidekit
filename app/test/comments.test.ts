// comments.json이 깨졌을 때 코멘트를 잃지 않는지 확인한다. 실행: bun test app/test/comments.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-comments-"));
mkdirSync(join(dir, "d"));
process.env.SLIDEKIT_DECKS = dir;
process.env.SLIDEKIT_KEY_FILE = join(dir, "test.key"); // 실제 ~/.config 키를 건드리지 않는다
const { load, save, remap, sanitize, sign, verify, flagAfterRestore, routes } = await import("../comments");
const file = join(dir, "d", "comments.json");

test("파일이 없으면 빈 목록, 저장 후 다시 읽힘", () => {
  expect(load("d")).toEqual([]);
  const c = { id: "a", slide: 1, path: "", excerpt: "", text: "t", status: "open" as const, createdAt: "2026-10-14T00:00:00Z" };
  save("d", [c]);
  expect(load("d")).toMatchObject([c]); // trusted는 읽을 때 계산한다(서명이 없으면 false)
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

test("서명: 만든 코멘트는 검증되고, 본문이나 덱이 바뀌거나 서명이 없으면 검증 안 됨", () => {
  const base = { id: "s1", slide: 2, path: "h1", excerpt: "x", text: "원문", status: "open" as const, createdAt: "2026-10-14T00:00:00Z" };
  const signed = { ...base, sig: sign("d", base) };
  expect(verify("d", signed)).toBe(true);
  expect(verify("d", { ...signed, text: "바뀐 본문" })).toBe(false);
  expect(verify("d", { ...signed, slide: 3 })).toBe(false);
  expect(verify("other", signed)).toBe(false); // 다른 덱으로 옮기면 무효
  expect(verify("d", base)).toBe(false);
  expect(verify("d", { ...signed, sig: "zz" })).toBe(false);
  expect(verify("d", { ...signed, sig: "0".repeat(64) })).toBe(false);
  save("d", [signed, { ...signed, id: "s2", text: "조작", sig: signed.sig }, { ...base, id: "s3" }]);
  const l = load("d");
  expect(l.map((c) => [c.id, c.trusted])).toEqual([["s1", true], ["s2", false], ["s3", false]]);
  expect(readFileSync(file, "utf8")).not.toContain('"trusted"'); // 저장하지 않는다
  const { statSync } = require("node:fs");
  expect(statSync(join(dir, "test.key")).mode & 0o777).toBe(0o600); // 키 파일 권한
});

test("버전 복원 뒤: 발췌문이 그 번호 슬라이드에 없으면 recheck, 있으면 해제", () => {
  const c = { id: "r1", slide: 1, path: "", excerpt: "Alpha", text: "t", status: "open" as const, createdAt: "2026-10-14T00:00:00Z" };
  save("d", [c, { ...c, id: "r2", slide: 2, excerpt: "" }]);
  const html = (a: string, b: string) => `<section data-slide="content"><h1>${a}</h1></section><section data-slide="content"><h1>${b}</h1></section>`;
  flagAfterRestore("d", html("Beta", "Alpha"));
  expect(load("d").map((x) => !!x.recheck)).toEqual([true, false]); // 발췌문이 없는 코멘트는 판단하지 않는다
  flagAfterRestore("d", html("Alpha", "Beta"));
  expect(load("d").map((x) => !!x.recheck)).toEqual([false, false]);
});

test("큰 입력과 이상한 글자: 본문 2000자 초과는 400, excerpt와 path는 잘리고, 널 문자와 이모지와 RTL은 저장되어도 목록이 죽지 않는다", async () => {
  const post = (b: Record<string, unknown>) => routes["/api/comments"].POST(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deck: "d", slide: 1, ...b }) }));
  expect((await post({ text: "가".repeat(100_000) })).status).toBe(400); // 100KB 본문
  expect((await post({ text: "a".repeat(2001) })).status).toBe(400);
  const long = await post({ text: "x", path: "p".repeat(10_000), excerpt: "e".repeat(10_000) });
  expect(long.status).toBe(200);
  const odd = String.fromCharCode(0, 0x202e, 0x200b, 0x2028) + "😀".repeat(50) + "\n둘째 줄";
  expect((await post({ text: odd, excerpt: odd, path: odd })).status).toBe(200);
  const l = load("d");
  const a = l.find((c) => c.text === "x" && c.path.length > 0)!;
  expect(a.path.length).toBe(200);
  expect(a.excerpt.length).toBe(80);
  const b = l.find((c) => c.text === odd)!;
  expect(b.text).toBe(odd); // 본문은 사용자가 쓴 그대로(채널이 알림에서 \\uXXXX로 풀어 쓴다)
  expect(/[\u0000-\u001f]/.test(b.excerpt + b.path)).toBe(false); // 덱에서 온 값의 제어 문자(널과 줄바꿈 포함)는 공백이 된다
});
