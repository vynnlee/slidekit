// 덱 버전 기록: 스냅샷(저장, 외부 변경, 복원), 보존 한도, 파일 감시 연동, API, 코멘트의 Revert Claude's edit.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-versions-"));
process.env.SLIDEKIT_DECKS = dir;
process.env.SLIDEKIT_KEY_FILE = join(dir, "test.key");
const deck = "d1";
const file = join(dir, deck, "index.html");
const html = (t: string, n = 2) => `<!doctype html><html><body data-slidekit="1">${Array.from({ length: n }, (_, i) => `<section data-slide="content"><h1>${t}${i}</h1></section>`).join("")}</body></html>`;
mkdirSync(join(dir, deck));
writeFileSync(file, html("v0"));

const V = await import("../versions");
const C = await import("../comments");
const creq = (path: string, body?: unknown, params: Record<string, string> = {}) =>
  Object.assign(new Request(`http://x${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), { params });
const t0 = new Date("2026-10-14T10:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);

test("스냅샷: 마지막과 같으면 건너뛰고, 파일 이름에 종류와 슬라이드 수가 들어간다", () => {
  const a = V.snapshot(deck, html("a", 3), "external", at(0))!;
  expect(a.kind).toBe("external");
  expect(a.slides).toBe(3);
  expect(a.at).toBe("2026-10-14T10:00:00Z");
  expect(V.snapshot(deck, html("a", 3), "external", at(1))).toBeNull();
  expect(V.list(deck)[0].id).toBe(a.id);
  expect(V.read(deck, a.id)).toBe(html("a", 3));
});

test("save는 60초 안의 연속 저장을 처음 것 하나로 합치고, 60초 뒤에는 새로 남긴다", () => {
  const before = V.list(deck).length;
  expect(V.snapshot(deck, html("s1"), "save", at(100))).not.toBeNull();
  expect(V.snapshot(deck, html("s2"), "save", at(130))).toBeNull(); // 30초 뒤: 합친다
  expect(V.snapshot(deck, html("s3"), "save", at(170))).not.toBeNull(); // 70초 뒤: 새 스냅샷
  expect(V.list(deck).length).toBe(before + 2);
});

test("보존: 최근 50개만 남기고 가장 오래된 것부터 지운다", () => {
  for (let i = 0; i < 60; i++) V.snapshot(deck, html(`r${i}`, 1 + (i % 3)), "external", at(1000 + i));
  const l = V.list(deck);
  expect(l.length).toBe(50);
  expect(V.read(deck, l[0].id)).toBe(html("r59", 1 + (59 % 3))); // 최신은 남는다
  expect(readdirSync(join(dir, deck, ".versions")).filter((f) => f.endsWith(".html")).length).toBe(50);
});

test("용량 상한 30MB: 오래된 것부터 지우되 최신 하나는 남긴다", () => {
  const big = (n: number) => html("big") + "x".repeat(n);
  for (let i = 0; i < 8; i++) V.snapshot(deck, big(5 * 1024 * 1024 + i), "external", at(2000 + i));
  const l = V.list(deck);
  expect(l.reduce((n, v) => n + v.bytes, 0)).toBeLessThanOrEqual(30 * 1024 * 1024);
  expect(l.length).toBeGreaterThan(0);
  expect(V.read(deck, l[0].id)!.length).toBeGreaterThan(5 * 1024 * 1024); // 최신(가장 큰 쪽)이 남았다
});

test("id 검증: 형식이 틀린 id는 읽지 않는다(경로 이탈 방지)", () => {
  for (const id of ["../index", "..%2F", "x", "20261014T100000Z-save-1-zzzz", "20261014T100000Z-evil-1-abcd"]) expect(V.read(deck, id)).toBeNull();
});

test("편집기 저장은 외부 변경으로 오해되지 않고, 외부 변경은 직전 내용을 남긴다", () => {
  writeFileSync(file, html("e0"));
  V.afterSave(deck, html("old"), html("e0")); // 편집기가 e0를 저장했다
  expect(V.noteFileChanged(deck)).toBeNull(); // watcher가 와도 lastSeen과 같아서 무시
  writeFileSync(file, html("claude")); // 편집기 밖(Claude)이 고쳤다
  const v = V.noteFileChanged(deck)!;
  expect(v.kind).toBe("external");
  expect(V.read(deck, v.id)).toBe(html("e0")); // 고치기 직전 내용
  expect(V.noteFileChanged(deck)).toBeNull(); // 같은 내용으로 다시 알려도 새로 만들지 않는다
  const e = V.editsBetween(deck, "2000-01-01T00:00:00.000Z", "2999-01-01T00:00:00.000Z")!;
  expect(e.base).toBe(v.id);
  expect(e.hash).toBe(V.hash(html("claude")));
  expect(V.editsBetween(deck, "2999-01-01T00:00:00.000Z", "2999-12-31T00:00:00.000Z")).toBeNull();
});

test("복원: 현재를 restore 스냅샷으로 남기고 되돌리며, undo id로 다시 돌아올 수 있다", () => {
  writeFileSync(file, html("current"));
  const target = V.list(deck).find((v) => V.read(deck, v.id) === html("e0"))!;
  const r = V.restore(deck, target.id);
  if (!r.ok) throw new Error("restore failed");
  expect(readFileSync(file, "utf8")).toBe(html("e0"));
  expect(V.read(deck, r.undo!)).toBe(html("current")); // 복원 전 내용이 스냅샷으로 있다
  expect(V.list(deck).find((v) => v.id === r.undo)!.kind).toBe("restore");
  expect(V.noteFileChanged(deck)).toBeNull(); // 복원도 외부 변경으로 오해되지 않는다
  const back = V.restore(deck, r.undo!);
  expect(back.ok).toBe(true);
  expect(readFileSync(file, "utf8")).toBe(html("current"));
  expect(V.restore(deck, "20261014T100000Z-save-1-abcd").ok).toBe(false);
});

test("API: 목록, 원문, 복원(읽기 전용 덱은 403), 잘못된 덱과 id는 404", async () => {
  const r = V.routes;
  const l = (await (await r["/api/decks/:folder/versions"].GET(creq("/", undefined, { folder: deck }) as any)).json()) as any[];
  expect(l.length).toBeGreaterThan(0);
  expect((await r["/api/decks/:folder/versions"].GET(creq("/", undefined, { folder: "../x" }) as any)).status).toBe(404);
  const one = (await (await r["/api/decks/:folder/versions/:vid"].GET(creq("/", undefined, { folder: deck, vid: l[0].id }) as any)).json()) as any;
  expect(typeof one.source).toBe("string");
  expect((await r["/api/decks/:folder/versions/:vid"].GET(creq("/", undefined, { folder: deck, vid: "../x" }) as any)).status).toBe(404);
  process.env.SLIDEKIT_READONLY_DECKS = deck;
  expect((await r["/api/decks/:folder/versions/:vid/restore"].POST(creq("/", {}, { folder: deck, vid: l[0].id }) as any)).status).toBe(403);
  delete process.env.SLIDEKIT_READONLY_DECKS;
  expect((await r["/api/decks/:folder/versions/:vid/restore"].POST(creq("/", {}, { folder: deck, vid: l[0].id }) as any)).status).toBe(200);
});

test("코멘트: 답이 달리면 그 사이 외부 수정이 연결되고 Revert가 되돌리며, 이후 덱이 바뀌면 409", async () => {
  writeFileSync(file, html("base"));
  V.afterSave(deck, html("zero"), html("base"));
  const post = async (path: string, body: unknown, id?: string) => C.routes[path as keyof typeof C.routes] && (await (C.routes as any)[path].POST(creq(path, { deck, ...(body as object) }, id ? { id } : {})));
  const { id } = (await (await post("/api/comments", { slide: 1, path: "h1", excerpt: "x", text: "고쳐 주세요" })).json()) as { id: string };
  await post("/api/comments/:id/ack", {}, id);
  writeFileSync(file, html("fixed")); // Claude가 고친다
  expect(V.noteFileChanged(deck)).not.toBeNull();
  await post("/api/comments/:id/reply", { reply: "고쳤습니다" }, id);
  let c = ((await (await (C.routes as any)["/api/comments"].GET(creq(`/api/comments?deck=${deck}`))).json()) as any[]).find((x) => x.id === id);
  expect(c.editBase).toBeTruthy();
  expect(c.editHash).toBe(V.hash(html("fixed")));
  // 되돌리기
  expect((await post("/api/comments/:id/revert", {}, id)).status).toBe(200);
  expect(readFileSync(file, "utf8")).toBe(html("base"));
  c = ((await (await (C.routes as any)["/api/comments"].GET(creq(`/api/comments?deck=${deck}`))).json()) as any[]).find((x) => x.id === id);
  expect(c.revertedAt).toBeTruthy();
  expect((await post("/api/comments/:id/revert", {}, id)).status).toBe(409); // 이미 되돌렸다
  // 되돌리기 취소
  expect((await post("/api/comments/:id/revert", { undo: true }, id)).status).toBe(200);
  expect(readFileSync(file, "utf8")).toBe(html("fixed"));
  // 그 뒤 덱이 더 바뀌면 거절
  writeFileSync(file, html("fixed-and-more"));
  const r2 = await post("/api/comments/:id/revert", {}, id);
  expect(r2.status).toBe(409);
  expect(((await r2.json()) as any).error).toBe("changed");
  expect(readFileSync(file, "utf8")).toBe(html("fixed-and-more")); // 건드리지 않았다
});
