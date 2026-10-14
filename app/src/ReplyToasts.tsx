import { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Comment } from "@/lib/deck";

interface Toast { id: string; comment: Comment }

// 답변이 도착하면(open -> done) 화면 아래에 잠깐 알린다. 첫 로드의 기존 답변은 알리지 않는다.
export function ReplyToasts({ comments, onView }: { comments: Comment[]; onView(c: Comment): void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Map<string, boolean> | null>(null); // id -> 답변됨 여부
  useEffect(() => {
    const now = new Map(comments.map((c) => [c.id, c.status === "done"]));
    const prev = seen.current;
    seen.current = now;
    if (!prev || prev.size === 0) return; // 첫 로드
    const fresh = comments.filter((c) => c.status === "done" && prev.get(c.id) === false);
    if (!fresh.length) return;
    setToasts((t) => [...t, ...fresh.map((c) => ({ id: c.id, comment: c }))]);
    for (const c of fresh) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== c.id)), 8000);
  }, [comments]);
  if (!toasts.length) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {toasts.map(({ id, comment }) => (
        <div key={id} data-testid="reply-toast" className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface-3 py-1.5 pl-3 pr-1.5 text-body shadow-surface-3">
          <MessageSquare className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          <span>Claude replied on slide {comment.slide}</span>
          <Button size="compact" variant="secondary" onClick={() => { onView(comment); setToasts((t) => t.filter((x) => x.id !== id)); }}>View</Button>
          <Button size="icon-compact" variant="ghost" aria-label="Dismiss" onClick={() => setToasts((t) => t.filter((x) => x.id !== id))}><X /></Button>
        </div>
      ))}
    </div>
  );
}
