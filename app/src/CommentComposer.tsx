import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const MAX = 2000; // app/comments.ts의 본문 상한과 같다
// 글이 비어 있을 때만 보이는 자주 쓰는 요청 문구. 누르면 입력창에 채워 바로 고칠 수 있다.
const QUICK = ["Make this shorter", "Simplify the wording", "Match the other slides"];

interface CommentComposerProps {
  /** 전송한다. 실패하면 던지거나 reject해서 글을 남기고 다시 시도하게 한다. */
  onSend(text: string): Promise<void>;
  onCancel(): void;
  /** 대상 요소 이름 등. 입력창 위에 작게 보인다. */
  target?: string;
  /** Claude 채널 연결 여부. false면 "저장만 되고 나중에 전달" 안내를 보인다. */
  channel?: boolean | null;
  className?: string;
}

export function CommentComposer({ onSend, onCancel, target, channel, className }: CommentComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setErr("");
    try { await onSend(t); setText(""); } catch { setErr("Could not send. Your text is kept, try again."); } finally { setSending(false); }
  };
  const over = text.length > MAX;

  return (
    <div role="group" aria-label="New comment" className={cn("flex flex-col gap-1.5 rounded-lg bg-surface-3 p-1.5 shadow-surface-3", className)}>
      {target && <span className="truncate px-1 text-micro text-muted-foreground">Comment on {target}</span>}
      <TextArea
        ref={ref}
        rows={3}
        value={text}
        placeholder="Tell Claude what to change"
        aria-label="Comment"
        aria-invalid={over || undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // 편집기 전역 단축키와 겹치지 않게 한다
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
        }}
      />
      {!text && (
        <div role="group" aria-label="Quick comments" className="flex flex-wrap gap-1">
          {QUICK.map((q) => <Button key={q} size="compact" variant="ghost" onClick={() => { setText(q); ref.current?.focus(); }}>{q}</Button>)}
        </div>
      )}
      {channel === false && <p className="px-1 text-micro text-muted-foreground">Claude is not connected. The comment is saved and sent when a session connects.</p>}
      {err && <p role="alert" className="px-1 text-micro">{err}</p>}
      <div className="flex items-center gap-2">
        <span className={`px-1 text-micro tabular-nums ${over ? "text-foreground" : "text-muted-foreground"}`} aria-live="polite">
          {text.length > MAX - 200 ? `${text.length}/${MAX}` : "Cmd+Enter to send"}
        </span>
        <Button size="compact" variant="ghost" className="ml-auto" onClick={onCancel}>Cancel</Button>
        <Button size="compact" variant="primary" disabled={!text.trim() || over || sending} onClick={send} leadingIcon={Send}>{sending ? "Sending" : "Send"}</Button>
      </div>
    </div>
  );
}
export type { CommentComposerProps };
