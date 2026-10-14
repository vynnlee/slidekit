import { expect, test } from "bun:test";
// 다른 테스트가 SLIDEKIT_DECKS를 임시 폴더로 바꿔 둘 수 있어, 환경 변수 없이 새로 불러온다.
delete process.env.SLIDEKIT_DECKS;
const { deckFolder, isFolderName } = await import("../folder.ts?fresh=" + Date.now());

test("폴더 이름 규칙: 경로 이탈, 점 폴더, 슬래시, 빈 값, 너무 긴 이름은 거부", () => {
  for (const bad of ["", ".", "..", ".trash", "../x", "a/b", "a\\b", "a..b", "x".repeat(129), "한글", "a b", null, undefined, 1]) expect(isFolderName(bad), String(bad)).toBe(false);
  for (const ok of ["vibe-coding-workshop", "_e2e-x", "a", "A_b.c-d"]) expect(isFolderName(ok), ok).toBe(true);
});
test("deckFolder: 실제 덱만 통과(없는 이름, 파일 이름, .trash는 null)", () => {
  expect(deckFolder("vibe-coding-workshop")).toContain("decks/vibe-coding-workshop");
  expect(deckFolder("no-such-deck-xyz")).toBeNull();
  expect(deckFolder(".trash")).toBeNull();
  expect(deckFolder("..")).toBeNull();
});
