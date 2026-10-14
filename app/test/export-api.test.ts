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

test("pdf 옵션: 잘못된 mode나 per는 실행 없이 400, 올바른 값은 engine/pdf.ts에 인자로 넘어간다", async () => {
  const calls: string[][] = [];
  const r = makeRoutes(async (_s, _i, _e, _l, args) => { calls.push(args ?? []); return { code: 0, lines: [] }; });
  for (const b of [{ mode: "x" }, { mode: "handout", per: 5 }, { mode: "handout", per: "3" }, { mode: 7 }]) {
    const res = await r["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop", b));
    expect(res.status, JSON.stringify(b)).toBe(400);
    expect(((await res.json()) as any).code).toBe("pdf-options");
  }
  expect(calls.length).toBe(0);
  await r["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop", {}));
  await r["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop", { mode: "notes" }));
  await r["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop", { mode: "handout", per: 4 }));
  await r["/api/decks/:id/pdf"].POST(req("vibe-coding-workshop", { mode: "handout" }));
  expect(calls).toEqual([[], ["--notes"], ["--handout", "4"], ["--handout", "3"]]);
  const dl = r["/api/decks/:id/download"].GET;
  expect((await dl(req("vibe-coding-workshop", undefined, "http://x/?kind=zip"))).status).toBe(400);
});

// ---- 게시 기록과 게시 취소(.publish.json). 실제 덱은 건드리지 않고 임시 덱 폴더를 만들었다 지운다. ----
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join as pjoin } from "node:path";
import { deckFingerprint, readPublish, recordPublish } from "../../engine/publish-record";

const PUB_DECK = "qa-pub-unit";
const pubDir = pjoin(import.meta.dir, "..", "..", "decks", PUB_DECK);
const withPubDeck = async (fn: () => Promise<void>) => {
  rmSync(pubDir, { recursive: true, force: true });
  mkdirSync(pubDir, { recursive: true });
  cpSync(pjoin(pubDir, "..", "vibe-coding-workshop", "index.html"), pjoin(pubDir, "index.html"));
  try { await fn(); } finally { rmSync(pubDir, { recursive: true, force: true }); }
};
const entry = () => ({ name: PUB_DECK, url: `https://static.vynnlee.com/${PUB_DECK}`, at: new Date().toISOString(), visibility: "public" as const, bytes: 1234, sha: deckFingerprint(pubDir) });
const lines = async (res: Response) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);

test("published: 기록이 없으면 false, 있으면 주소와 시각, 덱이 바뀌면 changed", async () => {
  await withPubDeck(async () => {
    const r = makeRoutes(ok());
    expect(((await (await r["/api/decks/:id/published"].GET(req(PUB_DECK))).json()) as any).published).toBe(false);
    recordPublish(pubDir, entry());
    const j = (await (await r["/api/decks/:id/published"].GET(req(PUB_DECK))).json()) as any;
    expect(j).toMatchObject({ published: true, name: PUB_DECK, visibility: "public", changed: false });
    expect(j.history.length).toBe(1);
    writeFileSync(pjoin(pubDir, "index.html"), readFileSync(pjoin(pubDir, "index.html"), "utf8").replace("</body>", "<!-- edit --></body>"));
    expect(((await (await r["/api/decks/:id/published"].GET(req(PUB_DECK))).json()) as any).changed).toBe(true);
    expect((await r["/api/decks/:id/published"].GET(req("../x"))).status).toBe(404);
  });
});

test("unpublish: confirm 필수, 기록 없으면 409, 읽기 전용 403, 실제 실행은 --yes와 기록의 name으로", async () => {
  await withPubDeck(async () => {
    const calls: { script: string; id: string; args?: string[] }[] = [];
    const r = makeRoutes(async (script, id, _env, _on, args) => { calls.push({ script, id, args }); return { code: 0, lines: [`Unpublished https://static.vynnlee.com/${id}`] }; });
    expect((await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, {}))).status).toBe(400); // confirm 없음
    expect((await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true }))).status).toBe(409); // 기록 없음
    recordPublish(pubDir, entry());
    process.env.SLIDEKIT_READONLY_DECKS = PUB_DECK;
    expect((await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true }))).status).toBe(403);
    delete process.env.SLIDEKIT_READONLY_DECKS;
    expect(calls.length).toBe(0); // 거절된 요청은 CLI를 부르지 않았다
    const out = await lines(await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true })));
    expect(out.at(-1)).toEqual({ done: true, dryRun: false });
    expect(calls).toEqual([{ script: "deploy/unpublish.ts", id: PUB_DECK, args: ["--yes"] }]);
    const rec = readPublish(pubDir);
    expect(rec.current).toBeNull();
    expect(rec.history[0].unpublishedAt).toBeTruthy();
  });
});

test("unpublish: dry-run은 기록을 그대로 두고, 토큰 없음과 이미 없음은 사람이 읽는 오류", async () => {
  await withPubDeck(async () => {
    recordPublish(pubDir, entry());
    const dry = makeRoutes(async () => ({ code: 0, lines: ["Dry run: would delete meta:x, html:x"] }));
    expect((await lines(await dry["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true })))).at(-1)).toEqual({ done: true, dryRun: true });
    expect(readPublish(pubDir).current).not.toBeNull(); // 아무것도 지우지 않았다
    const noToken = makeRoutes(async () => ({ code: 1, lines: ["키체인 slidekit-cloudflare-token을 찾지 못했다"] }));
    const e1 = (await lines(await noToken["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true })))).at(-1);
    expect(e1.error).toMatch(/Cloudflare token/);
    expect(e1.details).toContain("키체인"); // 한국어 출력은 details에만
    expect(readPublish(pubDir).current).not.toBeNull();
    const gone = makeRoutes(async () => ({ code: 3, lines: ["게시된 덱: (없음)"] }));
    const e2 = (await lines(await gone["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true })))).at(-1);
    expect(e2.error).toMatch(/Nothing is published/);
    expect(readPublish(pubDir).current).toBeNull(); // 낡은 기록은 정리한다
  });
});

test("unpublish: 기록의 name이 폴더와 다르면 confirmName이 같아야 CLI를 부른다", async () => {
  await withPubDeck(async () => {
    const calls: string[] = [];
    const r = makeRoutes(async (_s, id) => { calls.push(id); return { code: 0, lines: [`Unpublished https://static.vynnlee.com/${id}`] }; });
    recordPublish(pubDir, { ...entry(), name: "my-talk", url: "https://static.vynnlee.com/my-talk" });
    expect((await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true }))).status).toBe(400);
    expect((await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true, confirmName: "other" }))).status).toBe(400);
    expect(calls.length).toBe(0);
    await lines(await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true, confirmName: "my-talk" })));
    expect(calls).toEqual(["my-talk"]);
  });
});

test("unpublish: 로그에 '게시된 덱' 문구가 있어도 종료 코드 1이면 기록을 지우지 않는다", async () => {
  await withPubDeck(async () => {
    recordPublish(pubDir, entry());
    const r = makeRoutes(async () => ({ code: 1, lines: ["wrangler 삭제 실패", "게시된 덱: x"] }));
    const e = (await lines(await r["/api/decks/:id/unpublish"].POST(req(PUB_DECK, { confirm: true })))).at(-1);
    expect(e.error).toMatch(/Could not unpublish/);
    expect(readPublish(pubDir).current).not.toBeNull();
  });
});

test("outline: Markdown 본문(노트는 기본 포함, notes=0이면 제외), 내려받기 헤더, 없는 덱은 404, 게시 기록은 담지 않는다", async () => {
  await withPubDeck(async () => {
    writeFileSync(pjoin(pubDir, "index.html"), `<!doctype html><html><head><script type="application/json" id="deck-meta">{"title":"개요","author":"a"}</script></head><body><section data-slide="cover"><h1>표지</h1><aside data-notes>노트 글</aside></section></body></html>`);
    recordPublish(pubDir, entry());
    const r = makeRoutes(ok());
    const get = (q = "") => r["/api/decks/:id/outline"].GET(Object.assign(new Request(`http://x/?${q}`), { params: { id: PUB_DECK } }) as any);
    const res = await get();
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toBeNull();
    const md = await res.text();
    expect(md.startsWith("# ")).toBe(true);
    expect(md).toContain("## 1. ");
    expect(md).toContain("> Notes:");
    expect(md).not.toContain("static.vynnlee.com"); // .publish.json의 주소는 들어가지 않는다
    expect(await (await get("notes=0")).text()).not.toContain("> Notes:");
    expect((await get("download=1")).headers.get("content-disposition")).toBe(`attachment; filename="${PUB_DECK}.md"`);
    expect((await r["/api/decks/:id/outline"].GET(req("../x"))).status).toBe(404);
  });
});
