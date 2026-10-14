import type { Comment } from "@/lib/deck";

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

// 쓸 때 Hold를 켜 두었는지(브라우저에 기억). 켜 두면 새 코멘트는 Send all to Claude를 누를 때까지 보내지 않는다.
const HOLD_KEY = "slidekit.comments.hold";
export const holdPref = (): boolean => { try { return localStorage.getItem(HOLD_KEY) === "1"; } catch { return false; } };
export const setHoldPref = (on: boolean) => { try { localStorage.setItem(HOLD_KEY, on ? "1" : "0"); } catch { /* 저장이 막히면 이번 세션만 */ } };
