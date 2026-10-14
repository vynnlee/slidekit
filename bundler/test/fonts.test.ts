import { expect, test } from "bun:test";
import { faceBlocks, fetchCached, isPrivateAddress, parseRange, pickSrc, processFaces, rangeHits, usedChars, withSrc } from "../fonts";

const css = `/* c */
@font-face{font-family:'P';font-weight:45 920;src:url(../x/P.0.woff2) format('woff2-variations');unicode-range:U+f9ca-fa0b,U+ff03-ff05,U+4??}
@font-face { font-family: "P"; src: local("P"), url("a.eot?#iefix") format("embedded-opentype"), url(a.woff2) format("woff2"), url(a.ttf); unicode-range: U+AC00-D7A3; }
@font-face{font-family:'L';src:url(./fonts/L.ttf)}
body{font-family:P}`;

test("unicode-range 파싱: 범위, 단일, 와일드카드, 없음", () => {
  expect(parseRange("U+0460-052F, U+20B4, U+4??")).toEqual([[0x460, 0x52f], [0x20b4, 0x20b4], [0x400, 0x4ff]]);
  expect(parseRange(undefined)).toBeNull();
  const chars = usedChars("가a");
  expect(rangeHits(parseRange("U+AC00-D7A3"), chars)).toBe(true);
  expect(rangeHits(parseRange("U+0400-04FF"), chars)).toBe(false);
  expect(rangeHits(null, chars)).toBe(true);
});
test("@font-face 블록 찾기와 woff2 우선 src 선택", () => {
  const b = faceBlocks(css);
  expect(b.length).toBe(3);
  expect(pickSrc(b[0].body)).toEqual({ url: "../x/P.0.woff2", format: "woff2-variations" });
  expect(pickSrc(b[1].body)?.url).toBe("a.woff2");
  expect(pickSrc(b[2].body)?.url).toBe("./fonts/L.ttf");
  expect(withSrc(b[2].body, "data:font/woff2;base64,AA")).toContain('src:url(data:font/woff2;base64,AA) format("woff2");');
});
test("주석 안의 @font-face는 무시", () => {
  expect(faceBlocks("/* @font-face{src:url(a.woff2)} */ p{}").length).toBe(0);
});
test("쓰지 않는 unicode-range 블록은 지우고, 글꼴을 못 얻는 블록은 그대로 둔다(부분집합 호출 없음)", async () => {
  const r = await processFaces(css, usedChars("abc"), async () => null);
  expect(r.faces).toBe(0);
  expect(r.css).not.toContain("U+AC00");   // 한글 범위 블록은 영어만 쓰는 덱에 필요 없다
  expect(r.css).not.toContain("U+f9ca");   // 이 범위도 안 쓴다
  expect(r.css).toContain("./fonts/L.ttf"); // 범위 없는 블록은 남고, load가 null이면 그대로
  expect(r.css).toContain("body{font-family:P}");
});

test("같은 url을 굵기마다 선언한 블록은 하나로 합친다(가변 글꼴 중복 인라인 방지)", async () => {
  const c = `@font-face{font-family:'K';font-weight:400;src:url(a.woff2) format('woff2');unicode-range:U+AC00-D7A3}
@font-face{font-family:'K';font-weight:700;src:url(a.woff2) format('woff2');unicode-range:U+AC00-D7A3}
@font-face{font-family:'K';font-weight:700;src:url(b.woff2) format('woff2');unicode-range:U+0000-00FF}`;
  const r = await processFaces(c, usedChars("a가"), async () => null);
  expect(r.css.match(/@font-face/g)!.length).toBe(2);
  expect(r.css).toContain("font-weight:400 700");
});

test("SSRF 방어: 사설과 루프백과 링크로컬 주소, http, 내부 이름은 거부", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.1.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  for (const u of ["http://example.com/a.woff2", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://printer.local/x"])
    await expect(fetchCached(u + "?ssrf-test=" + Date.now())).rejects.toThrow();
});
