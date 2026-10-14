import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, CheckCheck, Clock, Copy, Loader2, MessageSquare, RotateCcw, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Comment } from "@/lib/deck";
import { STATE_LABEL, ago, numbering, stateOf, type CommentState } from "@/lib/comment-state";

const CMD = "claude --dangerously-load-development-channels server:slidekit";
type Filter = "all" | "open" | "replied" | "resolved";
const FILTERS: { id: Filter; label: string; match: (s: CommentState) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "open", label: "Open", match: (s) => s === "waiting" || s === "sent" || s === "working" || s === "unverified" },
  { id: "replied", label: "Replied", match: (s) => s === "replied" },
  { id: "resolved", label: "Resolved", match: (s) => s === "resolved" },
];

const ICON = { waiting: Clock, sent: Send, working: Loader2, replied: MessageSquare, resolved: CheckCheck, unverified: ShieldAlert } as const;
// 색만으로 구분하지 않도록 아이콘과 글자를 함께 쓴다.
const TONE: Record<CommentState, string> = {
  waiting: "text-muted-foreground",
  sent: "text-focus-ring",
  working: "text-focus-ring",
  unverified: "text-foreground",
  replied: "text-emerald-400",
  resolved: "text-muted-foreground",
};

/** 상태 배지: 아이콘과 이름. 핀과 목록에서 같은 모양을 쓴다. */
export function StateBadge({ state, className }: { state: CommentState; className?: string }) {
  const Icon = ICON[state];
  return (
    // cn은 text-micro(글자 크기)를 글자색으로 보고 지우므로 일반 문자열로 잇는다.
    <span className={`inline-flex items-center gap-1 text-micro ${TONE[state]} ${className ?? ""}`}>
      <Icon className={`h-3 w-3 ${state === "working" ? "animate-spin" : ""}`} aria-hidden="true" />{STATE_LABEL[state]}
    </span>
  );
}

/** Claude 세션 연결 표시(헤더나 패널 상단에 둔다). 모르면(null) 아무것도 그리지 않는다. */
export function ChannelBadge({ connected, className }: { connected: boolean | null; className?: string }) {
  if (connected === null) return null;
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 whitespace-nowrap text-micro text-muted-foreground ${className ?? ""}`}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-muted-foreground/60")} />
      {connected ? "Claude connected" : "Claude not connected"}
    </span>
  );
}

function NotConnected({ open }: { open: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(CMD); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* 클립보드 거부: 명령을 직접 복사한다 */ } };
  return (
    <details open={open} className="rounded-lg bg-hover" data-testid="channel-help">
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
        <ChannelBadge connected={false} />
        <span className="ml-auto whitespace-nowrap text-micro text-muted-foreground">How to connect</span>
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <p className="text-caption text-muted-foreground">Comments are saved and sent to Claude as soon as a session connects. To start one, run this in the slidekit folder:</p>
        <code className="block break-all rounded-md bg-black/30 px-2 py-1.5 text-micro text-foreground">{CMD}</code>
        <Button size="compact" variant="secondary" className="self-start" onClick={copy} aria-label="Copy command" leadingIcon={copied ? Check : Copy}>{copied ? "Copied" : "Copy command"}</Button>
      </div>
    </details>
  );
}

interface CommentsPanelProps {
  comments: Comment[];
  /** Claude 채널 MCP 서버가 연결돼 있는지. 모르면 null. */
  channel: boolean | null;
  onJump(c: Comment): void;
  onResolve(c: Comment, resolved: boolean): void;
  /** 검증 안 된 코멘트를 사용자가 믿기로 한다(이 기기의 키로 다시 서명). 없으면 Trust 버튼을 보이지 않는다. */
  onTrust?(c: Comment): void;
  /** 삭제(Delete 키). 되돌리기 토스트는 부른 쪽(useCommentsLive.remove)이 띄운다. */
  onRemove?(c: Comment): void;
  /** 캔버스 핀과 목록이 서로를 강조하도록 마우스나 포커스가 올라간 코멘트 id를 맞춘다. */
  hoverId?: string | null;
  onHover?(id: string | null): void;
}

export function CommentsPanel({ comments, channel, onJump, onResolve, onTrust, onRemove, hoverId, onHover }: CommentsPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set()); // 길어서 펼친 코멘트
  const root = useRef<HTMLDivElement>(null);
  const nums = useMemo(() => numbering(comments), [comments]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, comments.filter((c) => f.match(stateOf(c))).length])) as Record<Filter, number>, [comments]);
  const shown = comments.filter((c) => FILTERS.find((f) => f.id === filter)!.match(stateOf(c)));
  const groups = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of shown) { const k = c.slideDeleted ? -1 : c.slide; m.set(k, [...(m.get(k) ?? []), c]); }
    return [...m.entries()].sort(([a], [b]) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
  }, [shown]);

  // 목록 키보드: J/K 또는 아래/위 화살표로 코멘트 사이를 옮기고, E로 해결과 되돌리기. 입력창 안에서는 동작하지 않는다.
  const onKeys = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    const mains = [...(root.current?.querySelectorAll<HTMLElement>("[data-comment-main]") ?? [])];
    const li = t.closest("li[data-comment-id]");
    const cur = mains.findIndex((m) => m.closest("li") === li);
    if (k === "j" || k === "k" || k === "arrowdown" || k === "arrowup") {
      e.preventDefault(); e.stopPropagation(); // 편집기 전역 위아래 화살표(슬라이드 이동)와 겹치지 않게 한다
      const down = k === "j" || k === "arrowdown";
      mains[Math.max(0, Math.min(mains.length - 1, cur < 0 ? (down ? 0 : mains.length - 1) : cur + (down ? 1 : -1)))]?.focus();
    } else if ((e.key === "Delete" || e.key === "Backspace") && li && onRemove) {
      const c = comments.find((x) => x.id === li.getAttribute("data-comment-id"));
      if (c) {
        e.preventDefault(); e.stopPropagation();
        // 지운 뒤에도 키보드 흐름이 이어지게 다음(없으면 이전) 코멘트로 포커스를 옮긴다.
        (mains[cur + 1] ?? mains[cur - 1])?.focus();
        onRemove(c);
      }
    } else if (k === "e" && li) {
      const c = comments.find((x) => x.id === li.getAttribute("data-comment-id"));
      if (c) { e.preventDefault(); e.stopPropagation(); onResolve(c, stateOf(c) !== "resolved"); }
    }
  };

  return (
    <div ref={root} onKeyDown={onKeys} className="flex flex-col gap-3 pt-3" data-testid="comments-panel">
      {channel === false ? <NotConnected open={comments.length === 0} /> : <ChannelBadge connected={channel} />}
      {comments.length > 0 && (
        <div role="group" aria-label="Filter comments" className="flex flex-wrap gap-1">
          {FILTERS.filter((f) => f.id === "all" || f.id === "open" || f.id === filter || counts[f.id] > 0).map((f) => ( // Replied와 Resolved는 0건이면 숨겨 한 줄에 맞춘다
            <Button key={f.id} size="compact" variant={filter === f.id ? "secondary" : "ghost"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
            </Button>
          ))}
        </div>
      )}
      {comments.length > 1 && <p className="px-1 text-micro text-muted-foreground">J and K move between comments, E resolves, Delete removes.</p>}
      {comments.length === 0 && (
        <p className="text-caption text-muted-foreground">No comments yet. Select an element and press C, or use the comment button in its toolbar.</p>
      )}
      {comments.length > 0 && shown.length === 0 && <p className="text-caption text-muted-foreground">No comments in this filter.</p>}
      {groups.map(([slide, list]) => (
        <section key={slide} aria-label={slide === -1 ? "Deleted slides" : `Slide ${slide}`} className="flex flex-col gap-1">
          <h3 className="px-1 text-micro uppercase tracking-wide text-muted-foreground">{slide === -1 ? "Deleted slides" : `Slide ${slide}`}</h3>
          <ul className="flex flex-col gap-1">
            {list.map((c) => {
              const st = stateOf(c);
              return (
                <li
                  key={c.id}
                  data-comment-id={c.id}
                  data-state={st}
                  onMouseEnter={() => onHover?.(c.id)}
                  onMouseLeave={() => onHover?.(null)}
                  onFocus={() => onHover?.(c.id)}
                  onBlur={() => onHover?.(null)}
                  className={cn("flex flex-col gap-1 rounded-lg p-2", hoverId === c.id ? "bg-hover ring-1 ring-focus-ring/60" : "bg-hover/60", st === "resolved" && "opacity-70")}
                >
                  <button
                    type="button"
                    data-comment-main
                    aria-keyshortcuts="J K E"
                    onClick={() => onJump(c)}
                    aria-label={`Comment ${nums.get(c.id)}, ${STATE_LABEL[st]}: ${c.text.slice(0, 60)}`}
                    className="flex cursor-default flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black/40 px-1 text-micro tabular-nums">{nums.get(c.id)}</span>
                      <StateBadge state={st} />
                      <span className="ml-auto text-micro text-muted-foreground">{ago(c.createdAt)}</span>
                    </span>
                    {c.excerpt && <span className="truncate text-micro text-muted-foreground">on &ldquo;{c.excerpt}&rdquo;</span>}
                    <span className={cn("whitespace-pre-wrap break-words text-body", c.text.length > 220 && !open.has(c.id) && "line-clamp-5")}>{c.text}</span>
                  </button>
                  {c.text.length > 220 && (
                    <Button size="compact" variant="ghost" className="self-start" aria-expanded={open.has(c.id)} onClick={() => setOpen((o) => { const n = new Set(o); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>{open.has(c.id) ? "Show less" : "Show more"}</Button>
                  )}
                  {c.reply && (
                    <div className="flex flex-col gap-0.5 border-l-2 border-border pl-2" data-testid="comment-reply">
                      <span className="text-micro text-muted-foreground">Claude{c.repliedAt ? `, ${ago(c.repliedAt)}` : ""}</span>
                      <span className="whitespace-pre-wrap break-words text-body text-muted-foreground">{c.reply}</span>
                    </div>
                  )}
                  {st === "unverified" && (
                    <p className="border-l-2 border-border pl-2 text-micro text-muted-foreground" data-testid="unverified-note">
                      This comment was not created on this computer, so it is not sent to Claude. Trust it only if you know where it came from.
                    </p>
                  )}
                  <div className="flex justify-end gap-1">
                    {st === "unverified" && onTrust && <Button size="compact" variant="secondary" onClick={() => onTrust(c)} aria-label={`Trust comment ${nums.get(c.id)}`} leadingIcon={ShieldAlert}>Trust</Button>}
                    {st === "resolved"
                      ? <Button size="compact" variant="ghost" onClick={() => onResolve(c, false)} aria-label={`Reopen comment ${nums.get(c.id)}`} leadingIcon={RotateCcw}>Reopen</Button>
                      : <Button size="compact" variant="ghost" onClick={() => onResolve(c, true)} aria-label={`Resolve comment ${nums.get(c.id)}`} leadingIcon={Check}>Resolve</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
export type { CommentsPanelProps };
