// 에이전트 존재 신호(spec/AGENT-PRESENCE.md)의 편집기 쪽 상태. 순수 로직이라 단위 테스트한다. React 상태가 아니라 외부 저장소라 이벤트가 와도 편집기 전체가 다시 그려지지 않는다.
// 이벤트(SSE): agent.edit.start / done / fail. 마지막 이벤트 뒤 ttl이 지나면 그 id는 끝난 것으로 본다(커서가 남지 않게). 도구가 수 ms에 끝나므로 start와 done 사이를 최소 MIN_SHOW_MS 보인다.
export const MIN_SHOW_MS = 600;
export const MAX_VISIBLE = 3;
export const AGENT_COLORS = ["#a78bfa", "#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#f472b6"] as const;

type Common = { id: string; deck: string; agent?: string | { name?: string } | null; at?: string; ttl?: number };
export type PresenceEvent =
  | (Common & { type: "agent.edit.start"; kind?: "edit" | "comment"; slide: number; anchor?: { path?: string; excerpt?: string } | null; comment_id?: string })
  | (Common & { type: "agent.edit.done"; changed?: { slide: number; excerpt?: string }[]; revision?: string; via?: "tool" | "watch" | "comment" })
  | (Common & { type: "agent.edit.fail"; reason?: string });

export type Session = {
  id: string; agent: string; color: string; kind: "edit" | "comment"; slide: number; anchor: { path: string; excerpt: string } | null;
  startedAt: number; deadline: number; // deadline: 마지막 이벤트 + ttl
  endAt: number | null; // 끝 이벤트가 오면 화면에서 내릴 시각(start + 최소 표시 시간 이후)
  outcome: { type: "done"; changed: { slide: number; excerpt: string }[]; via: string } | { type: "fail"; reason: string } | null;
};
export type Completion = { session: Session; outcome: NonNullable<Session["outcome"]> };

export function colorOf(agent: string): string {
  let h = 0;
  for (const c of agent.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}
const nameOf = (a: Common["agent"]): string => {
  const n = typeof a === "string" ? a : a?.name;
  return (n && /^[\w.-]{1,32}$/.test(n) ? n : "claude");
};
export const displayName = (agent: string) => (agent.toLowerCase() === "claude" ? "Claude" : agent);

export type PresenceStore = {
  ingest(e: PresenceEvent): void;
  tick(): void;
  /** 화면에 보이는 세션(해당 덱, 끝나는 중인 것 포함, 최대 MAX_VISIBLE)과 넘친 수 */
  snapshot(): { version: number; sessions: Session[]; hidden: number };
  subscribe(f: () => void): () => void;
  onCompletion(f: (c: Completion) => void): () => void;
  /** 최근 끝난 슬라이드들(토스트 합치기용): ms 안에 도구나 코멘트 수정의 done이 온 변경 슬라이드(파일 감시 done은 칩이 없어 일반 토스트를 그대로 둔다) */
  recentDone(slides: number[], ms?: number): boolean;
  dispose(): void;
};

export function createPresence(deck: string, o: { now?: () => number; setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void } = {}): PresenceStore {
  const now = o.now ?? (() => Date.now()), setT = o.setTimer ?? ((f, ms) => setTimeout(f, ms)), clearT = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const sessions = new Map<string, Session>(), subs = new Set<() => void>(), comps = new Set<(c: Completion) => void>();
  const doneLog: { at: number; slides: Set<number> }[] = [];
  let version = 0, timer: unknown = null, pending = false, snap: ReturnType<PresenceStore["snapshot"]> | null = null, dead = false;

  const notify = () => { version++; snap = null; if (pending) return; pending = true; queueMicrotask(() => { pending = false; if (!dead) subs.forEach((f) => f()); }); }; // 폭주해도 한 번에 합쳐 알린다
  const rearm = () => {
    if (timer !== null) { clearT(timer); timer = null; }
    let next = Infinity;
    for (const s of sessions.values()) next = Math.min(next, s.endAt !== null ? s.endAt : s.deadline);
    if (next !== Infinity && !dead) timer = setT(() => { timer = null; tick(); }, Math.max(0, next - now()));
  };
  const finish = (s: Session) => { sessions.delete(s.id); if (s.outcome) { const c = { session: s, outcome: s.outcome }; if (s.outcome.type === "done" && s.outcome.via !== "watch") doneLog.push({ at: now(), slides: new Set(s.outcome.changed.map((x) => x.slide)) }); comps.forEach((f) => f(c)); } };
  const tick = () => {
    const t = now();
    for (const s of [...sessions.values()]) {
      if (s.endAt !== null ? t >= s.endAt : t >= s.deadline) finish({ ...s, outcome: s.endAt !== null ? s.outcome : null }); // ttl이 지난 세션은 말없이 정리한다(완료 이벤트 없음)
    }
    while (doneLog.length && t - doneLog[0].at > 10000) doneLog.shift();
    notify(); rearm();
  };
  const ingest = (e: PresenceEvent) => {
    if (dead || e.deck !== deck || typeof e.id !== "string" || !e.id) return;
    const t = now(), ttl = Math.min(120000, Math.max(1000, Number(e.ttl) || 10000));
    const s = sessions.get(e.id);
    if (e.type === "agent.edit.start") {
      const slide = Number.isInteger(e.slide) && e.slide >= 1 ? e.slide : 1, agent = nameOf(e.agent);
      const anchor = e.anchor ? { path: String(e.anchor.path ?? ""), excerpt: String(e.anchor.excerpt ?? "").slice(0, 200) } : null;
      sessions.set(e.id, { id: e.id, agent, color: colorOf(agent), kind: e.kind === "comment" ? "comment" : "edit", slide, anchor, startedAt: s?.startedAt ?? t, deadline: t + ttl, endAt: null, outcome: null });
    } else if (e.type === "agent.edit.done" || e.type === "agent.edit.fail") {
      const changed = e.type === "agent.edit.done" ? (e.changed ?? []).filter((c) => Number.isInteger(c.slide) && c.slide >= 1).map((c) => ({ slide: c.slide, excerpt: String(c.excerpt ?? "").slice(0, 200) })) : [];
      const outcome: NonNullable<Session["outcome"]> = e.type === "agent.edit.done" ? { type: "done", changed, via: e.via ?? "tool" } : { type: "fail", reason: String(e.reason ?? "error") };
      if (s) sessions.set(e.id, { ...s, endAt: Math.max(t, s.startedAt + MIN_SHOW_MS), deadline: s.deadline, outcome });
      else { // start 없이 온 done(파일 감시 경로): 커서 없이 바로 끝낸다
        const agent = nameOf(e.agent), ghost: Session = { id: e.id, agent, color: colorOf(agent), kind: "edit", slide: changed[0]?.slide ?? 1, anchor: null, startedAt: t, deadline: t, endAt: t, outcome };
        finish(ghost);
      }
    }
    notify(); rearm();
  };
  return {
    ingest, tick,
    snapshot() {
      if (snap) return snap;
      const all = [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt);
      return (snap = { version, sessions: all.slice(0, MAX_VISIBLE), hidden: Math.max(0, all.length - MAX_VISIBLE) });
    },
    subscribe(f) { subs.add(f); return () => { subs.delete(f); }; },
    onCompletion(f) { comps.add(f); return () => { comps.delete(f); }; },
    recentDone(slides, ms = 5000) { const t = now(); return doneLog.some((d) => t - d.at <= ms && slides.every((s) => d.slides.has(s))); },
    dispose() { dead = true; if (timer !== null) clearT(timer); timer = null; sessions.clear(); subs.clear(); comps.clear(); doneLog.length = 0; },
  };
}

/** 슬라이드 안에서 excerpt(보이는 글자 앞부분)를 담은 가장 안쪽 요소. 없으면 null */
export function findByExcerpt(slide: Element, excerpt: string): Element | null {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase(), q = norm(excerpt).slice(0, 60);
  if (!q) return null;
  let best: Element | null = null, bestLen = Infinity;
  for (const el of slide.querySelectorAll("*")) {
    if (el.closest("aside[data-notes]")) continue;
    const t = norm(el.textContent ?? "");
    if (t.includes(q) && t.length < bestLen) { best = el; bestLen = t.length; }
  }
  return best;
}

// ---- 변경 강조 요청 ----
export type FlashRequest = { id: number; slide: number; excerpts: string[]; color: string };
export const FLASH_MAX = 12, FLASH_MS = 1300;
/** 완료 처리가 캔버스 갱신 뒤에 부르는 한 방향 통로: 에이전트 레이어가 현재 슬라이드의 요청만 그린다 */
export function createFlashBus() {
  let list: FlashRequest[] = [], n = 0, snap = list;
  const subs = new Set<() => void>();
  const set = (next: FlashRequest[]) => { list = next; snap = next; subs.forEach((f) => f()); };
  return {
    request(r: Omit<FlashRequest, "id">) { const id = ++n; set([...list, { ...r, id, excerpts: r.excerpts.slice(0, FLASH_MAX) }]); return id; },
    done(id: number) { set(list.filter((x) => x.id !== id)); },
    snapshot: () => snap,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    size: () => subs.size,
  };
}
export type FlashBus = ReturnType<typeof createFlashBus>;
