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

test("비밀번호 덱: 6자 미만이나 없는 비밀번호는 400, 공개 범위는 덱 원본으로 판단", async () => {
  const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(import.meta.dir, "..", "..", "decks", "qa-pwlen");
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "index.html"), `<html data-slidekit="1"><head><script type="application/json" id="deck-meta">{"title":"t","visibility":"password"}</script></head><body><section data-slide="cover"><h1>x</h1></section></body></html>`);
    let ran = 0;
    const r = makeRoutes(async () => { ran++; return { code: 0, lines: [] }; });
    const p = (b: unknown) => r["/api/decks/:id/deploy"].POST(req("qa-pwlen", b));
    expect((await p({ confirm: true })).status).toBe(400);
    expect((await p({ confirm: true, password: "1234567" })).status).toBe(400);
    expect(ran).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("배포 전 점검: 잘못된 id는 404, 실제 덱은 lint 개수, 공개 범위, 크기 추정을 준다(읽기만 한다)", async () => {
  const r = makeRoutes(ok());
  expect((await r["/api/decks/:id/check"].GET(req("../x"))).status).toBe(404);
  const res = await r["/api/decks/:id/check"].GET(req("vibe-coding-workshop"));
  expect(res.status).toBe(200);
  const j = (await res.json()) as any;
  expect(j.errors).toBe(0);
  expect(typeof j.warnings).toBe("number");
  expect(["public", "password", "unknown"]).toContain(j.visibility);
  expect(j.estimatedBytes).toBeGreaterThan(100_000);
  expect(Array.isArray(j.largeImages)).toBe(true);
  expect(j.issues.length).toBeLessThanOrEqual(5);
});

test("오류는 사람이 읽는 문장과 code를 주고, 엔진 출력은 details로 따로 준다", async () => {
  const r = makeRoutes(async () => ({ code: 1, lines: ["준비", "번들 실패: boom"] }));
  const nf = (await (await r["/api/decks/:id/bundle"].POST(req("../x"))).json()) as any;
  expect(nf.code).toBe("deck");
  expect(nf.error).toMatch(/not found|cannot be exported/);
  const fail = await r["/api/decks/:id/bundle"].POST(req("vibe-coding-workshop"));
  expect(fail.status).toBe(500);
  const j = (await fail.json()) as any;
  expect(j.code).toBe("bundle-failed");
  expect(j.error).toMatch(/could not be built/);
  expect(j.details).toContain("번들 실패: boom"); // 엔진 한국어 출력은 details에만 있다
  expect(j.error).not.toContain("번들");
  const busy = makeRoutes(async () => { await Bun.sleep(30); return { code: 0, lines: [] }; });
  const first = busy["/api/decks/:id/bundle"].POST(req("vibe-coding-workshop"));
  await Bun.sleep(5);
  expect(((await (await busy["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop"))).json()) as any).code).toBe("busy");
  await first;
});

test("cancel: 돌고 있는 것이 없으면 canceled false", async () => {
  const r = makeRoutes(ok());
  const j = (await (await r["/api/export/cancel"].POST()).json()) as any;
  expect(j).toEqual({ ok: true, canceled: false });
});
