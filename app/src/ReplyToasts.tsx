import { useEffect, useRef } from "react";
import type { Comment } from "@/lib/deck";
import { toast, TOAST } from "@/Toaster";

// 답변이 도착하면(open -> done) 공용 토스트(Toaster)로 알린다. 첫 로드의 기존 답변은 알리지 않는다.
// 자체 토스트 줄을 두면 Toaster와 같은 자리에 겹쳐 Undo 같은 버튼을 가리므로 하나의 줄만 쓴다.
export function ReplyToasts({ comments, onView }: { comments: Comment[]; onView(c: Comment): void }) {
  const seen = useRef<Map<string, boolean> | null>(null); // id -> 답변됨 여부
  const view = useRef(onView);
  view.current = onView;
  useEffect(() => {
    const now = new Map(comments.map((c) => [c.id, c.status === "done"]));
    const prev = seen.current;
    seen.current = now;
    if (!prev || prev.size === 0) return; // 첫 로드
    for (const c of comments) {
      if (c.status === "done" && prev.get(c.id) === false) toast(`Claude replied on slide ${c.slide}`, { action: { label: "View", onClick: () => view.current(c) } });
    }
  }, [comments]);
  return null;
}
