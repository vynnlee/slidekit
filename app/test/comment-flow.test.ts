// 코멘트 자동 처리 상한과 Pause: 60분 창, 덱 합산, 한도 0, resetAt, flow.json 영속, flow API와 이벤트. 실행: bun test app/test/comment-flow.test.ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WINDOW, flowOf, hourlyLimit, readPaused, writePaused } from "../comment-flow";

const now = Date.parse("2026-10-18T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

test("flowOf: 최근 60분 전달만 센다", () => {
  const f = flowOf([ago(5), ago(59), ago(61), undefined, "x"], false, now, 3);
  expect(f).toMatchObject({ used: 2, remaining: 1, reason: null, resetAt: null, limit: 3 });
});
test("flowOf: 상한이면 reason limit이고 resetAt은 한 자리가 비는 시각", () => {
  const f = flowOf([ago(50), ago(10), ago(30)], false, now, 3);
  expect(f).toMatchObject({ used: 3, remaining: 0, reason: "limit" });
  expect(f.resetAt).toBe(new Date(now - 50 * 60_000 + WINDOW).toISOString());
  const over = flowOf([ago(50), ago(40), ago(30), ago(10)], false, now, 3); // 상한을 넘긴 경우 (used-limit)번째로 오래된 것
  expect(over.resetAt).toBe(new Date(now - 40 * 60_000 + WINDOW).toISOString());
});
test("flowOf: Pause가 우선이고 한도 0은 끈다", () => {
  expect(flowOf([ago(1), ago(2)], true, now, 60)).toMatchObject({ paused: true, reason: "user" });
  expect(flowOf(Array(500).fill(ago(1)), false, now, 0)).toMatchObject({ reason: null, remaining: null });
});
test("hourlyLimit: 환경 변수, 잘못된 값은 기본 60", () => {
  const keep = process.env.SLIDEKIT_COMMENT_HOURLY;
  try {
    delete process.env.SLIDEKIT_COMMENT_HOURLY; expect(hourlyLimit()).toBe(60);
    process.env.SLIDEKIT_COMMENT_HOURLY = "5"; expect(hourlyLimit()).toBe(5);
    process.env.SLIDEKIT_COMMENT_HOURLY = "0"; expect(hourlyLimit()).toBe(0);
    for (const bad of ["-1", "abc", "2.5", ""]) { process.env.SLIDEKIT_COMMENT_HOURLY = bad; expect(hourlyLimit()).toBe(bad === "" ? 0 : 60); } // 빈 문자열은 Number("")=0
  } finally { if (keep === undefined) delete process.env.SLIDEKIT_COMMENT_HOURLY; else process.env.SLIDEKIT_COMMENT_HOURLY = keep; }
});
test("flow.json: 저장과 읽기, 없거나 깨지면 멈춤 아님", () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-flow-")), file = join(dir, "flow.json");
  expect(readPaused(file)).toBe(false);
  writePaused(file, true); expect(readPaused(file)).toBe(true);
  writePaused(file, false); expect(readPaused(file)).toBe(false);
  writeFileSync(file, "{broken"); expect(readPaused(file)).toBe(false);
  writeFileSync(file, '{"paused":"yes"}'); expect(readPaused(file)).toBe(false);
});

// API: 임시 덱과 키 파일. 한도 2.
const dir = mkdtempSync(join(tmpdir(), "sk-flow-api-"));
for (const d of ["a", "b"]) { mkdirSync(join(dir, d)); writeFileSync(join(dir, d, "index.html"), "<html data-slidekit=1></html>"); }
process.env.SLIDEKIT_DECKS = dir;
process.env.SLIDEKIT_KEY_FILE = join(dir, "test.key");
process.env.SLIDEKIT_COMMENT_HOURLY = "2";
const { routes } = await import("../comments");
const call = (path: keyof typeof routes, method: "GET" | "POST", params: Record<string, string>, body?: unknown) =>
  ((routes[path] as any)[method] as (r: any) => Promise<Response> | Response)(Object.assign(new Request("http://127.0.0.1/x", { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params }));
const make = async (deck: string, text: string) => ((await (await call("/api/comments", "POST", {}, { deck, slide: 1, path: "", excerpt: "", text })).json()) as any).id as string;
const deliver = (deck: string, id: string) => call("/api/comments/:id/delivered", "POST", { id }, { deck });

test("flow API: 덱을 합쳐 세고 상한이면 limit, Pause는 영속", async () => {
  const get = async () => (await (await call("/api/comments/flow" as any, "GET", {})).json()) as any;
  expect(await get()).toMatchObject({ used: 0, remaining: 2, reason: null, paused: false });
  const x = await make("a", "하나"), y = await make("b", "둘"), z = await make("a", "셋");
  expect((await get()).used).toBe(0); // 등록만으로는 세지 않는다
  await deliver("a", x); await deliver("b", y);
  expect(await get()).toMatchObject({ used: 2, remaining: 0, reason: "limit" });
  expect((await get()).resetAt).toBeTruthy();
  await deliver("a", z); // 한 번 더 전달돼도 오류 없이 센다(소프트 상한)
  expect((await get()).used).toBe(3);
  const p = await call("/api/comments/flow" as any, "POST", {}, { paused: true });
  expect(await p.json()).toMatchObject({ paused: true, reason: "user" });
  expect(JSON.parse(readFileSync(join(dir, "flow.json"), "utf8"))).toEqual({ paused: true });
  expect((await call("/api/comments/flow" as any, "POST", {}, { paused: "yes" })).status).toBe(400);
  expect((await call("/api/comments/flow" as any, "POST", {}, {})).status).toBe(400);
  await call("/api/comments/flow" as any, "POST", {}, { paused: false });
  expect(JSON.parse(readFileSync(join(dir, "flow.json"), "utf8"))).toEqual({ paused: false });
  expect(existsSync(join(dir, "flow.json.tmp"))).toBe(false);
});
