import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ShieldAlert } from "lucide-react";
import type { Comment } from "@/lib/deck";
import { commentMenu, type CommentActions } from "@/lib/comment-actions";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { stateOf, type CommentState } from "@/lib/comment-state";
import { pinLabel, previewOf } from "@/lib/comment-view";
import { setHoveredComment, useCommentHovered } from "@/lib/comment-hover";

// 캔버스 위 코멘트 핀: 꼬리가 앵커에 닿는 24px 말풍선. 번호는 목록과 같고(lib/comment-state numbering) 항상 보이며, 상태는 색과 채움, 모서리 배지로 함께 구분한다.
const FILL: Record<CommentState, string> = {
  held: "bg-black/60 text-foreground",
  waiting: "bg-black/60 text-foreground",
  sent: "bg-focus-ring text-white",
  working: "bg-focus-ring text-white",
  unverified: "bg-black/60 text-foreground",
  replied: "bg-emerald-500 text-black",
  resolved: "bg-black/70 text-muted-foreground",
};
const OUTLINE: Record<CommentState, string> = {
  held: "ring-foreground/70",
  waiting: "ring-foreground/70",
  sent: "ring-black",
  working: "ring-black",
  unverified: "ring-muted-foreground/70",
  replied: "ring-black",
  resolved: "ring-muted-foreground/40",
};

interface CommentPinProps {
  comment: Comment;
  number: number;
  onClick(): void;
  /** 있으면 우클릭과 ContextMenu 키로 메뉴(INTERACTION 2.5)가 열리고, 핀에 포커스가 있을 때 E(해결)와 Delete(삭제)가 동작한다. */
  actions?: CommentActions;
}

export function CommentPin({ comment, number, onClick, actions }: CommentPinProps) {
  const st = stateOf(comment);
  const highlighted = useCommentHovered(comment.id); // 목록에서 같은 코멘트에 마우스나 포커스가 있을 때
  const cm = useContextMenu();
  const menu = actions ? cm.bind(() => commentMenu(comment, actions, "pin")) : null;
  const btn = useRef<HTMLButtonElement>(null);
  // 호버 미리보기: 150ms 지연, 한 번에 하나. 오버레이가 잘라내지 않도록 body로 포털하고 화면 좌표로 놓는다.
  const [pv, setPv] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { const r = btn.current?.getBoundingClientRect(); if (r) setPv({ x: r.left, y: r.bottom }); }, 150); };
  const hide = () => { clearTimeout(timer.current); setPv(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const pre = pv ? previewOf(comment, number) : null;
  return (
    <>
    <button
      ref={btn}
      type="button"
      data-comment-pin={comment.id}
      data-state={st}
      aria-label={pinLabel(comment, number)}
      onClick={() => { hide(); onClick(); }}
      onContextMenu={(e) => { hide(); menu?.onContextMenu(e); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
        menu?.onKeyDown(e); // ContextMenu 키와 Shift+F10
        if (!actions || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.toLowerCase() === "e") { e.preventDefault(); e.stopPropagation(); actions.resolve(comment, st !== "resolved"); }
        else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); actions.remove(comment); }
      }}
      onMouseEnter={() => { setHoveredComment(comment.id); show(); }}
      onMouseLeave={() => { setHoveredComment(null); hide(); }}
      onFocus={() => { setHoveredComment(comment.id); show(); }}
      onBlur={() => { setHoveredComment(null); hide(); }}
      // cn은 text-micro를 글자색으로 보고 지우므로 클래스를 일반 문자열로 잇고, 링 색은 한 곳에서만 정한다.
      // 말풍선: 오른쪽 아래 모서리만 각지게 해서 꼬리처럼 앵커(요소의 오른쪽 위 모서리)를 가리킨다.
      className={`relative flex h-6 min-w-6 cursor-default items-center justify-center rounded-full rounded-br-none px-1 text-micro tabular-nums ring-2 outline-none transition-transform focus-visible:ring-focus-ring motion-safe:data-[state=working]:animate-pulse ${FILL[st]} ${highlighted ? "scale-125 ring-focus-ring" : OUTLINE[st]}`}
    >
      {number}
      {(st === "resolved" || st === "unverified") && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-foreground text-background">
          {st === "resolved" ? <Check className="h-2.5 w-2.5" /> : <ShieldAlert className="h-2.5 w-2.5" />}
        </span>
      )}
    </button>
    {pre && createPortal(
      <div aria-hidden="true" data-testid="pin-preview" style={{ left: Math.max(8, Math.min(pv!.x, window.innerWidth - 248)), top: pv!.y + 6 }} className="pointer-events-none fixed z-50 w-60 rounded-lg bg-surface-3 p-2 text-micro shadow-surface-3">
        <p className="text-muted-foreground">{pre.head}</p>
        <p className="line-clamp-2 break-words text-foreground">{pre.text}</p>
        {pre.reply && <p className="truncate text-muted-foreground">{pre.reply}</p>}
      </div>, document.body)}
    {/* 핀은 transform이 걸린 오버레이 안에 있어 fixed 앵커가 어긋나므로 메뉴를 body로 포털한다 */}
    {actions && createPortal(<ContextMenu menu={cm} />, document.body)}
    </>
  );
}
export type { CommentPinProps };
