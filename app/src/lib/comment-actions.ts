import type { Comment } from "@/lib/deck";
import { stateOf } from "@/lib/comment-state";
import { toast } from "@/Toaster";

// 코멘트 핀과 패널 항목이 같이 쓰는 동작(INTERACTION 2.5). 실제 동작은 편집기가 useCommentsLive에서 만들어 넘긴다.
export interface CommentActions {
  resolve(c: Comment, resolved: boolean): void;
  trust?(c: Comment): void;
  remove(c: Comment): void;
  /** 핀에서만: Comments 탭을 열고 그 항목으로 간다 */
  openInPanel?(c: Comment): void;
}

export async function copyCommentText(c: Comment) {
  try { await navigator.clipboard.writeText(c.text); toast("Comment copied", { ms: 2000 }); } catch { toast("Could not copy the comment", { ms: 3000 }); }
}

// 메뉴 항목 목록(맥락은 핀 또는 패널 항목). 순서는 고정이고 해당 없는 항목은 뺀다.
export interface CommentMenuItem { id: string; label: string; shortcut?: string; danger?: boolean; separatorBefore?: boolean; run(): void }

export function commentMenu(c: Comment, a: CommentActions, from: "pin" | "panel"): CommentMenuItem[] {
  const st = stateOf(c);
  const items: CommentMenuItem[] = [];
  if (from === "pin" && a.openInPanel) items.push({ id: "open", label: "Open in panel", run: () => a.openInPanel!(c) });
  items.push(st === "resolved"
    ? { id: "reopen", label: "Reopen", shortcut: "E", run: () => a.resolve(c, false) }
    : { id: "resolve", label: "Resolve", shortcut: "E", run: () => a.resolve(c, true) });
  if (st === "unverified" && a.trust) items.push({ id: "trust", label: "Trust", run: () => a.trust!(c) });
  items.push({ id: "copy", label: "Copy text", run: () => { void copyCommentText(c); } });
  items.push({ id: "delete", label: "Delete", shortcut: "Delete", danger: true, separatorBefore: true, run: () => a.remove(c) });
  return items;
}
