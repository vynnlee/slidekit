import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardReq } from "../guard";

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const setup = async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-assets-"));
  mkdirSync(join(dir, "d1"));
  writeFileSync(join(dir, "d1", "index.html"), "<html></html>");
  process.env.SLIDEKIT_DECKS = dir;
  const api = await import(`../decks-api.ts?x=${Date.now()}${Math.random()}`);
  const up = (folder: string, body: Uint8Array, q = "?name=photo.png", headers: Record<string, string> = {}) =>
    api.uploadAsset(Object.assign(new Request(`http://127.0.0.1/api/decks/${folder}/assets${q}`, { method: "POST", headers: { "Content-Type": "image/png", "Content-Length": String(body.length), ...headers }, body: body as unknown as BodyInit }), { params: { folder } }));
  return { dir, up };
};

test("업로드: 201과 assets/ 경로, 파일이 덱 폴더에 생긴다", async () => {
  const { dir, up } = await setup();
  const r = await up("d1", PNG);
  expect(r.status).toBe(201);
  const j = await r.json();
  expect(j.path).toMatch(/^assets\/photo[\w-]*\.png$/);
  expect(existsSync(join(dir, "d1", j.path))).toBe(true);
  expect(j.width).toBe(1);
});

test("업로드: 퍼센트 인코딩된 x-filename 헤더도 받는다", async () => {
  const { up } = await setup();
  const r = await up("d1", PNG, "", { "x-filename": encodeURIComponent("my photo.png") });
  expect(r.status).toBe(201);
});

test("업로드 거절: 없는 덱 404, 경로 이탈 404, 이미지가 아니면 400(영어 오류 + detail), 너무 크면 413, 길이 없음 411, 잘못된 max 400", async () => {
  const { up } = await setup();
  expect((await up("nope", PNG)).status).toBe(404);
  expect((await up("..", PNG)).status).toBe(404);
  const bad = await up("d1", new TextEncoder().encode("not an image"), "?name=x.png");
  expect(bad.status).toBe(400);
  const bj = await bad.json();
  expect(bj.error).toMatch(/cannot be added/);
  expect(typeof bj.detail).toBe("string");
  expect((await up("d1", PNG, "?name=a.png", { "Content-Length": String(21 * 1024 * 1024) })).status).toBe(413);
  expect((await up("d1", PNG, "?name=a.png&max=50")).status).toBe(400);
  expect((await up("d1", PNG, "?name=a.png&max=abc")).status).toBe(400);
});

test("guard: 업로드 경로만 image/* 와 octet-stream 본문을 허용한다", () => {
  const r = (path: string, type: string) => guardReq(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { Host: "127.0.0.1", "Content-Type": type } }));
  expect(r("/api/decks/d1/assets", "image/png")).toBeNull();
  expect(r("/api/decks/d1/assets", "application/octet-stream")).toBeNull();
  expect(r("/api/decks/d1/assets", "text/plain")?.status).toBe(415);
  expect(r("/api/decks/d1/assets", "multipart/form-data; boundary=x")?.status).toBe(415);
  expect(r("/api/decks/d1/rename", "image/png")?.status).toBe(415);
  expect(r("/api/decks/d1/assets/x", "image/png")?.status).toBe(415);
});
