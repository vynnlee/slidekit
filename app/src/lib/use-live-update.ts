import { useCallback, useEffect, useRef, useState } from "react";
import { chipText, parseDeck, plan, shouldAutoApply, type LiveDeck, type LiveMode, type Plan } from "@/lib/live-update";

// 발표자 화면의 실시간 갱신 흐름(spec/LIVE-UPDATE.md): 덱 파일이 바뀌면(서버의 deck-changed) 새 원본을 받아 기준선과 비교하고,
// 정책에 따라 바로 반영하거나 칩으로 묻는다. 엔진에 보내는 일(perform)은 발표자 화면이 한다.
export type LiveChip = { text: string; reload: boolean };
type Opts = {
  folder?: string; mode: LiveMode;
  pos(): { slide: number; step: number };
  audience(): boolean; // 발표 창이 열려 있거나 휴대폰 리모컨이 붙어 있다
  perform(base: LiveDeck, next: LiveDeck, p: Plan): void;
};
const QUIET_MS = 400, MIN_GAP_MS = 1000;

export function useLiveUpdate(o: Opts) {
  const [chip, setChip] = useState<LiveChip | null>(null);
  const opt = useRef(o); opt.current = o;
  const base = useRef<LiveDeck | null>(null), pending = useRef<LiveDeck | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), busy = useRef(false), again = useRef(false), lastApply = useRef(0);

  const fetchDeck = async (folder: string) => {
    try {
      const r = await fetch(`/api/decks/${encodeURIComponent(folder)}/source`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = (await r.json()) as { source?: unknown };
      return typeof j.source === "string" ? parseDeck(j.source) : null; // 쓰는 도중의 불완전한 파일은 null이라 다음 변경 때 다시 본다
    } catch { return null; }
  };
  const run = useCallback((next: LiveDeck) => {
    const b = base.current;
    if (!b) return;
    const p = plan(b, next, opt.current.pos().slide - 1);
    if (p.reload) return;
    lastApply.current = Date.now();
    opt.current.perform(b, next, p);
    base.current = next; pending.current = null; setChip(null);
  }, []);
  const check = useCallback(async () => {
    const { folder, mode } = opt.current;
    if (!folder) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const next = await fetchDeck(folder);
      if (!next) return;
      if (!base.current) { base.current = next; return; } // 처음 본 파일이 기준선(화면이 읽은 것과 같다)
      if (mode === "off") return;
      const p = plan(base.current, next, opt.current.pos().slide - 1);
      if (p.same) { pending.current = null; setChip(null); return; }
      if (p.reload) { pending.current = next; setChip({ text: chipText(p, next.slides.length), reload: true }); return; }
      if (shouldAutoApply(mode, p, opt.current.audience())) run(next);
      else { pending.current = next; setChip({ text: chipText(p, next.slides.length), reload: false }); }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; schedule(); }
    }
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(check, Math.max(QUIET_MS, lastApply.current + MIN_GAP_MS - Date.now()));
  }, [check]);

  // 기준선: 화면이 덱을 읽은 때의 원본(모드와 상관없이 한 번 받아 둔다. Off에서 Auto로 바꿨을 때 그 사이의 변경을 따라잡는다).
  useEffect(() => {
    base.current = null; pending.current = null; setChip(null);
    if (!o.folder) return;
    let live = true;
    fetchDeck(o.folder).then((d) => { if (live && d && !base.current) base.current = d; });
    return () => { live = false; };
  }, [o.folder]);
  // 변경 신호: 서버의 deck-changed(SSE). 다시 연결되면 놓친 변경을 한 번 확인한다.
  useEffect(() => {
    if (!o.folder || o.mode === "off") return;
    const es = new EventSource("/api/events");
    const onChanged = (e: MessageEvent) => { try { if ((JSON.parse(e.data) as { deck?: string }).deck === opt.current.folder) schedule(); } catch { /* 모르는 형식은 무시 */ } };
    es.addEventListener("deck-changed", onChanged as EventListener);
    es.addEventListener("open", schedule);
    return () => { es.close(); clearTimeout(timer.current); };
  }, [o.folder, o.mode, schedule]);

  const apply = useCallback(() => {
    const next = pending.current;
    if (!next || !base.current) return;
    if (plan(base.current, next, opt.current.pos().slide - 1).reload) { location.reload(); return; } // 스크립트가 바뀌면 다시 읽을 수밖에 없다
    run(next);
  }, [run]);
  return { chip, apply };
}
