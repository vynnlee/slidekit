// 우클릭 메뉴와 ... 버튼 메뉴가 같이 쓰는 항목 목록. 맥락마다 순수 함수 하나가 항목을 만든다(spec/INTERACTION.md 2절).
// 다른 맥락(요소, 레이어 행, 필름스트립, 코멘트)도 이 파일에 자기 함수를 추가한다.
import type { IconComponent } from "@/lib/icon-context";
import { LAYOUTS } from "../../../engine/layouts";

export type MenuItem =
  | {
      type: "item";
      id: string;
      label: string;
      icon?: IconComponent;
      /** "mod+d", "enter", "mod+enter"처럼 command-menu의 단축키 문법. 오른쪽에 키캡으로 보이고 aria-keyshortcuts에도 들어간다. */
      shortcut?: string;
      /** 쓸 수 없는 항목은 숨기지 않고 흐리게 둔다(항목 위치가 바뀌지 않게). */
      disabled?: boolean;
      /** 파괴적 동작은 빨강(--destructive)으로 보이고 맨 아래에 둔다. */
      destructive?: boolean;
      onSelect: () => void;
    }
  | { type: "separator" }
  /** 서브메뉴는 최대 1단. */
  | { type: "sub"; id: string; label: string; icon?: IconComponent; disabled?: boolean; items: MenuItem[] };

export const separator: MenuItem = { type: "separator" };

/** 맨 앞뒤와 연속된 구분선, 빈 서브메뉴를 정리한다. 맥락 함수가 조건부로 항목을 빼도 구분선이 어색하게 남지 않는다. */
export function tidy(items: (MenuItem | false | null | undefined)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it.type === "sub") { const sub = tidy(it.items); if (!sub.length) continue; out.push({ ...it, items: sub }); continue; }
    if (it.type === "separator" && (!out.length || out[out.length - 1].type === "separator")) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  return out;
}

const item = (id: string, label: string, onSelect: () => void, o: Partial<Extract<MenuItem, { type: "item" }>> = {}): MenuItem => ({ type: "item", id, label, onSelect, ...o });

// ---- 덱 목록 카드와 행 (2.6) ----
export type DeckMenuActions = {
  open(): void; present(): void; rename(): void; duplicate(): void; trash(): void;
  /** 게시한 적이 있는 덱만 준다. 없으면 항목이 빠진다. */
  copyLink?(): void;
  /** 핀 고정 토글. pinned는 지금 고정되어 있는지. */
  togglePin?(): void; pinned?: boolean;
  /** 덱 설정 대화상자 */
  settings?(): void;
};
export function deckMenu(a: DeckMenuActions, icons: { open?: IconComponent; present?: IconComponent; duplicate?: IconComponent; rename?: IconComponent; link?: IconComponent; trash?: IconComponent; pin?: IconComponent; unpin?: IconComponent; settings?: IconComponent } = {}): MenuItem[] {
  return tidy([
    item("open", "Open", a.open, { shortcut: "enter", icon: icons.open }),
    item("present", "Present", a.present, { shortcut: "mod+enter", icon: icons.present }),
    separator,
    a.togglePin && item("pin", a.pinned ? "Unpin from top" : "Pin to top", a.togglePin, { icon: a.pinned ? icons.unpin : icons.pin }),
    item("rename", "Rename", a.rename, { icon: icons.rename }),
    item("duplicate", "Duplicate", a.duplicate, { icon: icons.duplicate }),
    a.settings && item("settings", "Settings", a.settings, { icon: icons.settings }),
    a.copyLink && item("copy-link", "Copy published link", a.copyLink, { icon: icons.link }),
    separator,
    item("trash", "Move to trash", a.trash, { destructive: true, icon: icons.trash }),
  ]);
}

// ---- 휴지통 행 (2.6) ----
export type TrashMenuActions = { restore(): void; purge(): void };
export function trashMenu(a: TrashMenuActions, icons: { restore?: IconComponent; purge?: IconComponent } = {}): MenuItem[] {
  return tidy([
    item("restore", "Restore", a.restore, { icon: icons.restore }),
    separator,
    item("purge", "Delete forever", a.purge, { destructive: true, icon: icons.purge }),
  ]);
}

// ---- 코멘트 핀과 코멘트 패널 항목 (2.5) ----
export type CommentMenuActions = {
  /** 해결된 코멘트면 Resolve 대신 Reopen을 보인다. */
  resolved: boolean;
  /** 서명이 없는(Unverified) 코멘트만 Trust 항목이 있다. */
  unverified: boolean;
  /** 핀에서만 준다. 없으면 항목이 빠진다. */
  openInPanel?(): void;
  /** Claude가 이 코멘트에 답하며 고친 덱을 되돌릴 수 있을 때만 준다. */
  revert?(): void;
  resolve(): void;
  trust?(): void;
  copyText(): void;
  remove(): void;
};
export function commentMenu(a: CommentMenuActions, icons: { open?: IconComponent; resolve?: IconComponent; reopen?: IconComponent; trust?: IconComponent; copy?: IconComponent; trash?: IconComponent; revert?: IconComponent } = {}): MenuItem[] {
  return tidy([
    a.openInPanel && item("open", "Open in panel", a.openInPanel, { icon: icons.open }),
    a.resolved ? item("reopen", "Reopen", a.resolve, { shortcut: "e", icon: icons.reopen }) : item("resolve", "Resolve", a.resolve, { shortcut: "e", icon: icons.resolve }),
    a.revert && item("revert", "Revert Claude's edit", a.revert, { icon: icons.revert }),
    a.unverified && a.trust && item("trust", "Trust", a.trust, { icon: icons.trust }),
    item("copy", "Copy text", a.copyText, { icon: icons.copy }),
    separator,
    item("delete", "Delete", a.remove, { shortcut: "delete", destructive: true, icon: icons.trash }),
  ]);
}

// ---- 편집기: 캔버스 요소, 슬라이드 빈 곳, Layers 행, 필름스트립 타일 (2.1~2.4) ----
export type ElementMenuActions = {
  /** 글자 블록일 때만 준다. */
  editText?(): void;
  addComment(): void;
  selectParent(): void; selectFirstChild(): void; selectNext(): void; selectPrev(): void;
  bringForward(): void; sendBackward(): void;
  rename(): void;
  /** 선택을 div로 감싼다 / 선택한 div를 푼다(div일 때만 준다) */
  group(): void; ungroup?(): void;
  locked: boolean; toggleLock(): void;
  hidden: boolean; toggleHidden(): void;
  resetChanges(): void;
  duplicate(): void;
  remove(): void;
  /** 쓸 수 없는 항목은 흐리게 둔다. */
  has: { parent: boolean; child: boolean; next: boolean; prev: boolean; forward: boolean; backward: boolean; reset: boolean };
};
/** 2.1 단일 요소. 잠긴 요소는 Unlock, Select parent, Add comment만 보인다. */
export function elementMenu(a: ElementMenuActions): MenuItem[] {
  if (a.locked) {
    return tidy([
      item("unlock", "Unlock", a.toggleLock),
      separator,
      item("select-parent", "Select parent", a.selectParent, { shortcut: "shift+enter", disabled: !a.has.parent }),
      item("comment", "Add comment", a.addComment, { shortcut: "c" }),
    ]);
  }
  return tidy([
    a.editText && item("edit-text", "Edit text", a.editText, { shortcut: "enter" }),
    item("comment", "Add comment", a.addComment, { shortcut: "c" }),
    separator,
    { type: "sub", id: "select", label: "Select", items: [
      item("select-parent", "Parent", a.selectParent, { shortcut: "shift+enter", disabled: !a.has.parent }),
      item("select-child", "First child", a.selectFirstChild, { shortcut: "enter", disabled: !a.has.child }),
      item("select-next", "Next sibling", a.selectNext, { shortcut: "tab", disabled: !a.has.next }),
      item("select-prev", "Previous sibling", a.selectPrev, { shortcut: "shift+tab", disabled: !a.has.prev }),
    ] },
    separator,
    item("forward", "Bring forward", a.bringForward, { shortcut: "mod+]", disabled: !a.has.forward }),
    item("backward", "Send backward", a.sendBackward, { shortcut: "mod+[", disabled: !a.has.backward }),
    item("group", "Group", a.group, { shortcut: "mod+g" }),
    a.ungroup && item("ungroup", "Ungroup", a.ungroup, { shortcut: "mod+shift+g" }),
    item("rename", "Rename layer", a.rename, { shortcut: "f2" }),
    item("lock", "Lock", a.toggleLock),
    item("hide", a.hidden ? "Show" : "Hide", a.toggleHidden),
    separator,
    item("reset", "Reset changes", a.resetChanges, { disabled: !a.has.reset }),
    item("duplicate", "Duplicate", a.duplicate, { shortcut: "mod+d" }),
    separator,
    item("delete", "Delete", a.remove, { shortcut: "delete", destructive: true }),
  ]);
}

export type GroupMenuActions = {
  group(): void;
  align(axis: "h" | "v", where: "start" | "center" | "end"): void;
  duplicate(): void; toggleLock(): void; toggleHidden(): void; remove(): void;
};
/** 2.1 다중 선택 */
export function groupMenu(a: GroupMenuActions): MenuItem[] {
  return tidy([
    { type: "sub", id: "align", label: "Align", items: [
      item("align-left", "Left", () => a.align("h", "start")),
      item("align-hcenter", "Horizontal center", () => a.align("h", "center")),
      item("align-right", "Right", () => a.align("h", "end")),
      item("align-top", "Top", () => a.align("v", "start")),
      item("align-vcenter", "Vertical center", () => a.align("v", "center")),
      item("align-bottom", "Bottom", () => a.align("v", "end")),
    ] },
    separator,
    item("group", "Group", a.group, { shortcut: "mod+g" }),
    item("duplicate", "Duplicate", a.duplicate, { shortcut: "mod+d" }),
    item("lock", "Lock", a.toggleLock),
    item("hide", "Hide", a.toggleHidden),
    separator,
    item("delete", "Delete", a.remove, { shortcut: "delete", destructive: true }),
  ]);
}

export type SlideMenuActions = {
  addComment?(): void;
  zoomFit?(): void; zoom100?(): void;
  addAfter(): void; duplicate(): void; remove(): void;
  canDelete: boolean;
};
/** 2.2 슬라이드 빈 곳(위쪽 그룹은 캔버스에서만), 2.3 Layers의 Slide 루트 행(슬라이드 그룹만) */
export function slideMenu(a: SlideMenuActions): MenuItem[] {
  return tidy([
    a.addComment && item("comment", "Add comment", a.addComment, { shortcut: "c" }),
    a.addComment && separator,
    a.zoomFit && item("zoom-fit", "Zoom to fit", a.zoomFit, { shortcut: "shift+1" }),
    a.zoom100 && item("zoom-100", "Zoom to 100%", a.zoom100, { shortcut: "shift+0" }),
    a.zoomFit && separator,
    item("add-after", "Add slide after", a.addAfter),
    item("duplicate", "Duplicate slide", a.duplicate),
    separator,
    item("delete", "Delete slide", a.remove, { disabled: !a.canDelete, destructive: true }),
  ]);
}

export type TileMenuActions = {
  presentFromHere(): void; addComment(): void;
  addAfter(): void; addBefore(): void;
  /** 레이아웃(engine/layouts.ts)을 골라 뒤에 추가 */
  addAfterLayout?(layoutId: string): void;
  moveToStart(): void; moveToEnd(): void;
  /** 처음, 끝에 있으면 해당 이동은 흐리게 */
  first: boolean; last: boolean;
  duplicate(): void; remove(): void; canDelete: boolean;
};
/** 2.4 필름스트립 타일 */
export function tileMenu(a: TileMenuActions): MenuItem[] {
  return tidy([
    item("present", "Present from here", a.presentFromHere, { shortcut: "alt+enter" }),
    item("comment", "Add comment", a.addComment),
    separator,
    item("add-after", "Add slide after", a.addAfter),
    a.addAfterLayout && { type: "sub", id: "add-layout", label: "Add slide with layout", items: LAYOUTS.map((l) => item(`layout-${l.id}`, l.label, () => a.addAfterLayout!(l.id))) },
    item("add-before", "Add slide before", a.addBefore),
    item("to-start", "Move to start", a.moveToStart, { disabled: a.first }),
    item("to-end", "Move to end", a.moveToEnd, { disabled: a.last }),
    separator,
    item("duplicate", "Duplicate", a.duplicate, { shortcut: "mod+d" }),
    separator,
    item("delete", "Delete", a.remove, { shortcut: "delete", disabled: !a.canDelete, destructive: true }),
  ]);
}
