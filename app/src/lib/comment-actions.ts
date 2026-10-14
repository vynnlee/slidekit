import type { Comment } from "@/lib/deck";
import { stateOf } from "@/lib/comment-state";
import { toast } from "@/Toaster";
import { Check, Copy, ExternalLink, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import { commentMenu as buildCommentMenu, type MenuItem } from "@/lib/menu-model";

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

// 우클릭과 ContextMenu 키로 여는 메뉴 항목(맥락은 핀 또는 패널 항목). 목록의 원천은 lib/menu-model.ts의 commentMenu다.
export function commentMenu(c: Comment, a: CommentActions, from: "pin" | "panel"): MenuItem[] {
  const st = stateOf(c);
  return buildCommentMenu(
    {
      resolved: st === "resolved",
      unverified: st === "unverified",
      openInPanel: from === "pin" && a.openInPanel ? () => a.openInPanel!(c) : undefined,
      resolve: () => a.resolve(c, st !== "resolved"),
      trust: a.trust ? () => a.trust!(c) : undefined,
      copyText: () => { void copyCommentText(c); },
      remove: () => a.remove(c),
    },
    { open: ExternalLink, resolve: Check, reopen: RotateCcw, trust: ShieldAlert, copy: Copy, trash: Trash2 },
  );
}
