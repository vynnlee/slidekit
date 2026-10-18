import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, CheckCheck, Clock, Copy, Loader2, MessageSquare, Pause, Play, RotateCcw, Send, ShieldAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { commentMenu } from "@/lib/comment-actions";
import { cn } from "@/lib/utils";
import { flowNote, setPaused, useFlow } from "@/lib/comment-flow";
import type { Comment } from "@/lib/deck";
import { DISPLAY, ago, lifecycle, numbering, reasonText, stateOf, type CommentState } from "@/lib/comment-state";
import { setShowResolved, useShowResolved } from "@/lib/comment-prefs";
import { hoveredComment, setHoveredComment, subscribeHover } from "@/lib/comment-hover";

const CMD = "claude --dangerously-load-development-channels server:slidekit";
type Filter = "all" | "open" | "replied" | "resolved";
const FILTERS: { id: Filter; label: string; match: (s: CommentState) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "open", label: "Open", match: (s) => s === "held" || s === "waiting" || s === "sent" || s === "working" || s === "unverified" },
  { id: "replied", label: "Replied", match: (s) => s === "replied" },
  { id: "resolved", label: "Resolved", match: (s) => s === "resolved" },
];

const ICON = { held: Pause, waiting: Clock, sent: Send, working: Loader2, replied: MessageSquare, resolved: CheckCheck, unverified: ShieldAlert } as const;
// 색만으로 구분하지 않도록 아이콘과 글자를 함께 쓴다.
const TONE: Record<CommentState, string> = {
  held: "text-muted-foreground",
  waiting: "text-muted-foreground",
  sent: "text-focus-ring",
  working: "text-focus-ring",
  unverified: "text-foreground",
  replied: "text-emerald-400",
  resolved: "text-muted-foreground",
};

const STEP: Record<CommentState, number> = { held: 1, waiting: 1, unverified: 1, sent: 2, working: 3, replied: 4, resolved: 4 };
/** 상태 배지: 아이콘, 화면 이름(Saved, Sent, Working, Replied, Resolved), 진행 점 4개(채운 개수가 단계). 핀과 목록에서 같은 이름을 쓴다. */
export function StateBadge({ state, className }: { state: CommentState; className?: string }) {
  const Icon = ICON[state];
  return (
    // cn은 text-micro(글자 크기)를 글자색으로 보고 지우므로 일반 문자열로 잇는다.
    <span className={`inline-flex items-center gap-1 text-micro ${TONE[state]} ${className ?? ""}`}>
      <Icon className={`h-3 w-3 ${state === "working" ? "animate-spin" : ""}`} aria-hidden="true" />{state === "unverified" ? "Unverified" : DISPLAY[state]}
      <span aria-hidden="true" className="ml-0.5 inline-flex gap-0.5">{[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 w-1 rounded-full ${i <= STEP[state] ? "bg-current" : "bg-current opacity-25"}`} />)}</span>
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

/** 자동 처리 상태 한 줄과 Pause, Resume. 멈춤이나 상한이면 이유와 풀리는 때를 보인다(role=status라 바뀌면 읽어 준다). */
function FlowBar() {
  const flow = useFlow();
  if (!flow) return null;
  const note = flowNote(flow), paused = flow.paused;
  return (
    <div className="flex items-center gap-2 px-1" data-testid="comment-flow">
      <span role="status" className={cn("text-micro", note ? "text-amber-300" : "text-muted-foreground")}>{note ?? "Auto-processing on"}</span>
      <Button size="compact" variant="ghost" className="ml-auto" leadingIcon={paused ? Play : Pause} onClick={() => { void setPaused(!paused); }}>{paused ? "Resume" : "Pause"}</Button>
    </div>
  );
}

function NotConnected({ open }: { open: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(CMD); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* 클립보드 거부: 명령을 직접 복사한다 */ } };
  return (
    <details open={open} className="rounded-lg bg-hover" data-testid="channel-help">
      <summary className="flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
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
  /** 영역 코멘트의 이미지(GET /api/comments/:id/image)를 불러올 덱 폴더 */
  folder?: string;
  /** Claude 채널 MCP 서버가 연결돼 있는지. 모르면 null. */
  channel: boolean | null;
  onJump(c: Comment): void;
  onResolve(c: Comment, resolved: boolean): void;
  /** 검증 안 된 코멘트를 사용자가 믿기로 한다(이 기기의 키로 다시 서명). 없으면 Trust 버튼을 보이지 않는다. */
  onTrust?(c: Comment): void;
  /** 삭제(Delete 키). 되돌리기 토스트는 부른 쪽(useCommentsLive.remove)이 띄운다. */
  onRemove?(c: Comment): void;
  /** Claude의 수정 되돌리기와(undo=true) 그 취소. 없으면 되돌리기 버튼을 보이지 않는다. */
  onRevert?(c: Comment, undo?: boolean): void;
  /** 보류했거나 아직 전달되지 않은 코멘트를 한 번에 Claude에 보낸다(묶음 알림 하나). 없으면 버튼을 보이지 않는다. */
  onSendAll?(): void;
  /** 답이 달린 코멘트를 한꺼번에 해결 처리한다. 없으면 버튼을 보이지 않는다. */
  onResolveReplied?(): void;
  /** 코멘트 모드를 켠다(빈 상태의 Start commenting). 없으면 단추를 보이지 않는다. */
  onStartComment?(): void;
  /** 개별 Send(보류나 대기 중인 것), 멈춘 요청의 Resend와 Cancel. 없으면 해당 단추를 보이지 않는다. */
  onSend?(c: Comment): void;
  onResend?(c: Comment): void;
  onCancel?(c: Comment): void;
}

export function CommentsPanel({ comments, folder, channel, onJump, onResolve, onTrust, onRemove, onRevert, onSendAll, onResolveReplied, onStartComment, onSend, onResend, onCancel }: CommentsPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const showResolved = useShowResolved();
  const flow = useFlow();
  const [open, setOpen] = useState<Set<string>>(new Set()); // 길어서 펼친 코멘트
  const root = useRef<HTMLDivElement>(null);
  // 핀과 서로 강조: React 상태를 거치지 않고 속성만 바꾼다(목록이 수백 개여도 마우스를 옮길 때 다시 그리지 않는다).
  useEffect(() => {
    let prev: Element | null = null;
    const apply = () => {
      prev?.removeAttribute("data-hover");
      const id = hoveredComment();
      prev = id ? root.current?.querySelector(`li[data-comment-id="${CSS.escape(id)}"]`) ?? null : null;
      prev?.setAttribute("data-hover", "true");
    };
    apply();
    return subscribeHover(apply);
  }, []);
  const cm = useContextMenu();
  // 우클릭 메뉴(INTERACTION 2.5): 삭제 연결이 있을 때만 연다. 핀 전용 항목(Open in panel)은 없다.
  const actions = onRemove ? { resolve: onResolve, trust: onTrust, remove: onRemove, revert: onRevert } : null;
  const nums = useMemo(() => numbering(comments), [comments]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, comments.filter((c) => f.match(stateOf(c))).length])) as Record<Filter, number>, [comments]);
  // 한꺼번에 처리 줄: 보류가 하나라도 있거나 보낼 것이 3개 이상이면 Send all, 답이 달린 것이 2개 이상이면 Resolve all replied
  const sendable = useMemo(() => comments.filter((c) => !c.slideDeleted && c.anchor !== "lost" && ["held", "waiting"].includes(stateOf(c)) && c.trusted !== false), [comments]);
  const heldCount = sendable.filter((c) => stateOf(c) === "held").length;
  const repliedCount = comments.filter((c) => stateOf(c) === "replied").length;
  const showSend = !!onSendAll && (heldCount > 0 || sendable.length >= 3);
  const showResolve = !!onResolveReplied && repliedCount >= 2;
  const shown = comments.filter((c) => FILTERS.find((f) => f.id === filter)!.match(stateOf(c)));
  const groups = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of shown) { const k = c.slideDeleted || c.anchor === "lost" ? -1 : c.slide; m.set(k, [...(m.get(k) ?? []), c]); }
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
    <div ref={root} onKeyDown={onKeys} className="group/panel flex flex-col gap-3 pt-3" data-testid="comments-panel">
      {channel === false ? <NotConnected open={comments.length === 0} /> : <ChannelBadge connected={channel} />}
      <FlowBar />
      {(showSend || showResolve) && (
        <div role="group" aria-label="Batch actions" className="flex flex-wrap gap-1">
          {showSend && <Button size="compact" variant="secondary" leadingIcon={Send} onClick={onSendAll}>{`Send all to Claude (${sendable.length > 10 ? "10+" : sendable.length})`}</Button>}
          {showResolve && <Button size="compact" variant="ghost" leadingIcon={CheckCheck} onClick={onResolveReplied}>{`Resolve all replied (${repliedCount})`}</Button>}
        </div>
      )}
      {comments.length > 0 && (
        <div role="group" aria-label="Filter comments" className="flex flex-wrap gap-1">
          {FILTERS.filter((f) => f.id === "all" || f.id === "open" || f.id === filter || counts[f.id] > 0).map((f) => ( // Replied와 Resolved는 0건이면 숨겨 한 줄에 맞춘다
            <Button key={f.id} size="compact" variant={filter === f.id ? "secondary" : "ghost"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
            </Button>
          ))}
        </div>
      )}
      {counts.resolved > 0 && (
        <Button size="compact" variant="ghost" className="self-start" aria-pressed={showResolved} onClick={() => setShowResolved(!showResolved)}>{showResolved ? "Hide resolved pins" : "Show resolved pins"}</Button>
      )}
      {comments.length > 1 && <p className="hidden px-1 text-micro text-muted-foreground group-focus-within/panel:block">J and K move between comments, E resolves, Delete removes.</p>}
      {comments.length === 0 && (
        <div className="flex flex-col items-start gap-2" data-testid="comments-empty">
          <p className="text-caption text-muted-foreground">No comments yet. Click an element and press C, or press Shift+C to comment anywhere. Drag to comment on an area.</p>
          {onStartComment && <Button size="compact" variant="secondary" leadingIcon={MessageSquare} onClick={onStartComment}>Start commenting</Button>}
        </div>
      )}
      {comments.length > 0 && shown.length === 0 && <p className="text-caption text-muted-foreground">No comments in this filter.</p>}
      {groups.map(([slide, list]) => (
        <section key={slide} aria-label={slide === -1 ? "Detached" : `Slide ${slide}`} className="flex flex-col gap-1">
          <h3 className="px-1 text-micro uppercase tracking-wide text-muted-foreground">{slide === -1 ? "Detached" : `Slide ${slide}`}</h3>
          <ul className="flex flex-col gap-1">
            {list.map((c) => {
              const lc = lifecycle(c, { channel, flow }), st = lc.state, why = reasonText(lc.reason, flow);
              return (
                <li
                  key={c.id}
                  data-comment-id={c.id}
                  data-state={st}
                  {...(actions ? cm.bind(() => commentMenu(c, actions, "panel")) : {})}
                  onMouseEnter={() => setHoveredComment(c.id)}
                  onMouseLeave={() => setHoveredComment(null)}
                  onFocus={() => setHoveredComment(c.id)}
                  onBlur={() => setHoveredComment(null)}
                  className={cn("flex flex-col gap-1 rounded-lg p-2", "bg-hover/60 data-[hover=true]:bg-hover data-[hover=true]:ring-1 data-[hover=true]:ring-focus-ring/60", st === "resolved" && "opacity-70")}
                >
                  <button
                    type="button"
                    data-comment-main
                    aria-keyshortcuts="J K E"
                    onClick={() => onJump(c)} // 이름은 보이는 글자(번호, 상태, 시각, 요소, 본문)에서 온다. aria-label을 따로 두면 보이는 글자가 이름에 빠진다(WCAG 2.5.3)
                    className="flex cursor-default flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-black/40 px-1 text-micro tabular-nums">{nums.get(c.id)}</span>
                      <StateBadge state={st} />
                      <span className="ml-auto text-micro text-muted-foreground">{ago(c.createdAt)}</span>
                    </span>
                    {c.region && (
                      <span className="flex items-center gap-2 text-micro text-muted-foreground" data-testid="area-info">
                        <span className="rounded bg-black/30 px-1">Area{c.overlap?.length ? `, ${c.overlap.length} ${c.overlap.length === 1 ? "element" : "elements"}` : ""}</span>
                        {c.image === "ready" && folder
                          ? <img src={`/api/comments/${c.id}/image?deck=${encodeURIComponent(folder)}`} alt="" loading="lazy" decoding="async" className="h-16 w-auto max-w-40 rounded border border-border bg-black object-contain" />
                          : c.image === "pending" ? "Making a picture..." : "No picture. Claude gets the area and the elements under it."}
                      </span>
                    )}
                    {why && <span className="text-micro text-muted-foreground" data-testid="state-reason">Saved &middot; {why}</span>}
                    {c.excerpt && <span className="truncate text-micro text-muted-foreground">on &ldquo;{c.excerpt}&rdquo;</span>}
                    {c.recheck && <span className="text-micro text-muted-foreground">Position needs a check. The text was not found on this slide after a restore.</span>}
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
                  {c.reply && c.editBase && onRevert && (
                    <div className="flex items-center gap-1" data-testid="revert-row">
                      {c.revertedAt
                        ? <><span className="text-micro text-muted-foreground">Claude&apos;s edit was reverted.</span><Button size="compact" variant="ghost" onClick={() => onRevert(c, true)} aria-label={`Undo revert of comment ${nums.get(c.id)}`} leadingIcon={RotateCcw}>Undo revert</Button></>
                        : <Button size="compact" variant="ghost" onClick={() => onRevert(c)} aria-label={`Revert Claude's edit for comment ${nums.get(c.id)}`} leadingIcon={Undo2}>Revert Claude&apos;s edit</Button>}
                    </div>
                  )}
                  {st === "unverified" && (
                    <p className="border-l-2 border-border pl-2 text-micro text-muted-foreground" data-testid="unverified-note">
                      This comment was not created on this computer, so it is not sent to Claude. Trust it only if you know where it came from.
                    </p>
                  )}
                  {c.anchor === "lost" && <p className="border-l-2 border-border pl-2 text-micro text-muted-foreground" data-testid="detached-note">This comment lost its place on the slide.</p>}
                  {lc.stalled && (
                    <div role="status" className="flex flex-wrap items-center gap-1 border-l-2 border-amber-300 pl-2" data-testid="stalled">
                      <span className="text-micro text-amber-300">Claude may have stopped</span>
                      {onResend && <Button size="compact" variant="secondary" onClick={() => onResend(c)} aria-label={`Resend comment ${nums.get(c.id)}`} leadingIcon={Send}>Resend</Button>}
                      {onCancel && <Button size="compact" variant="ghost" onClick={() => onCancel(c)} aria-label={`Cancel request for comment ${nums.get(c.id)}`}>Cancel</Button>}
                    </div>
                  )}
                  <div className="flex justify-end gap-1">
                    {(st === "held" || st === "waiting") && onSend && c.anchor !== "lost" && <Button size="compact" variant="secondary" onClick={() => onSend(c)} aria-label={`Send comment ${nums.get(c.id)} to Claude`} leadingIcon={Send}>Send</Button>}
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
      {actions && <ContextMenu menu={cm} />}
    </div>
  );
}
export type { CommentsPanelProps };
