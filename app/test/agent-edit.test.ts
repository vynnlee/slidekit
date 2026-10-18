// slidekit_edit: old_str 유일성, 순차 적용과 원자성, revision 충돌, 경로 이탈, 슬라이드 계산, 이벤트 순서. 실행: bun test app/test/agent-edit.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdits, changedSlides, revisionOf, slideOf } from "../slide-edit";

const deckHtml = `<!doctype html><html data-slidekit="1"><body>
<section data-slide data-kind="cover"><h1>첫 장</h1></section>
<section data-slide data-kind="content"><h2>둘째 장</h2><p>같은 문장</p><p>같은 문장</p></section>
<section data-slide data-kind="end"><h2>끝</h2></section>
</body></html>`;

test("applyEdits: 정확히 1번만 바꾸고 슬라이드 번호를 준다", () => {
  const r = applyEdits(deckHtml, [{ old_str: "<h1>첫 장</h1>", new_str: "<h1>시작</h1>" }, { old_str: "<h2>끝</h2>", new_str: "<h2>마침</h2>" }]);
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.slides).toEqual([1, 3]); expect(r.out).toContain("<h1>시작</h1>"); expect(r.out).toContain("<h2>마침</h2>"); expect(r.excerpt).toBe("첫 장"); }
});
test("applyEdits: 0번과 2번 이상은 거절하고 힌트를 준다", () => {
  const none = applyEdits(deckHtml, [{ old_str: "<h2>  둘째 장</h2>", new_str: "x" }]);
  expect(none).toMatchObject({ ok: false, error: "not_found", index: 0 });
  const two = applyEdits(deckHtml, [{ old_str: "<p>같은 문장</p>", new_str: "<p>다른</p>" }]);
  expect(two).toMatchObject({ ok: false, error: "ambiguous" });
  if (!two.ok) expect(two.hints![0].line).toBe(3);
  expect(applyEdits("aaa", [{ old_str: "aa", new_str: "b" }])).toMatchObject({ ok: false, error: "ambiguous" }); // 겹치는 경우도 센다
});
test("applyEdits: 중간 본문에 차례로 적용하고 하나라도 실패하면 전부 실패", () => {
  const seq = applyEdits(deckHtml, [{ old_str: "첫 장", new_str: "AAA" }, { old_str: "AAA", new_str: "BBB" }]);
  expect(seq.ok && seq.out.includes("BBB")).toBe(true);
  const half = applyEdits(deckHtml, [{ old_str: "첫 장", new_str: "AAA" }, { old_str: "없는 글", new_str: "x" }]);
  expect(half).toMatchObject({ ok: false, error: "not_found", index: 1 });
  expect(applyEdits(deckHtml, [{ old_str: "끝", new_str: "끝" }])).toMatchObject({ ok: false, error: "no_change" });
});
test("applyEdits: 덱 표식을 지우는 수정은 거절", () => {
  expect(applyEdits(deckHtml, [{ old_str: ' data-slidekit="1"', new_str: "" }])).toMatchObject({ ok: false, error: "breaks_deck" });
});
test("changedSlides: 끼어든 슬라이드만 잡고 번호는 새 기준", () => {
  const ins = deckHtml.replace('<section data-slide data-kind="content">', '<section data-slide data-kind="content"><h2>새</h2></section>\n<section data-slide data-kind="content">');
  expect(changedSlides(deckHtml, ins).map((c) => c.slide)).toEqual([2]);
  const edited = deckHtml.replace("<h2>끝</h2>", "<h2>마침</h2>");
  expect(changedSlides(deckHtml, edited)).toEqual([{ slide: 3, excerpt: "마침" }]);
  expect(changedSlides(deckHtml, deckHtml)).toEqual([]);
  expect(slideOf(deckHtml, deckHtml.indexOf("둘째"))).toBe(2);
});
test("revisionOf: sha256 앞 16자리", () => {
  expect(revisionOf("abc")).toBe("ba7816bf8f01cfea");
});

// 라우트: 임시 덱 폴더, 이벤트 스트림으로 순서 확인
const dir = mkdtempSync(join(tmpdir(), "sk-agent-edit-"));
mkdirSync(join(dir, "d"));
writeFileSync(join(dir, "d", "index.html"), deckHtml);
process.env.SLIDEKIT_DECKS = dir;
process.env.SLIDEKIT_KEY_FILE = join(dir, "test.key");
const { routes } = await import("../agent-edit");
const ev = (await import("../comments")).routes["/api/events"] as (r: Request, s: { timeout(r: Request, s: number): void }) => Response;
const stream = ev(new Request("http://127.0.0.1/api/events"), { timeout() {} }).body!.getReader() as unknown as ReadableStreamDefaultReader<string>;
const call = (folder: string, body: unknown) => (routes["/api/decks/:folder/edit"].POST as (r: any) => Promise<Response>)(Object.assign(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body) }), { params: { folder } }));
const file = join(dir, "d", "index.html");
let seen = "";
const events = async (n: number) => {
  while ((seen.match(/event: agent\./g) ?? []).length < n) seen += (await stream.read()).value ?? "";
  return [...seen.matchAll(/event: (agent\.[\w.]+)\ndata: (.*)\n/g)].map((m) => ({ name: m[1], ...JSON.parse(m[2]) }));
};

test("라우트: 적용, 이벤트 start와 done, 응답에 lint와 revision", async () => {
  const r = await call("d", { edits: [{ old_str: "<h2>끝</h2>", new_str: "<h2>마침</h2>" }], base_revision: revisionOf(deckHtml) });
  const b: any = await r.json();
  expect(r.status).toBe(200);
  expect(b).toMatchObject({ ok: true, revision: revisionOf(readFileSync(file, "utf8")), changed: [{ slide: 3 }] });
  expect(Array.isArray(b.lint)).toBe(true);
  const e = await events(2);
  expect(e.map((x) => x.name)).toEqual(["agent.edit.start", "agent.edit.done"]);
  expect(e[0]).toMatchObject({ deck: "d", kind: "edit", slide: 3, ttl: 10000, agent: "claude" });
  expect(e[0].id).toBe(e[1].id);
  expect(e[1]).toMatchObject({ via: "tool", revision: b.revision });
  expect(readdirSync(join(dir, "d")).some((n) => n.includes(".tmp-"))).toBe(false);
});
test("라우트: revision 충돌과 실패는 파일을 바꾸지 않고 fail 이벤트", async () => {
  const before = readFileSync(file, "utf8");
  const r = await call("d", { edits: [{ old_str: "<h1>첫 장</h1>", new_str: "<h1>x</h1>" }], base_revision: revisionOf(deckHtml) });
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ error: "revision_mismatch", revision: revisionOf(before) });
  const r2 = await call("d", { edits: [{ old_str: "<h1>첫 장</h1>", new_str: "<h1>x</h1>" }, { old_str: "없음", new_str: "y" }] });
  expect(await r2.json()).toMatchObject({ error: "not_found", index: 1 });
  expect(readFileSync(file, "utf8")).toBe(before);
  const e = await events(4);
  expect(e.slice(2).map((x) => [x.name, x.reason])).toEqual([["agent.edit.fail", "revision_mismatch"], ["agent.edit.fail", "not_found"]]);
});
test("라우트: 경로 이탈, 잘못된 deck과 입력은 거절", async () => {
  for (const f of ["../d", "..", "nope", ".trash", "d/../d"]) expect((await call(f, { edits: [{ old_str: "a", new_str: "b" }] })).status).toBe(404);
  const bodies = [null, {}, { edits: [] }, { edits: [{ old_str: "", new_str: "b" }] }, { edits: [{ old_str: "a" }] }, { edits: [{ old_str: "a".repeat(200001), new_str: "b" }] }, { edits: Array(51).fill({ old_str: "a", new_str: "b" }) }, { edits: [{ old_str: "a", new_str: "b" }], base_revision: "xyz" }];
  for (const body of bodies) expect((await call("d", body)).status).toBe(400);
});
