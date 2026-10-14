import { expect, test } from "bun:test";
import { guardReq } from "../guard";

const req = (h: Record<string, string>, method = "POST") => new Request("http://127.0.0.1:3200/api/x", { method, headers: { host: "127.0.0.1:3200", "content-type": "application/json", ...h } });

test("정상 요청은 통과, 낯선 Host와 Origin은 403", () => {
  expect(guardReq(req({}))).toBeNull();
  expect(guardReq(req({ host: "evil.example" }))?.status).toBe(403);
  expect(guardReq(req({ origin: "http://evil.example" }))?.status).toBe(403);
  expect(guardReq(req({ origin: "http://127.0.0.1:3200" }))).toBeNull();
});
test("Origin: null이나 깨진 값은 예외 없이 403, cross-site 요청도 403", () => {
  expect(guardReq(req({ origin: "null" }))?.status).toBe(403);
  expect(guardReq(req({ origin: "::::" }))?.status).toBe(403);
  expect(guardReq(req({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  expect(guardReq(req({ "sec-fetch-site": "same-origin" }))).toBeNull();
});
test("JSON이 아닌 변경 요청은 415", () => {
  expect(guardReq(req({ "content-type": "text/plain" }))?.status).toBe(415);
});
