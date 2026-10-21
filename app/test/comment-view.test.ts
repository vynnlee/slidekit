// 코멘트 핀 이름, 호버 미리보기, 필터 개수, 트레이 계산. 실행: bun test app/test/comment-view.test.ts
import { expect, test } from "bun:test";
import type { Comment } from "../src/lib/deck";
import { filterCounts, pinLabel, previewOf, sendable, trayText } from "../src/lib/comment-view";

const now = Date.parse("2026-10-20T12:00:00Z");
const mk = (o: Partial<Comment>): Comment => ({ id: "a", slide: 1, path: "h1", excerpt: "", text: "Make this shorter", status: "open", createdAt: new Date(now - 120_000).toISOString(), ...o });

test("pinLabel: 번호와 새 상태 이름", () => {
  expect(pinLabel(mk({ held: true }), 3)).toBe("Comment 3, Saved: Make this shorter");
  expect(pinLabel(mk({ deliveredAt: "x" }), 1)).toMatch(/^Comment 1, Sent: /);
  expect(pinLabel(mk({ ackAt: "x", deliveredAt: "x" }), 1)).toMatch(/Working/);
  expect(pinLabel(mk({ status: "done" }), 1)).toMatch(/Replied/);
  expect(pinLabel(mk({ resolved: true }), 1)).toMatch(/Resolved/);
});

test("previewOf: 머리줄, 줄임, 답 한 줄", () => {
  const p = previewOf(mk({ ackAt: "x", deliveredAt: "x", text: "a\n\n" + "b".repeat(200), reply: "Shortened\nthe title." }), 3, now);
  expect(p.head).toBe("3 · Working · 2 min ago");
  expect(p.text.length).toBe(110);
  expect(p.text.endsWith("…")).toBe(true);
  expect(p.reply).toBe("Claude: Shortened the title.");
  expect(previewOf(mk({}), 1, now).reply).toBeNull();
});

test("filterCounts와 트레이", () => {
  const cs = [mk({ id: "1", held: true }), mk({ id: "2" }), mk({ id: "3", status: "done" }), mk({ id: "4", resolved: true }), mk({ id: "5", trusted: false }), mk({ id: "6", held: true, slideDeleted: true })];
  expect(filterCounts(cs)).toEqual({ all: 6, open: 4, replied: 1, resolved: 1 });
  const s = sendable(cs);
  expect(s.map((c) => c.id)).toEqual(["1", "2"]); // 5는 unverified, 6은 슬라이드 삭제
  expect(trayText(s.length)).toBe("2 saved");
  expect(trayText(0)).toBeNull();
  expect(trayText(12)).toBe("10+ saved");
});
