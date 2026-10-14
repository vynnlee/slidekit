import { expect, test } from "bun:test";
import { THEMES, currentTheme } from "../src/lib/themes";
import { contrastRatio } from "../src/lib/deck-colors";

test("모든 테마: 글자, 보조 글자, 강조 색은 배경과 4.5:1 이상, 가장 흐린 보조(faint, 장식용)는 2.7:1 이상", () => {
  for (const th of THEMES) {
    const bg = th.tokens["--sk-bg"];
    for (const k of ["--sk-fg", "--sk-muted", "--sk-accent"]) expect(contrastRatio(th.tokens[k], bg) ?? 0).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(th.tokens["--sk-faint"], bg) ?? 0).toBeGreaterThanOrEqual(2.7);
  }
});
test("테마 id는 유일하고 토큰 아홉 개를 모두 가진다", () => {
  expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  for (const t of THEMES) expect(Object.keys(t.tokens).length).toBe(9);
});
test("currentTheme: 모두 같으면 그 테마, 하나라도 다르면 null(Custom)", () => {
  const dark = THEMES[0];
  expect(currentTheme((k) => dark.tokens[k])?.id).toBe("dark");
  expect(currentTheme((k) => (k === "--sk-accent" ? "#ff0000" : dark.tokens[k]))).toBeNull();
});
