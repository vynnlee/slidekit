import { expect, test } from "bun:test";
import { markdown } from "../src/lib/markdown";

test("서식은 그대로 렌더한다", () => {
  const h = markdown("# T\n\n**b** *i* `c` [x](https://e.com)\n\n- one\n- two");
  expect(h).toContain("<h1>T</h1>");
  expect(h).toContain("<strong>b</strong>");
  expect(h).toContain('<a href="https://e.com"');
  expect(h).toContain("<li>one</li>");
});

test("원시 HTML은 이스케이프한다", () => {
  expect(markdown("<script>alert(1)</script>")).not.toContain("<script>");
});

test("닫히지 않는 [ * _ 가 길게 이어져도 느려지지 않는다(O(n^2) 방지)", () => {
  for (const ch of ["[", "*", "_", "[a](http://"]) {
    const t = performance.now();
    markdown(ch.repeat(60000));
    markdown((ch + "x").repeat(30000));
    expect(performance.now() - t).toBeLessThan(500);
  }
});

test("아주 긴 줄은 서식 없이 이스케이프만 한다", () => {
  const h = markdown("**" + "a".repeat(3000) + "**");
  expect(h).not.toContain("<strong>");
  expect(h).toContain("aaaa");
});

test("링크 href 안의 * 와 _ 는 서식으로 바뀌지 않고, 두 링크가 있어도 태그가 어긋나지 않는다", () => {
  const html = markdown("[a](https://x.com/*) and [b](https://y.com/*) and *em*");
  expect(html).toContain('<a href="https://x.com/*"');
  expect(html).toContain('<a href="https://y.com/*"');
  expect(html).not.toContain("<em>https");
  expect(html).toContain("<em>em</em>");
  expect((html.match(/<a /g) ?? []).length).toBe((html.match(/<\/a>/g) ?? []).length);
});
test("링크 글자 안의 서식은 유지되고, 입력의 제어 문자는 자리표시자로 위조되지 않는다", () => {
  expect(markdown("[**bold**](https://x.com)")).toContain("<a href=\"https://x.com\" target=\"_blank\" rel=\"noreferrer\" class=\"underline\"><strong>bold</strong></a>");
  expect(markdown("\u00010\u0002x\u0003")).not.toContain("<a ");
});
