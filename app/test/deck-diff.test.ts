import { expect, test } from "bun:test";
import { diffDecks, slidesLabel } from "../src/lib/deck-diff";

const slide = (t: string) => `<section data-slide="content"><h1>${t}</h1></section>\n`;
const deck = (...t: string[]) => `<!doctype html><html><head><title>d</title></head><body data-slidekit="1">\n${t.map(slide).join("")}</body></html>\n`;

test("같은 덱은 달라진 슬라이드가 없다", () => {
  expect(diffDecks(deck("a", "b"), deck("a", "b"))).toEqual({ changed: [], removed: 0, outside: false });
});

test("고친 슬라이드와 새 슬라이드는 changed, 지운 슬라이드는 removed", () => {
  const d = diffDecks(deck("a", "b", "c"), deck("a", "B", "c", "d"));
  expect(d.changed).toEqual([1, 3]);
  expect(d.removed).toBe(1); // 옛 b가 새 덱에 없다
});

test("순서만 바뀐 슬라이드는 달라진 것으로 치지 않는다", () => {
  expect(diffDecks(deck("a", "b", "c"), deck("c", "a", "b")).changed).toEqual([]);
});

test("같은 글자의 슬라이드가 여럿이면 개수까지 센다", () => {
  expect(diffDecks(deck("a", "a"), deck("a", "a", "a")).changed).toEqual([2]);
});

test("머리말이 바뀌면 outside", () => {
  expect(diffDecks(deck("a"), deck("a").replace("<title>d</title>", "<title>e</title>")).outside).toBe(true);
});

test("문구: 하나, 둘에서 넷, 다섯 이상", () => {
  expect(slidesLabel([2])).toBe("Slide 3");
  expect(slidesLabel([2, 4])).toBe("Slides 3 and 5");
  expect(slidesLabel([0, 2, 4])).toBe("Slides 1, 3 and 5");
  expect(slidesLabel([0, 1, 2, 3, 4])).toBe("5 slides");
});
