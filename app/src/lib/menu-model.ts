// 우클릭 메뉴와 ... 버튼 메뉴가 같이 쓰는 항목 목록. 맥락마다 순수 함수 하나가 항목을 만든다(spec/INTERACTION.md 2절).
// 다른 맥락(요소, 레이어 행, 필름스트립, 코멘트)도 이 파일에 자기 함수를 추가한다.
import type { IconComponent } from "@/lib/icon-context";

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
};
export function deckMenu(a: DeckMenuActions, icons: { open?: IconComponent; present?: IconComponent; duplicate?: IconComponent; rename?: IconComponent; link?: IconComponent; trash?: IconComponent } = {}): MenuItem[] {
  return tidy([
    item("open", "Open", a.open, { shortcut: "enter", icon: icons.open }),
    item("present", "Present", a.present, { shortcut: "mod+enter", icon: icons.present }),
    separator,
    item("rename", "Rename", a.rename, { icon: icons.rename }),
    item("duplicate", "Duplicate", a.duplicate, { icon: icons.duplicate }),
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
