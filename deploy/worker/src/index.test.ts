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
  const good = (await makeCookie("test-secret", "sec")).split(";")[0];
  const forged = good.replace(/\.[^.]*$/, ".AAAA");
  expect(await (await get("sec", forged)).text()).not.toContain("secret");
  const other = (await makeCookie("wrong-secret", "sec")).split(";")[0];
  expect(await (await get("sec", other)).text()).not.toContain("secret");
  const old = (await makeCookie("test-secret", "sec", 0)).split(";")[0];
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
