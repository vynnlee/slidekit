import { expect, test } from "bun:test";
import { elementMenu, groupMenu, slideMenu, tileMenu, type ElementMenuActions, type MenuItem } from "../src/lib/menu-model";

const noop = () => {};
const labels = (m: MenuItem[]): string[] => m.map((x) => (x.type === "separator" ? "-" : x.label));
const el: ElementMenuActions = {
  addComment: noop, selectParent: noop, selectFirstChild: noop, selectNext: noop, selectPrev: noop, bringForward: noop, sendBackward: noop,
  rename: noop, group: noop, copyStyle: noop, pasteStyle: noop, canPaste: false, locked: false, toggleLock: noop, hidden: false, toggleHidden: noop, resetChanges: noop, duplicate: noop, remove: noop,
  has: { parent: true, child: true, next: true, prev: true, forward: true, backward: true, reset: false },
};
const count = (m: MenuItem[]) => m.filter((x) => x.type !== "separator").length;

test("요소 메뉴: 그룹 순서와 12개 이하, 삭제는 빨강 맨 아래, 글자 요소만 Edit text", () => {
  const m = elementMenu({ ...el, editText: noop });
  expect(labels(m)).toEqual(["Edit text", "Add comment", "-", "Select", "-", "Bring forward", "Send backward", "Group", "Rename layer", "Lock", "Hide", "-", "Style", "Duplicate", "-", "Delete"]);
  expect(count(m)).toBeLessThanOrEqual(12);
  const last = m[m.length - 1];
  expect(last.type === "item" && last.destructive).toBe(true);
  expect(labels(elementMenu(el))).not.toContain("Edit text");
});
test("요소 메뉴: 쓸 수 없는 항목은 흐리게(숨기지 않음), 숨김 상태면 Show", () => {
  const m = elementMenu({ ...el, hidden: true });
  const style = m.find((x) => x.type === "sub" && x.id === "style");
  const reset = style && style.type === "sub" ? style.items.find((x) => x.type === "item" && x.id === "reset") : undefined;
  expect(reset && reset.type === "item" && reset.disabled).toBe(true);
  const paste = style && style.type === "sub" ? style.items.find((x) => x.type === "item" && x.id === "paste-style") : undefined;
  expect(paste && paste.type === "item" && paste.disabled).toBe(true); // 복사한 스타일이 없으면 흐림
  expect(labels(m)).toContain("Show");
  const sub = m.find((x) => x.type === "sub");
  expect(sub && sub.type === "sub" && sub.items.length).toBe(4);
});
test("div 요소 메뉴는 Ungroup이 있고 12개 이하(글자 요소가 아니라 Edit text 없음)", () => {
  const m = elementMenu({ ...el, ungroup: noop });
  expect(labels(m)).toContain("Ungroup");
  expect(count(m)).toBeLessThanOrEqual(12);
});
test("잠긴 요소 메뉴는 Unlock, Select parent, Add comment 세 가지만", () => {
  expect(labels(elementMenu({ ...el, locked: true })).filter((l) => l !== "-")).toEqual(["Unlock", "Select parent", "Add comment"]);
});
test("다중 선택 메뉴: Align 서브메뉴 6방향, Duplicate, Lock, Hide, Delete", () => {
  const m = groupMenu({ group: noop, align: noop, duplicate: noop, toggleLock: noop, toggleHidden: noop, remove: noop });
  expect(labels(m)).toEqual(["Align", "-", "Group", "Duplicate", "Lock", "Hide", "-", "Delete"]);
  const sub = m[0];
  expect(sub.type === "sub" && sub.items.length).toBe(6);
});
test("슬라이드 빈 곳과 Layers 루트 행", () => {
  const full = slideMenu({ insertImage: noop, addComment: noop, zoomFit: noop, zoom100: noop, addAfter: noop, duplicate: noop, remove: noop, canDelete: true });
  expect(labels(full)).toEqual(["Add comment", "Insert image...", "-", "Zoom to fit", "Zoom to 100%", "-", "Add slide after", "Duplicate slide", "-", "Delete slide"]);
  expect(labels(slideMenu({ addAfter: noop, duplicate: noop, remove: noop, canDelete: false }))).toEqual(["Add slide after", "Duplicate slide", "-", "Delete slide"]);
});
test("필름스트립 타일: 처음 타일은 Move to start가 흐림, 마지막 하나만 남으면 Delete가 흐림", () => {
  const m = tileMenu({ presentFromHere: noop, addComment: noop, addAfter: noop, addBefore: noop, moveToStart: noop, moveToEnd: noop, first: true, last: false, duplicate: noop, remove: noop, canDelete: false });
  const dis = (id: string) => { const x = m.find((i) => i.type === "item" && i.id === id); return x?.type === "item" && !!x.disabled; };
  expect(dis("to-start")).toBe(true);
  expect(dis("to-end")).toBe(false);
  expect(dis("delete")).toBe(true);
  expect(count(m)).toBeLessThanOrEqual(12);
});
