import { expect, test } from "bun:test";
import { handle, hashPassword, makeCookie, type Env } from "./index";

const pw = await hashPassword("열쇠");
const store: Record<string, string> = {
  "html:open": "<p>open</p>", "meta:open": JSON.stringify({ visibility: "public" }),
  "html:sec": "<p>secret</p>", "meta:sec": JSON.stringify({ visibility: "password", ...pw }),
};
const env: Env = { DECKS: { get: async (k) => store[k] ?? null }, COOKIE_SECRET: "test-secret" };
const post = (p: string) => handle(new Request("https://x/sec", { method: "POST", body: new URLSearchParams({ password: p }) }), env);
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
