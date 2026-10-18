import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { flowNote, useFlow } from "@/lib/comment-flow";

const MAX = 2000; // app/comments.ts의 본문 상한과 같다
// 글이 비어 있을 때만 보이는 자주 쓰는 요청 문구. 누르면 입력창에 채워 바로 고칠 수 있다.
const QUICK = ["Make this shorter", "Simplify the wording", "Match the other slides"];

interface CommentComposerProps {
  /** 전송한다. send가 true면 곧바로 Claude에게 보내고(연결 전이면 저장해 두었다가 연결 때), false면 보류로만 저장한다(Save). 실패하면 던지거나 reject해서 글을 남기고 다시 시도하게 한다. */
  onSend(text: string, send: boolean): Promise<void>;
  onCancel(): void;
  /** 대상 요소 이름 등. 입력창 위에 작게 보인다. */
  target?: string;
  /** 영역 코멘트면 사각형의 가로세로 비율과 겹치는 요소 수(자리표시자 상자). 실제 이미지는 저장 뒤에 서버가 만든다. */
  area?: { ratio: number; count: number };
  /** Claude 채널 연결 여부. true면 Enter가 곧바로 보내고, 아니면 Enter는 저장만 한다(Send는 저장해 두었다가 연결되면 전달). */
  channel?: boolean | null;
  className?: string;
}

const ENTER_KEY = "slidekit.comment.enter"; // "save"면 Enter가 항상 저장만 한다(예전 동작). 그 밖에는 연결되어 있을 때만 바로 보낸다.
const readSaveFirst = () => { try { return localStorage.getItem(ENTER_KEY) === "save"; } catch { return false; } };

export function CommentComposer({ onSend, onCancel, target, area, channel, className }: CommentComposerProps) {
  const flow = useFlow();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [saveFirst, setSaveFirst] = useState(readSaveFirst);
  const enterSends = channel === true && !saveFirst; // Enter의 동작: 보낸다 / 저장한다
  const toggleEnter = () => setSaveFirst((v) => { try { localStorage.setItem(ENTER_KEY, v ? "send" : "save"); } catch { /* 저장 불가: 이 창에서만 */ } return !v; });
  const ref = useRef<HTMLTextAreaElement>(null);
  // 열기 직전에 포커스가 있던 곳(캔버스나 코멘트 모드 층)을 기억했다가 닫을 때 돌려준다. 작성창이 사라지면 포커스가 body로 떨어져 키보드 흐름이 끊긴다.
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  useEffect(() => {
    ref.current?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      const a = document.activeElement;
      // 포커스가 작성창 안이거나 이미 body로 떨어졌을 때만 돌려준다(사용자가 다른 곳으로 옮겼다면 건드리지 않는다).
      if (back?.isConnected && back !== document.body && (!a || a === document.body || ref.current?.closest("[role=group]")?.contains(a) || a === ref.current)) back.focus({ preventScroll: true });
    };
  }, []);

  const send = async (now: boolean) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setErr("");
    try { await onSend(t, now); setText(""); } catch { setErr("Could not send. Your text is kept, try again."); } finally { setSending(false); }
  };
  const over = text.length > MAX;

  return (
    <div role="group" aria-label="New comment" className={cn("flex flex-col gap-1.5 rounded-lg bg-surface-3 p-1.5 shadow-surface-3", className)}>
      {target && <span className="truncate px-1 text-micro text-muted-foreground">Comment on {target}</span>}
      {area && (
        <div className="flex items-center gap-2 px-1" data-testid="area-placeholder">
          <span aria-hidden="true" className="block h-9 shrink-0 rounded-sm border border-dashed border-focus-ring/70 bg-focus-ring/10" style={{ aspectRatio: String(Math.max(0.2, Math.min(5, area.ratio))) }} />
          <span className="text-micro text-muted-foreground">Area, {area.count} {area.count === 1 ? "element" : "elements"}. A picture is saved when possible.</span>
        </div>
      )}
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
          // Enter는 연결되어 있으면 Send, 아니면 Save. Cmd+Enter는 언제나 Send, Shift+Enter는 줄바꿈(기본 동작). 한글 조합 중의 Enter는 글자를 확정하는 키라 건너뛴다.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(e.metaKey || e.ctrlKey || enterSends); }
        }}
      />
      {!text && (
        <div role="group" aria-label="Quick comments" className="flex flex-wrap gap-1">
          {QUICK.map((q) => <Button key={q} size="compact" variant="ghost" onClick={() => { setText(q); ref.current?.focus(); }}>{q}</Button>)}
        </div>
      )}
      {flowNote(flow) ? <p role="status" className="px-1 text-micro text-muted-foreground">{flow?.paused ? "Claude is paused. Send saves it and sends when you resume." : `${flowNote(flow)} Send saves it and sends when it resumes.`}</p> : channel === false && <p className="px-1 text-micro text-muted-foreground">Claude is not connected. Send saves it and sends when a session connects. Save keeps it on hold.</p>}
      {err && <p role="alert" className="px-1 text-micro">{err}</p>}
      <div className="flex items-center gap-1 px-1 text-micro text-muted-foreground" aria-live="polite">
        {text.length > MAX - 200
          ? <span className={`tabular-nums ${over ? "text-foreground" : ""}`}>{text.length}/{MAX}</span>
          : <span>{enterSends ? "Enter sends." : "Enter saves."} Shift+Enter: new line.</span>}
        {(channel === true || saveFirst) && <button type="button" className="ml-auto cursor-default rounded px-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring" onClick={toggleEnter}>{saveFirst ? "Enter sends when connected" : "Enter saves instead"}</button>}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="compact" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="compact" variant={enterSends ? "secondary" : "primary"} aria-keyshortcuts={enterSends ? undefined : "Enter"} disabled={!text.trim() || over || sending} onClick={() => void send(false)}>{enterSends ? "Send later" : "Save"}</Button>
        <Button size="compact" variant={enterSends ? "primary" : "secondary"} aria-keyshortcuts={enterSends ? "Enter Control+Enter Meta+Enter" : "Control+Enter Meta+Enter"} disabled={!text.trim() || over || sending} onClick={() => void send(true)}>{sending ? "Sending" : "Send"}</Button>
      </div>
    </div>
  );
}
export type { CommentComposerProps };
