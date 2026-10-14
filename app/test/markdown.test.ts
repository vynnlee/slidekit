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
