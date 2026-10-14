import { createPortal } from "react-dom";
import { Check, ShieldAlert } from "lucide-react";
import type { Comment } from "@/lib/deck";
import { commentMenu, type CommentActions } from "@/lib/comment-actions";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { STATE_LABEL, stateOf, type CommentState } from "@/lib/comment-state";

// 캔버스 위 코멘트 핀. 번호는 목록과 같고(lib/comment-state numbering), 상태는 색과 모양으로 함께 구분한다.
const FILL: Record<CommentState, string> = {
  held: "bg-black text-foreground",
  waiting: "bg-black text-foreground",
  sent: "bg-focus-ring text-white",
  working: "bg-focus-ring text-white",
  unverified: "bg-black text-foreground",
  replied: "bg-emerald-500 text-black",
  resolved: "bg-black/70 text-muted-foreground",
};
const OUTLINE: Record<CommentState, string> = {
  held: "ring-muted-foreground/70",
  waiting: "ring-muted-foreground/70",
  sent: "ring-black",
  working: "ring-black",
  unverified: "ring-muted-foreground/70",
  replied: "ring-black",
  resolved: "ring-muted-foreground/40",
};

interface CommentPinProps {
  comment: Comment;
  number: number;
  /** 목록에서 같은 코멘트에 마우스나 포커스가 있을 때 */
  highlighted?: boolean;
  onClick(): void;
  onHover?(on: boolean): void;
  /** 있으면 우클릭과 ContextMenu 키로 메뉴(INTERACTION 2.5)가 열리고, 핀에 포커스가 있을 때 E(해결)와 Delete(삭제)가 동작한다. */
  actions?: CommentActions;
}

export function CommentPin({ comment, number, highlighted, onClick, onHover, actions }: CommentPinProps) {
  const st = stateOf(comment);
  const cm = useContextMenu();
  const menu = actions ? cm.bind(() => commentMenu(comment, actions, "pin")) : null;
  return (
    <>
    <button
      type="button"
      data-comment-pin={comment.id}
      data-state={st}
      aria-label={`Comment ${number}, ${STATE_LABEL[st]}: ${comment.text.slice(0, 60)}`}
      onClick={onClick}
      onContextMenu={menu?.onContextMenu}
      onKeyDown={(e) => {
        menu?.onKeyDown(e); // ContextMenu 키와 Shift+F10
        if (!actions || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.toLowerCase() === "e") { e.preventDefault(); e.stopPropagation(); actions.resolve(comment, st !== "resolved"); }
        else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); actions.remove(comment); }
      }}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      // cn은 text-micro를 글자색으로 보고 지우므로 클래스를 일반 문자열로 잇고, 링 색은 한 곳에서만 정한다.
      className={`flex h-5 min-w-5 cursor-default items-center justify-center rounded-full px-1 text-micro tabular-nums ring-2 outline-none transition-transform focus-visible:ring-focus-ring ${FILL[st]} ${highlighted ? "scale-125 ring-focus-ring" : OUTLINE[st]}`}
    >
      {st === "resolved" ? <Check className="h-3 w-3" aria-hidden="true" /> : st === "unverified" ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : number}
    </button>
    {/* 핀은 transform이 걸린 오버레이 안에 있어 fixed 앵커가 어긋나므로 메뉴를 body로 포털한다 */}
    {actions && createPortal(<ContextMenu menu={cm} />, document.body)}
    </>
  );
}
export type { CommentPinProps };
