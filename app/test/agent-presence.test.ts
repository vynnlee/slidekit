import { expect, test } from "bun:test";
import { MIN_SHOW_MS, createPresence, colorOf, type Completion, type PresenceEvent } from "../src/lib/agent-presence";

function harness() {
  let t = 1000; const timers: { at: number; f: () => void }[] = [];
  const store = createPresence("d", { now: () => t, setTimer: (f, ms) => { const x = { at: t + ms, f }; timers.push(x); return x; }, clearTimer: (x) => { const i = timers.indexOf(x as never); if (i >= 0) timers.splice(i, 1); } });
  const done: Completion[] = []; store.onCompletion((c) => done.push(c));
  const advance = (ms: number) => { t += ms; for (const x of [...timers].sort((a, b) => a.at - b.at)) if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.f(); } };
  return { store, done, advance, timers, now: () => t };
}
const start = (id: string, o: Partial<PresenceEvent> = {}): PresenceEvent => ({ type: "agent.edit.start", id, deck: "d", agent: "claude", kind: "edit", slide: 3, anchor: { path: "", excerpt: "Title" }, ttl: 10000, ...o } as PresenceEvent);

test("start는 세션을 만들고 색은 이름으로 안정적으로 정해진다", () => {
  const h = harness(); h.store.ingest(start("a"));
  const s = h.store.snapshot().sessions;
  expect(s.length).toBe(1); expect(s[0]).toMatchObject({ id: "a", agent: "claude", slide: 3 });
  expect(colorOf("claude")).toBe(colorOf("Claude")); expect(s[0].color).toBe(colorOf("claude"));
});

test("done은 start 뒤 최소 600ms가 지난 뒤에 끝나고 완료 이벤트를 한 번 낸다", () => {
  const h = harness(); h.store.ingest(start("a")); h.advance(50);
  h.store.ingest({ type: "agent.edit.done", id: "a", deck: "d", agent: "claude", changed: [{ slide: 3, excerpt: "Title" }], revision: "r", via: "tool" });
  expect(h.store.snapshot().sessions.length).toBe(1); expect(h.done.length).toBe(0);
  h.advance(MIN_SHOW_MS - 100); expect(h.done.length).toBe(0);
  h.advance(100); expect(h.done.length).toBe(1); expect(h.store.snapshot().sessions.length).toBe(0);
  expect(h.done[0].outcome).toMatchObject({ type: "done", changed: [{ slide: 3, excerpt: "Title" }] });
  expect(h.store.recentDone([3])).toBe(true); expect(h.store.recentDone([4])).toBe(false);
});

test("오래 걸린 수정은 done 즉시 끝난다", () => {
  const h = harness(); h.store.ingest(start("a")); h.advance(2000);
  h.store.ingest({ type: "agent.edit.done", id: "a", deck: "d", changed: [] });
  h.advance(0); expect(h.done.length).toBe(1);
});

test("fail은 변경 없이 끝나고, ttl이 지나면 말없이 정리된다(완료 이벤트 없음)", () => {
  const h = harness(); h.store.ingest(start("a")); h.advance(700);
  h.store.ingest({ type: "agent.edit.fail", id: "a", deck: "d", reason: "not_found" }); h.advance(0);
  expect(h.done[0].outcome).toEqual({ type: "fail", reason: "not_found" });
  h.store.ingest(start("b", { ttl: 3000 })); h.advance(2999); expect(h.store.snapshot().sessions.length).toBe(1);
  h.advance(2); expect(h.store.snapshot().sessions.length).toBe(0); expect(h.done.length).toBe(1);
});

test("같은 id의 start는 ttl을 새로 세고 시작 시각은 유지한다", () => {
  const h = harness(); h.store.ingest(start("a", { ttl: 3000 })); h.advance(2500);
  h.store.ingest(start("a", { ttl: 3000, slide: 4 })); h.advance(2500);
  expect(h.store.snapshot().sessions[0]).toMatchObject({ slide: 4 });
  h.advance(600); expect(h.store.snapshot().sessions.length).toBe(0);
});

test("start 없이 온 done(파일 감시)은 커서 없이 완료 이벤트만 낸다", () => {
  const h = harness();
  h.store.ingest({ type: "agent.edit.done", id: "w", deck: "d", changed: [{ slide: 2, excerpt: "" }], via: "watch" });
  expect(h.done.length).toBe(1); expect(h.store.snapshot().sessions.length).toBe(0); expect(h.done[0].outcome).toMatchObject({ via: "watch" });
  expect(h.store.recentDone([2])).toBe(false); // 파일 감시 done은 일반 토스트를 막지 않는다
});

test("다른 덱의 이벤트와 잘못된 이벤트는 무시한다", () => {
  const h = harness();
  h.store.ingest({ ...(start("x") as object), deck: "other" } as PresenceEvent);
  h.store.ingest({ ...(start("") as object) } as PresenceEvent);
  expect(h.store.snapshot().sessions.length).toBe(0);
});

test("보이는 세션은 3개까지고 나머지는 hidden으로 센다, 이벤트가 폭주해도 알림은 한 번에 합친다", async () => {
  const h = harness(); let n = 0; h.store.subscribe(() => n++);
  for (let i = 0; i < 500; i++) h.store.ingest(start("s" + (i % 5), { slide: 1 + (i % 5) }));
  await Promise.resolve();
  expect(n).toBe(1); const snap = h.store.snapshot();
  expect(snap.sessions.length).toBe(3); expect(snap.hidden).toBe(2);
});

test("dispose는 타이머와 구독을 모두 정리한다(누수 없음)", () => {
  const h = harness(); h.store.subscribe(() => {}); h.store.ingest(start("a"));
  expect(h.timers.length).toBe(1); h.store.dispose(); expect(h.timers.length).toBe(0);
  h.store.ingest(start("b")); expect(h.store.snapshot().sessions.length).toBe(0);
});
