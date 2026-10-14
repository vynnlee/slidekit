import { expect, test } from "bun:test";
import { commentMenu, deckMenu, tidy, trashMenu, type MenuItem } from "../src/lib/menu-model";

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

const cacts = { resolved: false, unverified: false, resolve: noop, copyText: noop, remove: noop };

test("코멘트 메뉴: 패널 항목은 Open in panel 없이 Resolve, Copy, 구분선, 빨강 Delete 순서", () => {
  const m = commentMenu(cacts);
  expect(labels(m)).toEqual(["Resolve", "Copy text", "-", "Delete"]);
  const last = m[m.length - 1];
  expect(last.type === "item" && last.destructive && last.shortcut).toBe("delete");
  const resolve = m[0];
  expect(resolve.type === "item" && resolve.shortcut).toBe("e");
});

test("코멘트 메뉴: 핀은 Open in panel이 맨 위, 해결됨이면 Reopen, 서명 없음일 때만 Trust", () => {
  expect(labels(commentMenu({ ...cacts, openInPanel: noop }))[0]).toBe("Open in panel");
  expect(labels(commentMenu({ ...cacts, resolved: true }))).toContain("Reopen");
  expect(labels(commentMenu({ ...cacts, resolved: true }))).not.toContain("Resolve");
  expect(labels(commentMenu({ ...cacts, unverified: true, trust: noop }))).toContain("Trust");
  expect(labels(commentMenu({ ...cacts, unverified: true }))).not.toContain("Trust"); // trust 연결이 없으면 뺀다
  expect(labels(commentMenu({ ...cacts, trust: noop }))).not.toContain("Trust"); // 서명이 있으면 뺀다
  expect(commentMenu({ ...cacts, openInPanel: noop, unverified: true, trust: noop }).filter((x) => x.type !== "separator").length).toBeLessThanOrEqual(12);
});

test("덱 메뉴: togglePin을 주면 Pin to top 또는 Unpin from top 항목이 Rename 위에 생긴다", () => {
  expect(labels(deckMenu({ ...acts, togglePin: noop, pinned: false }))).toContain("Pin to top");
  const l = labels(deckMenu({ ...acts, togglePin: noop, pinned: true }));
  expect(l).toContain("Unpin from top");
  expect(l.indexOf("Unpin from top")).toBeLessThan(l.indexOf("Rename"));
});

test("코멘트 메뉴: Revert Claude's edit는 되돌릴 수 있을 때만 Resolve 바로 뒤에 들어간다", () => {
  expect(labels(commentMenu({ ...cacts, revert: noop }))).toEqual(["Resolve", "Revert Claude's edit", "Copy text", "-", "Delete"]);
  expect(labels(commentMenu(cacts))).not.toContain("Revert Claude's edit");
});
