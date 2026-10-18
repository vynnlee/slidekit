import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { byPath } from "@/lib/deck-source";
import { FLASH_MS, displayName, findByExcerpt, type FlashBus, type PresenceStore, type Session } from "@/lib/agent-presence";

// 캔버스 위 에이전트 존재 효과(spec/AGENT-PRESENCE.md, /tmp/slidekit-agent-fx/DESIGN.md). 오버레이에만 그린다(pointer-events 없음, iframe 안은 건드리지 않음).
// 좌표는 iframe 안 getBoundingClientRect가 곧 오버레이 좌표다(배지 레이어와 같다). 위치는 이벤트가 오거나 보기(줌, 슬라이드, 내용)가 바뀔 때만 한 번 읽는다.
type Box = { x: number; y: number; w: number; h: number };
const rectOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const resolve = (slide: Element, a: Session["anchor"]): Element | null => {
  if (!a) return null;
  const el = a.path ? byPath(slide, a.path) : findByExcerpt(slide, a.excerpt);
  return el && el !== slide ? el : null;
};
const BANDS = 5, GRID = 18;

export function AgentFx({ presence, flashes, slide, slideNo, viewKey, rev }: { presence: PresenceStore; flashes: FlashBus; slide: HTMLElement | null; slideNo: number; viewKey: string; rev: unknown }) {
  const snap = useSyncExternalStore(presence.subscribe, presence.snapshot), fl = useSyncExternalStore(flashes.subscribe, flashes.snapshot);
  const here = snap.sessions.filter((s) => s.slide === slideNo);
  const key = here.map((s) => s.id + "@" + (s.anchor?.excerpt ?? "") + (s.anchor?.path ?? "")).join("|");
  const [geo, setGeo] = useState<{ slide: Box; targets: Record<string, Box | null> } | null>(null);
  const [boxes, setBoxes] = useState<Record<number, Box[]>>({});

  // 위치 읽기: 세션이 있는 동안만(대기 중에는 아무것도 하지 않는다)
  useLayoutEffect(() => {
    if (!slide || !here.length) { setGeo(null); return; }
    const read = () => setGeo({ slide: rectOf(slide), targets: Object.fromEntries(here.map((s) => { const el = resolve(slide, s.anchor); return [s.id, el ? rectOf(el) : null]; })) });
    read();
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read); };
    const win = slide.ownerDocument.defaultView;
    win?.addEventListener("scroll", again, true); win?.addEventListener("resize", again); win?.addEventListener("wheel", again, { passive: true });
    return () => { cancelAnimationFrame(raf); win?.removeEventListener("scroll", again, true); win?.removeEventListener("resize", again); win?.removeEventListener("wheel", again); };
  }, [slide, key, viewKey, rev]); // eslint-disable-line

  // 변경 강조: 현재 슬라이드의 요청만, 요소 최대 12개(없거나 못 찾으면 슬라이드 전체), 1.3초 뒤 제거. 타이머는 요청마다 한 번만 걸고 해제 때만 걷는다
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useLayoutEffect(() => {
    if (!slide) return;
    const mine = fl.filter((f) => f.slide === slideNo && !timers.current.has(f.id));
    if (!mine.length) return;
    setBoxes((b) => {
      const next = { ...b };
      for (const f of mine) {
        const els = f.excerpts.map((x) => (x ? findByExcerpt(slide, x) : null)).filter((e): e is Element => !!e && e !== slide);
        next[f.id] = els.length ? els.map(rectOf) : [rectOf(slide)];
      }
      return next;
    });
    for (const f of mine) timers.current.set(f.id, setTimeout(() => { timers.current.delete(f.id); flashes.done(f.id); setBoxes((b) => { const n = { ...b }; delete n[f.id]; return n; }); }, FLASH_MS));
  }, [fl, slide, slideNo]); // eslint-disable-line
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  // 다른 슬라이드의 요청은 그리지 않고 정리한다(필름스트립의 updated 표시가 알린다)
  useEffect(() => { for (const f of fl) if (f.slide !== slideNo) flashes.done(f.id); }, [fl, slideNo, flashes]);

  if (!slide) return null;
  const active = here.length > 0 && geo;
  const colorOfFlash = (id: number) => fl.find((f) => f.id === id)?.color ?? "#a78bfa";
  return (
    <div data-testid="agent-layer" aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {active && geo && (
        <div data-testid="agent-slide-fx" className="agent-on absolute overflow-hidden" style={{ left: geo.slide.x, top: geo.slide.y, width: geo.slide.w, height: geo.slide.h }}>
          <div className="agent-breathe absolute inset-0" style={{ boxShadow: `inset 0 0 0 2px ${here[0].color}, inset 0 0 40px ${here[0].color}55, 0 0 0 1px ${here[0].color}` }} />
          {Array.from({ length: BANDS }, (_, i) => (
            <div key={i} data-testid="agent-wave" className="agent-wave absolute inset-y-0" style={{ left: `${(i / BANDS) * 100 - 6}%`, width: `${100 / BANDS + 12}%`, animationDelay: `${i * 0.45}s`, backgroundImage: `radial-gradient(circle, ${here[0].color}99 1px, transparent 1.7px)`, backgroundSize: `${GRID}px ${GRID}px`, WebkitMaskImage: "linear-gradient(90deg, transparent, #000 35%, #000 65%, transparent)", maskImage: "linear-gradient(90deg, transparent, #000 35%, #000 65%, transparent)" }} />
          ))}
        </div>
      )}
      {active && geo && here.map((s, i) => {
        const t = geo.targets[s.id], sl = geo.slide;
        const x = (t ? t.x + Math.min(24, t.w / 2) : sl.x + sl.w / 2) , y = (t ? t.y + Math.min(20, t.h / 2) : sl.y + sl.h / 2) + i * 22;
        return (
          <div key={s.id}>
            {t && <div data-testid="agent-target" className="agent-on agent-breathe absolute rounded-sm" style={{ left: t.x - 3, top: t.y - 3, width: t.w + 6, height: t.h + 6, outline: `2px dashed ${s.color}`, boxShadow: `0 0 18px ${s.color}88` }} />}
            <div data-testid="agent-cursor" data-agent={s.agent} className="agent-on agent-cursor absolute left-0 top-0" style={{ transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)` }}>
              <svg width="16" height="16" viewBox="0 0 16 16" className="absolute left-0 top-0 drop-shadow"><path d="M1 1l5 13 2-5 5-2z" fill={s.color} stroke="#111" strokeWidth="1" strokeLinejoin="round" /></svg>
              <span className="absolute left-3 top-3 whitespace-nowrap rounded-full px-1.5 py-0.5 text-micro font-medium leading-none text-black shadow" style={{ background: s.color }}>{`✦ ${displayName(s.agent)}`}</span>
            </div>
          </div>
        );
      })}
      {Object.entries(boxes).flatMap(([id, list]) => list.map((b, i) => (
        <div key={id + ":" + i} data-testid="agent-flash" className="agent-on agent-flash absolute rounded-sm" style={{ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8, outline: `2px solid ${colorOfFlash(Number(id))}`, boxShadow: `0 0 22px ${colorOfFlash(Number(id))}aa` }} />
      )))}
    </div>
  );
}
