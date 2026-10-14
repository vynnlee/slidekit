import { expect, test } from "bun:test";
import { deckMenu, tidy, trashMenu, type MenuItem } from "../src/lib/menu-model";

const noop = () => {};
const acts = { open: noop, present: noop, rename: noop, duplicate: noop, trash: noop };
const labels = (m: MenuItem[]) => m.map((x) => (x.type === "separator" ? "-" : x.label));

test("덱 메뉴: 순서와 구분선, 파괴적 항목은 맨 아래 빨강", () => {
  const m = deckMenu(acts);
  expect(labels(m)).toEqual(["Open", "Present", "-", "Rename", "Duplicate", "-", "Move to trash"]);
  const last = m[m.length - 1];
  expect(last.type === "item" && last.destructive).toBe(true);
  expect(m.filter((x) => x.type === "item" && x.destructive).length).toBe(1);
});

test("덱 메뉴: 12개 이하이고 Open과 Present에는 단축키가 있다", () => {
  const m = deckMenu(acts);
  expect(m.filter((x) => x.type !== "separator").length).toBeLessThanOrEqual(12);
  const open = m.find((x) => x.type === "item" && x.id === "open");
  const present = m.find((x) => x.type === "item" && x.id === "present");
  expect(open && open.type === "item" && open.shortcut).toBe("enter");
  expect(present && present.type === "item" && present.shortcut).toBe("mod+enter");
});

test("게시 링크 복사는 줄 때만 들어간다", () => {
  expect(labels(deckMenu(acts))).not.toContain("Copy published link");
  expect(labels(deckMenu({ ...acts, copyLink: noop }))).toContain("Copy published link");
});

test("휴지통 메뉴: Restore, 구분선, Delete forever(빨강)", () => {
  const m = trashMenu({ restore: noop, purge: noop });
  expect(labels(m)).toEqual(["Restore", "-", "Delete forever"]);
  const last = m[m.length - 1];
  expect(last.type === "item" && last.destructive).toBe(true);
});

test("tidy: 맨 앞뒤와 연속 구분선과 빈 서브메뉴를 정리한다", () => {
  const sep: MenuItem = { type: "separator" };
  const it = (id: string): MenuItem => ({ type: "item", id, label: id, onSelect: noop });
  expect(labels(tidy([sep, it("a"), sep, sep, it("b"), sep]))).toEqual(["a", "-", "b"]);
  expect(labels(tidy([it("a"), false, null, { type: "sub", id: "s", label: "S", items: [sep] }]))).toEqual(["a"]);
  expect(labels(tidy([{ type: "sub", id: "s", label: "S", items: [it("x")] }]))).toEqual(["S"]);
});
