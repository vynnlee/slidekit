import { expect, test } from "bun:test";
import { MAX_HOSTS, cleanHosts, deckCsp, isHost } from "./csp";

test("isHost: 소문자 도메인만(와일드카드, 스킴, 경로, 포트, 대문자, 단일 레이블, IP, 너무 긴 이름은 거부)", () => {
  for (const ok of ["fonts.gstatic.com", "a.io", "cdn-1.example.co.kr", "x.y.z.example.com", "xn--abc.com"]) expect(isHost(ok), ok).toBe(true);
  for (const bad of ["", "*", "*.example.com", "https://a.com", "a.com/x", "a.com:80", "A.com", "localhost", "a", "1.2.3.4", "a..com", "-a.com", "a-.com", ".a.com", "a.com.", "a b.com", "a.c", "a_b.com", "x".repeat(64) + ".com", ("a.".repeat(130)) + "com", 1, null, undefined, {}, ["a.com"]]) expect(isHost(bad), String(bad)).toBe(false);
});

test("cleanHosts: 배열이 아니면 빈 목록, 유효한 것만 중복 없이 순서대로 MAX_HOSTS개까지", () => {
  for (const v of [undefined, null, "a.com", 5, {}, { 0: "a.com", length: 1 }]) expect(cleanHosts(v)).toEqual([]);
  expect(cleanHosts(["a.com", "b.com", "a.com", "*", "C.com", 3])).toEqual(["a.com", "b.com"]);
  const many = Array.from({ length: 50 }, (_, i) => `h${i}.example.com`);
  expect(cleanHosts(many).length).toBe(MAX_HOSTS);
  expect(cleanHosts(many)[0]).toBe("h0.example.com");
});

test("deckCsp: 호스트가 없으면 가장 엄격하고, 호스트는 https로 이미지, 미디어, 글꼴, 스타일에만 들어가며 연결은 항상 막는다", () => {
  const strict = deckCsp([]);
  expect(strict).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const withHosts = deckCsp(["a.example.com", "b.example.com"]);
  const d = Object.fromEntries(withHosts.split("; ").map((x) => [x.split(" ")[0], x]));
  for (const k of ["style-src", "img-src", "font-src", "media-src"]) expect(d[k], k).toContain("https://a.example.com https://b.example.com");
  for (const k of ["default-src", "script-src", "connect-src", "form-action", "frame-src", "object-src", "worker-src", "manifest-src", "base-uri", "frame-ancestors"]) expect(d[k], k).not.toContain("example.com");
  expect(d["connect-src"]).toBe("connect-src 'none'");
  expect(withHosts).not.toMatch(/http:|\*/);
});
