import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanHosts } from "./hosts";

const page = (body: string, head = "") => `<!doctype html><html data-slidekit="1"><head><script type="application/json" id="deck-meta">{"id":"x","note":"fetch( WebSocket"}</script>${head}</head><body>${body}</body></html>`;

test("scanHosts: 이미지, 미디어, 글꼴, 스타일, srcset, url(), @import의 https 호스트를 모은다", () => {
  const html = page(
    `<img src="https://img.example.com/a.png"><img srcset="https://cdn.example.com/a.png 1x, https://cdn2.example.com/b.png 2x" src="data:image/png;base64,AAAA"><video poster='https://poster.example.com/p.jpg'><source src="https://vid.example.com/v.mp4"></video><div style="background:url('https://bg.example.com/x.png')"></div><a href="https://link.example.com/">link</a>`,
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>@import url("https://css.example.com/x.css"); @font-face{src:url(https://fonts.gstatic.com/s/a.woff2)}</style>`);
  const r = scanHosts(html);
  expect(r.hosts.sort()).toEqual(["bg.example.com", "cdn.example.com", "cdn2.example.com", "css.example.com", "fonts.googleapis.com", "fonts.gstatic.com", "img.example.com", "poster.example.com", "vid.example.com"]);
  expect(r.hosts).not.toContain("link.example.com"); // <a href>는 CSP가 다루지 않는다
  expect(r.skipped).toEqual([]); expect(r.blocked).toEqual([]);
});

test("scanHosts: data:와 상대 경로는 무시하고, http와 형식이 틀린 호스트와 초과는 skipped에 이유와 함께", () => {
  const r = scanHosts(page(`<img src="data:image/png;base64,AAAA"><img src="assets/a.png"><img src="http://plain.example.com/a.png"><img src="https://UPPER.Example.com/a.png"><img src="https://localhost/x.png"><img src="https://1.2.3.4/x.png"><img src="https://user@auth.example.com:8443/x.png">`));
  expect(r.hosts).toEqual(["upper.example.com", "auth.example.com"]); // 대문자는 소문자로, user@와 포트는 떼어 낸다
  expect(r.skipped.some((s) => s.startsWith("http://plain.example.com"))).toBe(true);
  expect(r.skipped.some((s) => s.startsWith("localhost"))).toBe(true);
  expect(r.skipped.some((s) => s.startsWith("1.2.3.4"))).toBe(true);
  const many = scanHosts(page(Array.from({ length: 25 }, (_, i) => `<img src="https://h${i}.example.com/a.png">`).join("")));
  expect(many.hosts.length).toBe(20); expect(many.skipped.length).toBe(5); expect(many.skipped[0]).toContain("초과");
});

test("scanHosts: CSP가 막는 사용을 알린다(스크립트의 fetch 등, iframe, 폼 action), deck-meta JSON 안의 글자는 세지 않는다", () => {
  const r = scanHosts(page(`<iframe src="https://x.example.com"></iframe><form action="/send"></form><script>fetch("/a"); new WebSocket("wss://x"); navigator.sendBeacon("/b"); new Worker("w.js"); new XMLHttpRequest()</script>`));
  expect(r.blocked.sort()).toEqual(["WebSocket", "Worker", "XMLHttpRequest", "fetch", "form action", "iframe", "sendBeacon"].sort());
  expect(scanHosts(page(`<p>fetch( is only text</p>`)).blocked).toEqual([]);
  expect(scanHosts(page("")).blocked).toEqual([]); // deck-meta의 "fetch( WebSocket"는 스크립트가 아니다
});

test("scanHosts: 엔진 소스는 막힐 사용을 하나도 하지 않는다(번들 덱이 CSP에서 깨지지 않는 근거)", () => {
  const engine = readFileSync(join(import.meta.dir, "..", "engine", "slidekit.js"), "utf8");
  const r = scanHosts(`<html><body><script>${engine}</script></body></html>`);
  expect(r.blocked).toEqual([]); expect(r.hosts).toEqual([]);
});
