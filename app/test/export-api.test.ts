import { expect, test } from "bun:test";
import { makeRoutes } from "../export-api";

const req = (id: string, body?: unknown, url = "http://x/") => Object.assign(new Request(url, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { id } });
const ok = (code = 0, lines: string[] = []) => async () => ({ code, lines });

test("덱 id 검증: 형식이 틀리거나 없는 덱은 404", async () => {
  const r = makeRoutes(ok());
  for (const id of ["../x", "A", "_qa", "no-such-deck", "a b", "-x"]) {
    expect((await r["/api/decks/:id/bundle"].POST(req(id))).status).toBe(404);
    expect((await r["/api/decks/:id/deploy"].POST(req(id, { confirm: true }))).status).toBe(404);
  }
});

test("confirm 없이는 deploy 400, 실행도 하지 않는다", async () => {
  let ran = 0;
  const r = makeRoutes(async () => { ran++; return { code: 0, lines: [] }; });
  for (const b of [{}, { confirm: false }, { confirm: "true" }]) expect((await r["/api/decks/:id/deploy"].POST(req("vibe-coding-workshop", b))).status).toBe(400);
  expect((await r["/api/decks/:id/deploy"].POST(Object.assign(new Request("http://x/", { method: "POST", body: "{", headers: { "content-type": "application/json" } }), { params: { id: "vibe-coding-workshop" } }))).status).toBe(400);
  expect(ran).toBe(0);
});

test("동시 실행은 409, 끝나면 다시 가능", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const r = makeRoutes(async () => { await gate; return { code: 1, lines: ["boom"] }; });
  const first = r["/api/decks/:id/bundle"].POST(req("vibe-coding-workshop"));
  await Bun.sleep(5);
  expect((await r["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop"))).status).toBe(409);
  expect((await r["/api/decks/:id/deploy"].POST(req("vibe-coding-workshop", { confirm: true }))).status).toBe(409);
  release();
  expect((await first).status).toBe(500);
  expect((await r["/api/decks/:id/bundle"].POST(req("vibe-coding-workshop"))).status).toBe(500); // 잠금이 풀렸다
});

test("download: kind 검증과 산출물이 없으면 404", () => {
  const r = makeRoutes(ok());
  expect(r["/api/decks/:id/download"].GET(req("vibe-coding-workshop", undefined, "http://x/?kind=exe")).status).toBe(400);
  expect(r["/api/decks/:id/download"].GET(req("no-such", undefined, "http://x/?kind=html")).status).toBe(404);
});
