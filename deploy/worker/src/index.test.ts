import { expect, test } from "bun:test";
import { PERMISSIONS, deckCsp } from "./csp";
import worker, { handle, hashPassword, Limiter, makeCookie, type Env, type LimiterNs } from "./index";

const pw = await hashPassword("열쇠");
const store: Record<string, string> = {
  "html:open": "<p>open</p>", "meta:open": JSON.stringify({ visibility: "public" }),
  "html:sec": "<p>secret</p>", "meta:sec": JSON.stringify({ visibility: "password", ...pw }),
};
const env: Env = {
  DECKS: { get: async (k) => store[k] ?? null, put: async (k, v) => { store[k] = v; }, delete: async (k) => { delete store[k]; } },
  COOKIE_SECRET: "test-secret",
};
const post = (p: string, ip = "1.1.1.1", now = Date.now()) =>
  handle(new Request("https://x/sec", { method: "POST", headers: { "cf-connecting-ip": ip }, body: new URLSearchParams({ password: p }) }), env, now);
const get = (deck: string, cookie?: string) => handle(new Request(`https://x/${deck}`, { headers: cookie ? { Cookie: cookie } : {} }), env);

test("공개 덱은 그대로 서빙", async () => {
  expect(await (await get("open")).text()).toBe("<p>open</p>");
  expect((await get("nope")).status).toBe(404);
});
test("비밀번호 틀림 401, 맞음 303과 쿠키", async () => {
  expect((await post("틀림")).status).toBe(401);
  const ok = await post("열쇠");
  expect(ok.status).toBe(303);
  const set = ok.headers.get("Set-Cookie")!;
  expect(set).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  expect(await (await get("sec", set.split(";")[0])).text()).toBe("<p>secret</p>");
});
test("쿠키 없음, 위조, 만료는 거부", async () => {
  expect(await (await get("sec")).text()).not.toContain("secret");
  const good = (await makeCookie("test-secret", "sec", pw.salt)).split(";")[0];
  const forged = good.replace(/\.[^.]*$/, ".AAAA");
  expect(await (await get("sec", good)).text()).toBe("<p>secret</p>"); // 올바르게 서명한 쿠키는 통과
  expect(await (await get("sec", forged)).text()).not.toContain("secret");
  const other = (await makeCookie("wrong-secret", "sec", pw.salt)).split(";")[0];
  expect(await (await get("sec", other)).text()).not.toContain("secret");
  const old = (await makeCookie("test-secret", "sec", pw.salt, 0)).split(";")[0];
  expect(await (await get("sec", old)).text()).not.toContain("secret");
});

test("5회 틀리면 429, 맞는 비밀번호도 잠금 중이면 429, 다른 IP는 영향 없음, 시간이 지나면 해제", async () => {
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) expect((await post("틀림", "2.2.2.2", t0)).status).toBe(401);
  const r = await post("열쇠", "2.2.2.2", t0 + 1000);
  expect(r.status).toBe(429);
  expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect((await post("열쇠", "3.3.3.3", t0)).status).toBe(303);
  expect((await post("열쇠", "2.2.2.2", t0 + 16 * 60 * 1000)).status).toBe(303);
});
test("성공하면 카운터 삭제", async () => {
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) await post("틀림", "4.4.4.4", t0);
  expect((await post("열쇠", "4.4.4.4", t0)).status).toBe(303);
  expect(store["rl:sec:4.4.4.4"]).toBeUndefined();
  for (let i = 0; i < 4; i++) expect((await post("틀림", "4.4.4.4", t0)).status).toBe(401);
});

test("폼과 오류 문구는 meta.lang, 없으면 Accept-Language, 기본 ko", async () => {
  store["html:en"] = "<p>x</p>"; store["meta:en"] = JSON.stringify({ visibility: "password", lang: "en", ...pw });
  expect(await (await get("en")).text()).toContain("Password");
  expect(await (await get("sec")).text()).toContain("비밀번호");
  store["meta:nolang"] = JSON.stringify({ visibility: "password", ...pw }); store["html:nolang"] = "x";
  const en = await handle(new Request("https://x/nolang", { headers: { "Accept-Language": "en-US,ko;q=0.5" } }), env);
  expect(await en.text()).toContain("This deck is password protected");
  expect(await (await handle(new Request("https://x/none", { headers: { "Accept-Language": "en" } }), env)).text()).toContain("<h1>Not found</h1>");
  expect(await (await get("none")).text()).toContain("<h1>찾을 수 없습니다</h1>");
});
test("보안 헤더와 캐시", async () => {
  for (const r of [await get("open"), await get("sec"), await post("틀림", "9.9.9.9")]) {
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(r.headers.get("Strict-Transport-Security")).toContain("max-age=");
  }
  // 공개 덱은 덱 스크립트가 돌아야 해서 인라인 스크립트는 허용하되 외부로 나가는 요청은 막는다(spec/WORKER-CSP.md). 입력 폼은 nonce 기반 CSP다.
  const deckCspOpen = (await get("open")).headers.get("Content-Security-Policy")!;
  expect(deckCspOpen).toBe(deckCsp([]));
  expect(deckCspOpen).toContain("connect-src 'none'");
  expect((await get("open")).headers.get("Permissions-Policy")).toBe(PERMISSIONS);
  expect((await get("sec")).headers.get("Content-Security-Policy")).toMatch(/script-src 'nonce-[0-9a-f]{32}'.*form-action 'self'/);
  expect((await get("open")).headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
  expect((await get("sec")).headers.get("Cache-Control")).toBe("private, no-store");
  const ok = await post("열쇠", "8.8.8.8");
  expect((await get("sec", ok.headers.get("Set-Cookie")!.split(";")[0])).headers.get("Cache-Control")).toBe("private, no-store");
});
test("다른 사이트 Origin의 폼 전송은 403, 같은 Origin은 통과", async () => {
  const send = (origin: string) => handle(new Request("https://x/sec", { method: "POST", headers: { Origin: origin, "cf-connecting-ip": "7.7.7.7" }, body: new URLSearchParams({ password: "열쇠" }) }), env);
  expect((await send("https://evil.com")).status).toBe(403);
  expect((await send("https://x")).status).toBe(303);
});

test("안내 페이지: 제목은 이스케이프해 보이고, 잠금 안내는 남은 분을 알려 주고, 404도 같은 모양이다", async () => {
  store["meta:titled"] = JSON.stringify({ visibility: "password", title: '<b>"디자인" & 발표</b>', ...pw }); store["html:titled"] = "x";
  const page = await (await get("titled")).text();
  expect(page).toContain("&lt;b&gt;&quot;디자인&quot; &amp; 발표&lt;/b&gt;");
  expect(page).not.toContain("<b>\"디자인\"");
  for (const a of ['autocomplete="current-password"', 'enterkeyhint="go"', "autofocus", 'name="viewport"']) expect(page).toContain(a);
  const nf = await get("none");
  expect(nf.status).toBe(404);
  expect(await nf.text()).toContain("<main>");
  const now = Date.now();
  let r: Response = await post("x", "9.9.9.9", now);
  for (let i = 0; i < 5; i++) r = await post("x", "9.9.9.9", now);
  expect(r.status).toBe(429);
  expect(await r.text()).toMatch(/약 \d+분 뒤/);
  const bad = await (await post("x", "8.8.8.8", now)).text();
  expect(bad).toContain('aria-invalid="true"');
  expect(bad).toContain('role="alert"');
});

test("보안: 비밀번호(salt)가 바뀌면 옛 쿠키 무효, 보호된 덱은 문서 요청에만 서빙, 메서드와 Origin 방어", async () => {
  const cookie = (await makeCookie("test-secret", "sec", pw.salt)).split(";")[0];
  expect(await (await get("sec", cookie)).text()).toBe("<p>secret</p>");
  const other = await hashPassword("다른 비밀번호");
  store["meta:rot"] = JSON.stringify({ visibility: "password", ...other }); store["html:rot"] = "<p>rot</p>";
  const oldCookie = (await makeCookie("test-secret", "rot", pw.salt)).split(";")[0];
  expect(await (await get("rot", oldCookie)).text()).not.toContain("rot</p>");
  // 같은 출처의 다른 덱 스크립트가 fetch로 읽는 경우(Sec-Fetch-Dest: empty)는 쿠키가 있어도 거부
  const f = await handle(new Request("https://x/sec", { headers: { Cookie: cookie, "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors" } }), env);
  expect(f.status).toBe(403);
  expect((await handle(new Request("https://x/sec", { headers: { Cookie: cookie, "Sec-Fetch-Dest": "document" } }), env)).status).toBe(200);
  expect((await handle(new Request("https://x/open", { method: "DELETE" }), env)).status).toBe(405);
  const nul = await handle(new Request("https://x/sec", { method: "POST", headers: { Origin: "null", "cf-connecting-ip": "6.6.6.6" }, body: new URLSearchParams({ password: "열쇠" }) }), env);
  expect(nul.status).toBe(403);
  store["meta:broken"] = JSON.stringify({ visibility: "password" }); store["html:broken"] = "x";
  expect((await get("broken")).status).toBe(404);
});

// Durable Object 모킹: 객체(이름)마다 요청을 한 줄로 처리한다(실제 DO의 직렬 처리와 같다). 저장소 호출마다 한 틱씩 양보해 끼어들기 틈을 만든다.
function fakeNs() {
  const objs = new Map<string, { chain: Promise<unknown>; obj: Limiter; data: Map<string, unknown>; alarm?: number }>();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const ns: LimiterNs & { objs: typeof objs } = {
    objs,
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (req) => {
        const name = String(id);
        let o = objs.get(name);
        if (!o) {
          const data = new Map<string, unknown>();
          const storage = {
            get: async <T>(k: string) => { await tick(); return data.get(k) as T | undefined; },
            put: async (k: string, v: unknown) => { await tick(); data.set(k, structuredClone(v)); },
            deleteAll: async () => { await tick(); data.clear(); },
            setAlarm: async (t: number) => { objs.get(name)!.alarm = t; },
          };
          o = { chain: Promise.resolve(), obj: new Limiter({ storage }), data };
          objs.set(name, o);
        }
        const cur = o;
        const run = cur.chain.then(() => cur.obj.fetch(req));
        cur.chain = run.catch(() => {});
        return run;
      },
    }),
  };
  return ns;
}
const withDo = (ns: LimiterNs): Env => ({ ...env, LIMITER: ns });
const postE = (e: Env, p: string, ip: string, now = Date.now()) =>
  handle(new Request("https://x/sec", { method: "POST", headers: { "cf-connecting-ip": ip }, body: new URLSearchParams({ password: p }) }), e, now);

test("DO 제한: 동시 요청 30개 중 정확히 5개만 비밀번호를 시험하고 나머지는 429", async () => {
  const e = withDo(fakeNs());
  const rs = await Promise.all(Array.from({ length: 30 }, () => postE(e, "틀림", "21.0.0.1")));
  const codes = rs.map((r) => r.status);
  expect(codes.filter((c) => c === 401).length).toBe(5);
  expect(codes.filter((c) => c === 429).length).toBe(25);
  expect(rs.find((r) => r.status === 429)!.headers.get("Retry-After")).toBeTruthy();
});
test("KV 폴백은 같은 동시 요청에서 5번을 넘겨 뚫린다(DO가 필요한 이유)", async () => {
  const slow: Env = { ...env, DECKS: { ...env.DECKS, get: async (k) => { await new Promise((r) => setTimeout(r, 1)); return store[k] ?? null; } } };
  const rs = await Promise.all(Array.from({ length: 30 }, () => postE(slow, "틀림", "21.0.0.2")));
  expect(rs.filter((r) => r.status === 401).length).toBeGreaterThan(5);
});
test("DO 제한: IP와 덱별로 따로 세고, 맞는 비밀번호는 카운터를 지우며, 잠기면 맞는 비밀번호도 429", async () => {
  const e = withDo(fakeNs());
  for (let i = 0; i < 5; i++) expect((await postE(e, "틀림", "21.0.0.3")).status).toBe(401);
  expect((await postE(e, "열쇠", "21.0.0.3")).status).toBe(429);
  expect((await postE(e, "열쇠", "21.0.0.4")).status).toBe(303); // 다른 IP는 영향 없음
  for (let i = 0; i < 4; i++) await postE(e, "틀림", "21.0.0.4");
  expect((await postE(e, "열쇠", "21.0.0.4")).status).toBe(303); // 맞으면 지워서 다시 시작
  for (let i = 0; i < 5; i++) expect((await postE(e, "틀림", "21.0.0.4")).status).toBe(401);
});
test("DO 제한: 15분이 지나면 다시 시도할 수 있고, 알람이 저장소를 비운다", async () => {
  const ns = fakeNs(), e = withDo(ns), t0 = Date.now();
  for (let i = 0; i < 5; i++) await postE(e, "틀림", "21.0.0.5", t0);
  expect((await postE(e, "열쇠", "21.0.0.5", t0 + 14 * 60_000)).status).toBe(429);
  expect((await postE(e, "열쇠", "21.0.0.5", t0 + 15 * 60_000 + 1)).status).toBe(303);
  const o = ns.objs.get("rl:sec:21.0.0.5")!;
  expect(o.alarm).toBeGreaterThan(t0);
  await o.obj.alarm();
  expect(o.data.size).toBe(0);
});

// 회귀: 런타임은 fetch(request, env, ctx)로 부른다. 셋째 인자(ctx)가 시각으로 새면 쿠키 만료 계산이 깨져 로그인 POST가 500이 된다.
test("런타임 진입점(default.fetch)은 ctx를 시각으로 오해하지 않는다: 맞는 비밀번호는 303과 쿠키", async () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const res = await (worker.fetch as unknown as (r: Request, e: Env, c: unknown) => Promise<Response>)(
    new Request("https://x/sec", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.77" }, body: new URLSearchParams({ password: "열쇠" }) }), env, ctx);
  expect(res.status).toBe(303);
  expect(res.headers.get("Set-Cookie")).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  expect(res.headers.get("Set-Cookie")).not.toContain("NaN"); // ctx가 시각으로 새면 만료 시각이 NaN이 된다(workerd에서는 Invalid Date로 500)
});

test("덱 CSP: meta.hosts를 다시 검증해 정책에 넣고, 틀린 값은 흔적도 없고, 비밀번호 덱은 로그인 뒤에 같은 정책, 폼은 그대로", async () => {
  store["html:ext"] = "<p>x</p>"; store["meta:ext"] = JSON.stringify({ visibility: "public", hosts: ["fonts.gstatic.com", "images.example.com", "*", "https://evil.com", "EVIL.com", "a.b/path", "evil.com:8080", "localhost", "1.2.3.4", 5, null, "images.example.com"] });
  const csp = (await get("ext")).headers.get("Content-Security-Policy")!;
  expect(csp).toBe(deckCsp(["fonts.gstatic.com", "images.example.com"]));
  expect(csp).toContain("img-src data: blob: https://fonts.gstatic.com https://images.example.com");
  expect(csp).toContain("font-src data: https://fonts.gstatic.com https://images.example.com");
  expect(csp).not.toMatch(/evil|\*|localhost|1\.2\.3\.4/);
  expect(csp).toContain("connect-src 'none'");
  store["meta:bad1"] = JSON.stringify({ visibility: "public", hosts: "fonts.gstatic.com" }); store["html:bad1"] = "x";
  store["meta:bad2"] = JSON.stringify({ visibility: "public", hosts: { 0: "a.example.com" } }); store["html:bad2"] = "x";
  for (const d of ["open", "bad1", "bad2"]) expect((await get(d)).headers.get("Content-Security-Policy")).toBe(deckCsp([])); // hosts가 없거나 배열이 아니면 가장 엄격
  store["meta:sec"] = JSON.stringify({ visibility: "password", hosts: ["fonts.gstatic.com"], ...pw });
  const form = await get("sec");
  expect(form.headers.get("Content-Security-Policy")).toMatch(/^default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-[0-9a-f]{32}'; form-action 'self'/); // 폼은 이미 더 엄격하고 호스트를 넣지 않는다
  expect(form.headers.get("Permissions-Policy")).toBeNull();
  const ok = await post("열쇠", "6.6.6.6");
  const opened = await get("sec", ok.headers.get("Set-Cookie")!.split(";")[0]);
  expect(opened.headers.get("Content-Security-Policy")).toBe(deckCsp(["fonts.gstatic.com"]));
  expect(opened.headers.get("Permissions-Policy")).toBe(PERMISSIONS);
  store["meta:sec"] = JSON.stringify({ visibility: "password", ...pw }); // 다른 시험을 위해 되돌린다
});

// ---- /<덱>/deck.md (spec/DECK-MD-DEPLOY.md) ----
const mdGet = (path: string, init: RequestInit = {}) => handle(new Request(`https://x${path}`, init), env);
test("deck.md: 공개 덱은 누구나 읽고(curl 포함), 헤더는 text/markdown과 엄격한 CSP, HEAD는 본문 없음", async () => {
  store["md:open"] = "# 공개 덱\n\n## 1. 제목\n";
  const r = await mdGet("/open/deck.md");
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("# 공개 덱\n\n## 1. 제목\n");
  expect(r.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
  expect(r.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  expect(r.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
  expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(r.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  const h = await mdGet("/open/deck.md", { method: "HEAD" });
  expect(h.status).toBe(200); expect(await h.text()).toBe("");
  expect((await mdGet("/open/deck.md", { headers: { "Sec-Fetch-Dest": "empty" } })).status).toBe(200); // 공개 덱에는 Sec-Fetch-Dest 검사가 없다
  expect((await mdGet("/open/deck.md", { method: "POST", body: "x" })).status).toBe(405);
});

test("deck.md: md나 meta가 없거나 하위 경로가 다르면 404, 이름 규칙 밖이면 404", async () => {
  expect((await mdGet("/nope/deck.md")).status).toBe(404);
  store["meta:nomd"] = JSON.stringify({ visibility: "public" }); store["html:nomd"] = "x";
  expect((await mdGet("/nomd/deck.md")).status).toBe(404); // 옛 게시본: md 없음
  for (const p of ["/open/deck.md/x", "/open/other.md", "/open/deck.MD", "/a b/deck.md", "/../deck.md", "/open/deck.markdown"]) expect((await mdGet(p)).status, p).toBe(404);
  expect(await (await mdGet("/open")).text()).toBe("<p>open</p>"); // 덱 HTML 경로는 그대로
});

test("deck.md: 비밀번호 덱은 쿠키 없이 403(본문 없음), 쿠키가 있어도 문서가 아닌 요청이나 다른 덱의 쿠키는 403, 통과하면 no-store", async () => {
  store["md:sec"] = "# 비밀 덱\n\nSECRET-BODY\n";
  const none = await mdGet("/sec/deck.md");
  expect(none.status).toBe(403);
  expect(await none.text()).not.toContain("SECRET-BODY");
  expect(none.headers.get("Content-Type")).toContain("text/plain");
  expect((await mdGet("/sec/deck.md", { headers: { Cookie: "sk_sec=1.bad" } })).status).toBe(403);
  const ok = await post("열쇠", "5.5.5.5");
  const cookie = ok.headers.get("Set-Cookie")!.split(";")[0];
  const good = await mdGet("/sec/deck.md", { headers: { Cookie: cookie, "Sec-Fetch-Dest": "document" } });
  expect(good.status).toBe(200);
  expect(await good.text()).toContain("SECRET-BODY");
  expect(good.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await mdGet("/sec/deck.md", { headers: { Cookie: cookie } })).status).toBe(200); // curl처럼 헤더가 없으면 쿠키만 본다
  expect((await mdGet("/sec/deck.md", { headers: { Cookie: cookie, "Sec-Fetch-Dest": "empty" } })).status).toBe(403); // 같은 출처 다른 덱의 fetch
  store["meta:other"] = JSON.stringify({ visibility: "password", ...pw }); store["html:other"] = "x"; store["md:other"] = "# other";
  expect((await mdGet("/other/deck.md", { headers: { Cookie: cookie } })).status).toBe(403); // 쿠키는 덱마다
});
