import { expect, test } from "bun:test";
import { childToward, firstChild, isLeaf, leafOf, parentOf, pick, siblings, type N } from "../src/lib/selection";

// 간단한 가짜 DOM: el("div", {...}, [자식]) 또는 el("p", {text:"글"})
type F = N & { name: string; children: F[]; parentElement: F | null };
const el = (tagName: string, o: { text?: string; attrs?: Record<string, string> } = {}, kids: F[] = []): F => {
  const e: F = { tagName, name: o.text ?? tagName, children: kids, parentElement: null, textContent: o.text ?? kids.map((k) => k.textContent ?? "").join(""), getAttribute: (n) => o.attrs?.[n] ?? null };
  kids.forEach((k) => (k.parentElement = e));
  return e;
};
// section > [ div.cards > [ div.card > [p "제목", div.row > [span "a"] ], div.card2 > [p "둘째"] ], img, aside[data-notes] ]
const title = el("p", { text: "제목" });
const span = el("span", { text: "a" });
const row = el("div", {}, [span]);
const card = el("div", {}, [title, row]);
const t2 = el("p", { text: "둘째" });
const card2 = el("div", {}, [t2]);
const cards = el("div", {}, [card, card2]);
const img = el("img");
const notes = el("aside", { text: "노트", attrs: { "data-notes": "" } });
const root = el("section", {}, [cards, img, notes]);

test("첫 클릭은 슬라이드 직계 자식(최상위 컨테이너)", () => {
  expect(pick(root, title, null)).toBe(cards);
  expect(pick(root, t2, null)).toBe(cards);
  expect(pick(root, img, null)).toBe(img);
});

test("더블클릭으로 한 단계씩 내려간다", () => {
  expect(childToward(root, cards, title)).toBe(card);
  expect(childToward(root, card, title)).toBe(title);
  expect(childToward(root, card, span)).toBe(row);
  expect(childToward(root, row, span)).toBeNull(); // row는 글자 블록(leaf)이라 더 내려가지 않는다
});

test("선택이 있으면 그 부모의 형제끼리 고르고 범위 밖은 위로 풀린다", () => {
  expect(pick(root, t2, card)).toBe(card2); // card의 범위는 cards: card2를 고른다
  expect(pick(root, img, card)).toBe(img); // 범위 밖: 한 단계 위(슬라이드)에서 고른다
  expect(pick(root, title, title)).toBe(title);
});

test("Cmd+클릭(deep)은 가장 안쪽 단위", () => {
  expect(pick(root, title, null, true)).toBe(title);
  expect(pick(root, span, null, true)).toBe(row); // span은 글자 블록 row 안의 인라인이라 row가 단위
});

test("글자 블록과 이미지는 leaf, 컨테이너는 아님", () => {
  expect(isLeaf(title)).toBe(true);
  expect(isLeaf(img)).toBe(true);
  expect(isLeaf(card)).toBe(false);
  expect(isLeaf(cards)).toBe(false);
});

test("노트와 슬라이드 루트는 선택되지 않는다", () => {
  expect(leafOf(root, notes)).toBeNull();
  expect(leafOf(root, root)).toBeNull();
  expect(pick(root, root, null)).toBeNull();
});

test("잠긴 요소와 그 안쪽은 캔버스에서 선택되지 않는다", () => {
  const lockedP = el("p", { text: "잠금", attrs: { "data-locked": "" } });
  const wrap = el("div", { attrs: { "data-locked": "" } }, [el("p", { text: "안쪽" })]);
  const r = el("section", {}, [lockedP, wrap, el("p", { text: "보통" })]);
  expect(pick(r, lockedP, null)).toBeNull();
  expect(pick(r, wrap.children[0], null)).toBeNull();
  expect(pick(r, r.children[2], null)).toBe(r.children[2]);
});

test("부모, 첫 자식, 형제", () => {
  expect(parentOf(root, title)).toBe(card);
  expect(parentOf(root, cards)).toBeNull();
  expect(firstChild(cards)).toBe(card);
  expect(siblings(root, null)).toEqual([cards, img]);
  expect(siblings(root, card)).toEqual([card, card2]);
});
