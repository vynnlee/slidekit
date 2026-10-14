import { expect, test } from "bun:test";
import { handle, hashPassword, makeCookie, type Env } from "./index";

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
  // 공개 덱은 덱 스크립트가 돌아야 해서 script-src를 건드리지 않는다. 입력 폼은 nonce 기반 CSP다.
  expect((await get("open")).headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
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
