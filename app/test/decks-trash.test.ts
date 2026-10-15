// 덱 이름 바꾸기, 휴지통, 복원, 영구 삭제의 디스크 동작과 검증(이름 규칙, 충돌, 읽기 전용, 확인 문구, 경로 이탈). 임시 덱 폴더만 쓴다.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-trash-"));
process.env.SLIDEKIT_DECKS = dir;
const html = (id: string) => `<!doctype html><html><head><title>${id}</title><script type="application/json" id="deck-meta">{"title":"${id}","id":"${id}"}</script></head><body><section data-slide="cover"><h1>${id}</h1></section></body></html>`;
const mk = (name: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, "index.html"), html(name)); };
const api = await import("../decks-api");
const call = async (fn: (r: any) => Promise<Response>, params: Record<string, string>, body?: unknown) => {
  const res = await fn(Object.assign(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), { params }));
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};

test("이름 바꾸기: 규칙 위반 400, 없는 덱 404, 이미 있는 이름 409, 성공하면 폴더가 옮겨지고 id가 따라간다", async () => {
  mk("old"); mk("taken");
  expect((await call(api.renameDeck, { folder: "old" }, { name: "Bad Name" })).status).toBe(400);
  expect((await call(api.renameDeck, { folder: "old" }, { name: "../escape" })).status).toBe(400);
  expect((await call(api.renameDeck, { folder: "nope" }, { name: "fresh" })).status).toBe(404);
  expect((await call(api.renameDeck, { folder: "old" }, { name: "taken" })).status).toBe(409);
  expect(existsSync(join(dir, "old"))).toBe(true); // 실패하면 그대로
  const ok = await call(api.renameDeck, { folder: "old" }, { name: "fresh" });
  expect(ok.status).toBe(200);
  expect(existsSync(join(dir, "old"))).toBe(false);
  expect(readFileSync(join(dir, "fresh", "index.html"), "utf8")).toContain('"id":"fresh"');
});

test("읽기 전용 덱은 이름 바꾸기와 휴지통이 403이고 그대로다", async () => {
  mk("locked");
  process.env.SLIDEKIT_READONLY_DECKS = "locked";
  try {
    expect((await call(api.renameDeck, { folder: "locked" }, { name: "other" })).status).toBe(403);
    expect((await call(api.trashDeck, { folder: "locked" })).status).toBe(403);
  } finally { delete process.env.SLIDEKIT_READONLY_DECKS; }
  expect(existsSync(join(dir, "locked", "index.html"))).toBe(true);
});

test("휴지통: 옮기면 목록에서 빠지고 휴지통 목록에 나오며, 복원은 이름이 겹치면 -restored로, 영구 삭제는 폴더 이름을 입력해야 한다", async () => {
  mk("gone");
  const t = await call(api.trashDeck, { folder: "gone" });
  expect(t.status).toBe(200);
  expect(existsSync(join(dir, "gone"))).toBe(false);
  expect(readdirSync(join(dir, ".trash")).includes(t.json.entry)).toBe(true);
  const list = (await (await api.listTrash()).json()) as { entry: string; folder: string }[];
  expect(list.find((x) => x.entry === t.json.entry)?.folder).toBe("gone");

  mk("gone"); // 같은 이름의 새 덱이 생긴 뒤 복원하면 덮어쓰지 않는다
  const r = await call(api.restoreDeck, { entry: t.json.entry });
  expect(r.status).toBe(200);
  expect(r.json.folder).toBe("gone-restored");
  expect(readFileSync(join(dir, "gone", "index.html"), "utf8")).toContain("<h1>gone</h1>"); // 새 덱이 그대로
  expect(readFileSync(join(dir, "gone-restored", "index.html"), "utf8")).toContain('"id":"gone-restored"');

  const t2 = await call(api.trashDeck, { folder: "gone-restored" });
  expect((await call(api.purgeDeck, { entry: t2.json.entry }, { confirm: "wrong" })).status).toBe(400);
  expect((await call(api.purgeDeck, { entry: t2.json.entry }, {})).status).toBe(400);
  expect(existsSync(join(dir, ".trash", t2.json.entry))).toBe(true); // 확인이 틀리면 남는다
  expect((await call(api.purgeDeck, { entry: t2.json.entry }, { confirm: "gone-restored" })).status).toBe(200);
  expect(existsSync(join(dir, ".trash", t2.json.entry))).toBe(false);
});

test("휴지통 항목 이름은 형식을 지켜야 하고 경로 이탈은 404다", async () => {
  mk("victim");
  for (const entry of ["../victim", "victim", "..", "a/b", "victim-2026-10-15"]) {
    expect((await call(api.restoreDeck, { entry })).status).toBe(404);
    expect((await call(api.purgeDeck, { entry }, { confirm: "victim" })).status).toBe(404);
  }
  expect(existsSync(join(dir, "victim", "index.html"))).toBe(true);
});
