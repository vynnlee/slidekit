// tailnet 미리보기 프록시의 거절 규칙(Host 허용 목록, Origin은 Host와 같아야 하고 깨진 값은 거절).
import { expect, test } from "bun:test";
import { forbidden } from "../preview-proxy";

test("허용 Host: 로컬 이름과 tailnet 이름(포트는 무시)", () => {
  for (const h of ["127.0.0.1:3221", "localhost:3221", "mac-cloud.tail5a652b.ts.net", "mac-cloud.tail5a652b.ts.net:3221"]) expect(forbidden(h, null)).toBe(false);
});
test("낯선 Host는 거절(DNS rebinding)", () => {
  for (const h of ["evil.example", "evil.example:3221", "127.0.0.1.evil.example", "", "0.0.0.0:3221", "mac-cloud.tail5a652b.ts.net.evil.com"]) expect(forbidden(h, null)).toBe(true);
});
test("Origin은 있으면 Host와 같아야 한다", () => {
  expect(forbidden("mac-cloud.tail5a652b.ts.net", "https://mac-cloud.tail5a652b.ts.net")).toBe(false);
  expect(forbidden("127.0.0.1:3221", "http://127.0.0.1:3221")).toBe(false);
  expect(forbidden("127.0.0.1:3221", "http://127.0.0.1:9999")).toBe(true); // 다른 포트
  expect(forbidden("127.0.0.1:3221", "https://evil.example")).toBe(true); // 다른 사이트
});
test("깨진 Origin(null, 빈 스킴 없는 값)은 파싱 예외 없이 거절", () => {
  for (const o of ["null", "not a url", "://x", "javascript:alert(1)//"]) expect(() => forbidden("127.0.0.1:3221", o)).not.toThrow();
  expect(forbidden("127.0.0.1:3221", "null")).toBe(true);
  expect(forbidden("127.0.0.1:3221", "not a url")).toBe(true);
});
