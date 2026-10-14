import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMeta, setMeta } from "../src/lib/deck-meta";

const doc = (meta: string) => `<!doctype html><html><head><title>Old</title>\n<script type="application/json" id="deck-meta">${meta}</script></head><body><section data-slide="cover"><h1>Old</h1></section></body></html>`;

test("readMeta: 읽고, 없거나 깨지면 null", () => {
  expect(readMeta(doc(`{"title":"A","extra":1}`))).toEqual({ title: "A", extra: 1 });
  expect(readMeta("<html></html>")).toBeNull();
  expect(readMeta(doc("{nope"))).toBeNull();
  expect(readMeta(doc("[1]"))).toBeNull();
});

test("setMeta: 값 적용, 순서와 알 수 없는 필드 보존, <title> 동기, 표지 h1은 그대로", () => {
  const r = setMeta(doc(`{"title":"Old","custom":{"a":1},"author":"x"}`), { title: "New", author: "Me", pageNumber: true });
  if (!r.ok) throw new Error("expected ok");
  expect(Object.keys(r.meta)).toEqual(["title", "custom", "author", "pageNumber"]);
  expect(r.meta.custom).toEqual({ a: 1 });
  expect(r.html).toContain("<title>New</title>");
  expect(r.html).toContain("<h1>Old</h1>");
  expect(readMeta(r.html)).toEqual(r.meta);
});

test("setMeta: 빈 값과 null은 키를 지우고 title은 지울 수 없다", () => {
  const r = setMeta(doc(`{"title":"T","subtitle":"s","date":"2026-10-14"}`), { subtitle: "", date: null });
  if (!r.ok) throw new Error("expected ok");
  expect(r.meta).toEqual({ title: "T" });
  const bad = setMeta(doc(`{"title":"T"}`), { title: "" });
  expect(bad.ok).toBe(false);
});

test("setMeta: </script>가 들어간 값은 이스케이프되어 탈출하지 못한다", () => {
  const evil = `</script><script>alert(1)</script>`;
  const r = setMeta(doc(`{"title":"T"}`), { author: evil });
  if (!r.ok) throw new Error("expected ok");
  expect(r.html).not.toContain("</script><script>alert");
  expect(readMeta(r.html)!.author).toBe(evil);
});

test("setMeta: lang을 바꾸면 <html lang>도 맞추고, 지우면 ko", () => {
  const d = doc(`{"title":"T","lang":"ko"}`).replace("<html>", '<html lang="ko" data-x="1">');
  const en = setMeta(d, { lang: "en" });
  if (!en.ok) throw new Error("expected ok");
  expect(en.html).toContain('<html lang="en" data-x="1">');
  const none = setMeta(en.html, { lang: null });
  if (!none.ok) throw new Error("expected ok");
  expect(none.html).toContain('<html lang="ko" data-x="1">');
  expect(readMeta(none.html)).toEqual({ title: "T" });
  const noAttr = setMeta(doc(`{"title":"T"}`), { lang: "en-US" });
  if (!noAttr.ok) throw new Error("expected ok");
  expect(noAttr.html).toContain('<html lang="en-US">');
});

test("setMeta: 비밀번호 계열 키, id, 알 수 없는 키, 잘못된 값을 거부한다", () => {
  const d = doc(`{"title":"T","id":"x"}`);
  for (const p of [{ password: "hunter2" }, { passwordHash: "x" }, { secret: 1 }, { id: "y" }, { nope: 1 }, { date: "2026-02-30" }, { date: "10/14" }, { lang: "korean" }, { visibility: "private" }, { pageNumber: "yes" }, { title: "a\nb" }, { title: "x".repeat(121) }, null, "x"]) {
    const r = setMeta(d, p);
    expect(r.ok).toBe(false);
  }
  expect(setMeta(doc("{nope"), { author: "a" }).ok).toBe(false); // 깨진 메타는 건드리지 않는다
  expect(setMeta(d, { lang: "en-US", visibility: "password", date: "2024-02-29" }).ok).toBe(true);
});

test("서버 PATCH: base가 맞을 때만 쓰고, 오래된 base는 409, 검증 실패는 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-meta-"));
  mkdirSync(join(dir, "d1"));
  const file = join(dir, "d1", "index.html");
  writeFileSync(file, doc(`{"title":"T"}`));
  process.env.SLIDEKIT_DECKS = dir;
  const api = await import(`../decks-api.ts?x=${Date.now()}`);
  const req = (body: unknown) => Object.assign(new Request("http://x/api/decks/d1/meta", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: { folder: "d1" } });
  const get = await (await api.getMeta(Object.assign(new Request("http://x/"), { params: { folder: "d1" } }))).json();
  expect(get.meta).toEqual({ title: "T" });
  const ok = await api.patchDeckMeta(req({ patch: { author: "Me" }, base: get.mtime }));
  expect(ok.status).toBe(200);
  expect(readMeta(readFileSync(file, "utf8"))).toEqual({ title: "T", author: "Me" });
  // 같은 base로 다시 쓰면(그 사이 파일이 바뀜) 409
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  expect((await api.patchDeckMeta(req({ patch: { author: "Other" }, base: get.mtime }))).status).toBe(409);
  expect(readMeta(readFileSync(file, "utf8"))!.author).toBe("Me");
  const fresh = statSync(file).mtimeMs;
  expect((await api.patchDeckMeta(req({ patch: { password: "x" }, base: fresh }))).status).toBe(400);
  expect((await api.patchDeckMeta(req({ patch: { author: "a" } }))).status).toBe(400); // base 없음
  expect((await api.patchDeckMeta(Object.assign(req({ patch: { author: "a" }, base: fresh }), { params: { folder: "../etc" } }))).status).toBe(404);
});

test("작은따옴표 lang 속성도 하나만 남기고 값이 바뀐다", () => {
  const html = `<!doctype html><html lang='ko' data-x="1"><head><title>t</title><script type="application/json" id="deck-meta">\n    {"id":"a","title":"t"}\n  </script></head><body></body></html>`;
  const r = setMeta(html, { lang: "en" });
  expect(r.ok).toBe(true);
  if (r.ok) { expect((r.html.match(/lang=/g) ?? []).length).toBe(1); expect(r.html).toContain('<html lang="en" data-x="1">'); }
});
