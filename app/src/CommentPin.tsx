import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Comment } from "@/lib/deck";
import { STATE_LABEL, stateOf, type CommentState } from "@/lib/comment-state";

// 캔버스 위 코멘트 핀. 번호는 목록과 같고(lib/comment-state numbering), 상태는 색과 모양으로 함께 구분한다.
const RING: Record<CommentState, string> = {
  waiting: "bg-black text-foreground ring-muted-foreground/70",
  sent: "bg-focus-ring text-white ring-black",
  replied: "bg-emerald-500 text-black ring-black",
  resolved: "bg-black/70 text-muted-foreground ring-muted-foreground/40",
};

interface CommentPinProps {
  comment: Comment;
  number: number;
  /** 목록에서 같은 코멘트에 마우스나 포커스가 있을 때 */
  highlighted?: boolean;
  onClick(): void;
  onHover?(on: boolean): void;
}

export function CommentPin({ comment, number, highlighted, onClick, onHover }: CommentPinProps) {
  const st = stateOf(comment);
  return (
    <button
      type="button"
      data-comment-pin={comment.id}
      data-state={st}
      aria-label={`Comment ${number}, ${STATE_LABEL[st]}: ${comment.text.slice(0, 60)}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-micro tabular-nums ring-2 outline-none transition-transform focus-visible:ring-focus-ring",
        RING[st],
        highlighted && "scale-125 ring-focus-ring",
      )}
    >
      {st === "resolved" ? <Check className="h-3 w-3" aria-hidden="true" /> : number}
    </button>
  );
}
export type { CommentPinProps };
