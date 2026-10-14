import type { Comment } from "@/lib/deck";
import { stateOf } from "@/lib/comment-state";
import { toast, TOAST } from "@/Toaster";
import { Check, Copy, ExternalLink, RotateCcw, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { commentMenu as buildCommentMenu, type MenuItem } from "@/lib/menu-model";

// 코멘트 핀과 패널 항목이 같이 쓰는 동작(INTERACTION 2.5). 실제 동작은 편집기가 useCommentsLive에서 만들어 넘긴다.
export interface CommentActions {
  resolve(c: Comment, resolved: boolean): void;
  trust?(c: Comment): void;
  remove(c: Comment): void;
  /** Claude의 수정을 되돌린다(editBase가 있고 아직 되돌리지 않았을 때만 메뉴에 나온다). undo=true면 되돌리기를 취소한다. */
  revert?(c: Comment, undo?: boolean): void;
  /** 핀에서만: Comments 탭을 열고 그 항목으로 간다 */
  openInPanel?(c: Comment): void;
}

export async function copyCommentText(c: Comment) {
  try { await navigator.clipboard.writeText(c.text); toast("Comment copied", { ms: TOAST.copy }); } catch { toast("Could not copy the comment", { ms: TOAST.error }); }
}

// 우클릭과 ContextMenu 키로 여는 메뉴 항목(맥락은 핀 또는 패널 항목). 목록의 원천은 lib/menu-model.ts의 commentMenu다.
export function commentMenu(c: Comment, a: CommentActions, from: "pin" | "panel"): MenuItem[] {
  const st = stateOf(c);
  return buildCommentMenu(
    {
      resolved: st === "resolved",
      unverified: st === "unverified",
      openInPanel: from === "pin" && a.openInPanel ? () => a.openInPanel!(c) : undefined,
      revert: a.revert && c.editBase && !c.revertedAt ? () => a.revert!(c) : undefined,
      resolve: () => a.resolve(c, st !== "resolved"),
      trust: a.trust ? () => a.trust!(c) : undefined,
      copyText: () => { void copyCommentText(c); },
      remove: () => a.remove(c),
    },
    { open: ExternalLink, resolve: Check, reopen: RotateCcw, trust: ShieldAlert, copy: Copy, trash: Trash2, revert: Undo2 },
  );
}
