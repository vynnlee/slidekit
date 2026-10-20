import type { Comment } from "@/lib/deck";
import { DISPLAY, ago, stateOf, type CommentState } from "@/lib/comment-state";

// 핀 이름, 호버 미리보기, 필터 개수, 하단 트레이의 순수 계산(spec/COMMENT-UX-UI.md 4.1, 4.3, 5.3, 6).

/** 핀의 접근성 이름. 번호와 화면 상태 이름(Saved, Sent, Working, Replied, Resolved)과 본문 앞부분. */
export const pinLabel = (c: Comment, number: number) => `Comment ${number}, ${DISPLAY[stateOf(c)]}: ${c.text.slice(0, 60)}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** 호버 미리보기: 머리줄, 본문(2줄에 맞게 줄임), 답이 있으면 한 줄. */
export function previewOf(c: Comment, number: number, now = Date.now()) {
  const st = stateOf(c);
  return {
    head: `${number} · ${DISPLAY[st]} · ${ago(c.createdAt, now)}`,
    text: clip(c.text.replace(/\s+/g, " ").trim(), 110),
    reply: c.reply ? `Claude: ${clip(c.reply.replace(/\s+/g, " ").trim(), 70)}` : null,
  };
}

export type Filter = "all" | "open" | "replied" | "resolved";
const OPEN: CommentState[] = ["held", "waiting", "sent", "working", "unverified"];
export const FILTER_MATCH: Record<Filter, (s: CommentState) => boolean> = {
  all: () => true,
  open: (s) => OPEN.includes(s),
  replied: (s) => s === "replied",
  resolved: (s) => s === "resolved",
};
export const filterCounts = (comments: Comment[]) =>
  Object.fromEntries((Object.keys(FILTER_MATCH) as Filter[]).map((f) => [f, comments.filter((c) => FILTER_MATCH[f](stateOf(c))).length])) as Record<Filter, number>;

/** Send all로 갈 수 있는 코멘트: 아직 안 간 것(held, waiting) 중 슬라이드가 있고 앵커가 있고 믿는 것. */
export const sendable = (comments: Comment[]) =>
  comments.filter((c) => !c.slideDeleted && c.anchor !== "lost" && (stateOf(c) === "held" || stateOf(c) === "waiting") && c.trusted !== false);
/** 트레이 문구. 보낼 것이 없으면 null(트레이를 그리지 않는다). 개수는 Send all의 묶음 상한에 맞춰 10+로 줄인다. */
export const trayText = (n: number) => (n > 0 ? `${n > 10 ? "10+" : n} saved` : null);
