import type { Comment } from "@/lib/deck";
import type { Flow } from "@/lib/comment-flow";

// 코멘트의 흐름: 저장됨(waiting) -> Claude 세션에 전달됨(sent) -> 작업 시작(working) -> 답변됨(replied) -> 해결(resolved)
// 이 기기의 서명이 없거나 틀린 코멘트(trusted가 false)는 사용자가 Trust 하기 전까지 unverified이고 Claude에 전달되지 않는다.
export type CommentState = "held" | "waiting" | "sent" | "working" | "replied" | "resolved" | "unverified";

export const stateOf = (c: Comment): CommentState =>
  c.resolved ? "resolved" : c.status === "done" ? "replied" : c.trusted === false ? "unverified" : c.ackAt ? "working" : c.deliveredAt ? "sent" : c.held ? "held" : "waiting";

export const STATE_LABEL: Record<CommentState, string> = {
  held: "Held",
  waiting: "Waiting",
  sent: "Sent to Claude",
  working: "Claude is working",
  unverified: "Unverified",
  replied: "Replied",
  resolved: "Resolved",
};

/** 덱 전체에서 작성 순서대로 1부터 매기는 번호. 캔버스 핀과 목록이 같은 번호를 쓴다. */
export function numbering(comments: Comment[]): Map<string, number> {
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return new Map(sorted.map((c, i) => [c.id, i + 1]));
}

/** "just now", "5 min ago", "2 h ago", "3 d ago" */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}


// ---- 생명주기(spec/COMMENT-UX.md 2절): 화면 이름 5개, 막힌 이유, 멈춘 요청 ----
/** 멈춘 요청의 기준. 전달 뒤 ack가 2분 넘게 없거나, ack 뒤 reply가 10분 넘게 없다(채널의 backfill과 같은 값). */
export const STALL_SENT_MS = 120_000, STALL_WORKING_MS = 600_000;
/** 사용자에게 보이는 이름. 내부 상태(data-state)는 그대로이고 held와 waiting과 unverified는 Saved로 읽는다(unverified는 별도 배지). */
export const DISPLAY: Record<CommentState, "Saved" | "Sent" | "Working" | "Replied" | "Resolved"> = {
  held: "Saved", waiting: "Saved", unverified: "Saved", sent: "Sent", working: "Working", replied: "Replied", resolved: "Resolved",
};
export type Reason = null | "held" | "disconnected" | "paused" | "limit";
export type Lifecycle = { state: CommentState; stalled: boolean; reason: Reason };

/** 한 코멘트의 상태, 멈춤 여부, 아직 안 간 이유. Saved(held, waiting)일 때만 reason이 있다. */
export function lifecycle(c: Comment, ctx: { channel: boolean | null; flow: Flow | null; now?: number }): Lifecycle {
  const state = stateOf(c), now = ctx.now ?? Date.now();
  const stalled = state === "sent" ? !!c.deliveredAt && now - Date.parse(c.deliveredAt) > STALL_SENT_MS : state === "working" ? !!c.ackAt && now - Date.parse(c.ackAt) > STALL_WORKING_MS : false;
  let reason: Reason = null;
  if (state === "held") reason = "held";
  else if (state === "waiting") reason = ctx.flow?.reason === "user" ? "paused" : ctx.flow?.reason === "limit" ? "limit" : ctx.channel === false ? "disconnected" : null; // 연결돼 있고 막힘이 없으면 곧 전송된다
  return { state, stalled, reason };
}

/** 이유 한 줄(영어). resetAt은 flow에서 온다. */
export function reasonText(reason: Reason, flow: Flow | null): string {
  if (reason === "held") return "Waiting for you to send";
  if (reason === "paused") return "Paused";
  if (reason === "limit") return flow?.resetAt ? `Limit reached, resumes ${new Date(flow.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}` : "Limit reached";
  if (reason === "disconnected") return "Claude is not connected";
  return "";
}
