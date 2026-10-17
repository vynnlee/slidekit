import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Minus, Play, Plus, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MAX_MS, outAwayOf, awayOf, quickOf, type StepSpec } from "@/lib/animation-model";
import { isStepper, planEdit, readSlide, type AnimRow } from "@/lib/animation-dom";
import { addBar, aboveOf, barOf, compose, moveToClick, relationOf, removeBar, setBarTime, snap, snapTargets, timelineOf, type Bar, type Click, type Res, type Target, type Timeline } from "@/lib/timeline";
import type { PlayHead } from "@/lib/play-head";
import { nameOf } from "./LayerTree";

// 하단 Animation 탭: 정식 타임라인(spec/ANIMATION.md v2 4절, /tmp/slidekit-anim-ux2/DESIGN.md).
// 클릭 구역(Click 1, 2 ...)을 세로로 쌓고 각 구역에 같은 시간 눈금과 요소별 트랙(막대: 왼쪽 위치 = Delay, 길이 = Duration)을 둔다.
// 끄는 동안은 React 상태를 쓰지 않고 막대 DOM의 left/width와 칩, 안내선만 직접 바꾸며, 놓을 때 한 번 저장한다(실행 취소 한 건).
// With previous / After previous는 저장하지 않는다: 같은 시작, 앞 막대 끝에 붙임을 스냅과 칩이 알려 줄 뿐이고 숫자(지연, 시간)만 쓴다.
const LABEL_W = 148, ROW_H = 26, HANDLE = 6, SNAP_PX = 6, GRID = 50;
const sec = (ms: number) => `${(ms / 1000).toFixed(ms % 100 === 0 ? 1 : 2)}s`;
const REL_TEXT: Record<string, string> = { click: "Starts on click", with: "Starts with previous", after: "Starts after previous" };

type Props = {
  slide: HTMLElement | null;
  sel: Element | null;
  rev: unknown; // 슬라이드 내용이 바뀔 때마다 달라져 다시 그린다
  head: PlayHead;
  playing: boolean;
  onAnim(edits: [HTMLElement, StepSpec][], key?: string): void;
  onSelect(el: HTMLElement): void;
  onPlay(): void;
  onFix?(el: HTMLElement): void;
};

type Drag = {
  mode: "move" | "l" | "r"; bar: Bar; node: HTMLElement; x0: number; y0: number; start0: number; len0: number; origLeft: string; origWidth: string;
  moved: boolean; target: Target | null; res: Res | null; start: number; len: number; sections: { click: number; top: number; bottom: number }[] | null; gaps: { gap: number; top: number; bottom: number }[] | null; // 구역 위치는 세로로 움직이기 시작할 때 한 번만 잰다(가로 끌기에서는 레이아웃을 읽지 않는다)
 
  targets: ReturnType<typeof snapTargets>; lane: HTMLElement; pps: number;
};

const issueText = (code: string, value: string) => ({
  "step-invalid": `data-step has an invalid value (${value}) and is ignored`, "step-one": "data-step=1 is ignored (use 2 or more)", "out-invalid": `data-step-out has an invalid value (${value}) and is ignored`,
  "out-before-in": `Out (${value}) is not after In`,
} as Record<string, string>)[code] ?? code;

const barLabel = (name: string, b: Bar, spec: StepSpec, rel: string, delayText: string, visible: string | null) => {
  const a = b.kind === "in" ? awayOf(spec) : outAwayOf(spec);
  const rest = `${name}, ${b.kind === "in" ? "In" : "Out"}, ${(quickOf(a) ?? "custom effect")}, ${rel === "delay" ? delayText : REL_TEXT[rel].toLowerCase()}, delay ${sec(b.start)}, lasts ${sec(b.len)}`;
  return visible ? `${visible}, ${rest}` : rest; // 막대 안에 보이는 글자가 이름에 그대로 들어 있어야 한다(WCAG 2.5.3)
};

export function Timeline(p: Props) {
  // 읽기(요소마다 속성과 computed style)는 슬라이드 내용(rev)이나 선택이 바뀔 때만 한다: 줌, 접기, 막대 강조 같은 지역 상태 변화에서는 다시 읽지 않는다
  const rows: AnimRow[] = useMemo(() => (p.slide ? readSlide(p.slide, p.sel) : []), [p.slide, p.rev, p.sel]);
  const specs = useMemo(() => rows.map((r) => r.spec), [rows]), tl = useMemo(() => timelineOf(specs), [specs]), stepper = !!p.slide && isStepper(p.slide);
  const scroll = useRef<HTMLDivElement>(null), chip = useRef<HTMLDivElement>(null), guide = useRef<HTMLDivElement>(null), live = useRef<HTMLSpanElement>(null), timeLabel = useRef<HTMLSpanElement>(null);
  const drag = useRef<Drag | null>(null);
  const [width, setWidth] = useState(900), [zoom, setZoom] = useState<number | null>(null), [selBar, setSelBar] = useState<string | null>(null);
  const [folded, setFolded] = useState<Record<number, boolean>>({}), [help, setHelp] = useState(false);
  const [, force] = useState(0);
  const H = useRef<Record<string, (...a: never[]) => unknown>>({}), lastK = useRef<number | null | undefined>(undefined);
  const stableRef = useRef<Record<string, (...a: never[]) => unknown> | null>(null); // 막대와 눈금의 이벤트 처리는 항상 최신 렌더의 함수를 부른다(줄을 memo해도 낡은 값을 쓰지 않게)
  if (!stableRef.current) stableRef.current = Object.fromEntries(["down", "move", "end", "key", "rulerDown", "rulerMove", "rulerUp"].map((n) => [n, (...a: never[]) => (H.current[n] as (...x: never[]) => unknown)(...a)]));

  useLayoutEffect(() => {
    const el = scroll.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxEnd = tl.bars.reduce((m, b) => Math.max(m, b.end), 0);
  const T = Math.min(MAX_MS, Math.max(1500, Math.ceil((maxEnd + 400) / 250) * 250)); // 눈금 끝(ms)
  const fit = Math.max(40, Math.min(400, (width - LABEL_W - 28) / (T / 1000)));
  const pps = zoom ?? fit, areaW = Math.round((T / 1000) * pps);
  const ppsRef = useRef(pps); ppsRef.current = pps;

  const stable = { current: stableRef.current as Record<string, (...a: never[]) => unknown> };
  const act = useRef({ rows, specs, tl, p, pps, T });
  act.current = { rows, specs, tl, p, pps, T };

  // 재생 헤드 표시: 스크럽과 재생 중의 시간 선과 라벨은 React 상태가 아니라 DOM으로 바로 갱신한다
  useEffect(() => {
    let raf = 0, t0 = 0;
    const lines = () => scroll.current?.querySelectorAll<HTMLElement>("[data-testid=tl-playhead]") ?? [];
    const show = (click: number | null, ms: number) => {
      for (const l of lines()) { const on = click !== null && Number(l.dataset.click) === click; l.style.display = on ? "block" : "none"; if (on) l.style.left = `${LABEL_W + (ms / 1000) * ppsRef.current}px`; }
      if (timeLabel.current) timeLabel.current.textContent = click === null ? "" : `Click ${click} · ${(ms / 1000).toFixed(2)}s`;
    };
    const tick = () => { const h = p.head.get(); if (!h.animate || h.k === null) return; show(h.k - 1, performance.now() - t0); raf = requestAnimationFrame(tick); };
    const on = () => {
      cancelAnimationFrame(raf);
      const h = p.head.get();
      if (h.scrub) show(h.scrub.click, h.scrub.t);
      else if (h.animate && h.k !== null && h.k >= 2) { t0 = performance.now(); raf = requestAnimationFrame(tick); }
      else show(null, 0);
      if (lastK.current !== h.k) { lastK.current = h.k; force((n) => n + 1); }
    };
    const un = p.head.subscribe(on);
    return () => { un(); cancelAnimationFrame(raf); };
  }, [p.head]);

  if (!p.slide) return <div className="px-3 text-caption text-muted-foreground">Open a slide to edit its animation</div>;
  const slide = p.slide, sel = p.sel as HTMLElement | null;
  const selRow = sel ? rows.findIndex((r) => r.el === sel) : -1;
  const headK = p.head.get().k, N = tl.clicks.length, curClick = Math.max(0, Math.min(N, (headK ?? N + 1) - 1));
  const hasIn = selRow >= 0 && !!barOf(tl, selRow, "in"), hasOut = selRow >= 0 && !!barOf(tl, selRow, "out");
  const canAdd = selRow >= 0 && !(hasIn && hasOut);
  const elOf = (b: { el: number }) => rows[b.el].el;
  const say = (msg: string) => { if (live.current) live.current.textContent = msg; };
  const commit = (res: Res, key?: string) => {
    const e = planEdit(rows, res);
    if (e) p.onAnim(e, key);
    else if (!res.ok) say(res.reason);
    return res.ok;
  };
  const folded0 = (c: number) => folded[c] ?? (N > 10 && c !== curClick && !(selRow >= 0 && tl.clicks[c - 1].bars.some((b) => b.el === selRow)));

  const addAnim = () => { if (selRow < 0) return; commit(addBar(specs, selRow, hasIn ? "out" : "in")); };
  const nameFor = (i: number) => nameOf(rows[i].el);

  // ---- 스크럽 ----
  const scrubAt = (e: React.PointerEvent<HTMLElement>, click: number) => {
    const lane = e.currentTarget, r = lane.getBoundingClientRect();
    const t = Math.round(Math.max(0, Math.min(T, ((e.clientX - r.left) / ppsRef.current) * 1000)));
    p.head.set({ k: click + 1, animate: false, scrub: { click, t } });
  };
  const rulerDown = (e: React.PointerEvent<HTMLElement>, click: number) => {
    if (e.button !== 0 || stepper) return;
    e.currentTarget.setPointerCapture(e.pointerId); scrubAt(e, click);
  };
  const rulerMove = (e: React.PointerEvent<HTMLElement>, click: number) => { if (e.buttons & 1 && e.currentTarget.hasPointerCapture(e.pointerId)) scrubAt(e, click); };
  const rulerUp = (e: React.PointerEvent<HTMLElement>, click: number) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { e.currentTarget.releasePointerCapture(e.pointerId); p.head.set({ k: click + 1, animate: false, scrub: null }); } };

  // ---- 막대 끌기 ----
  const showChip = (text: string, x: number, y: number, bad = false) => {
    const c = chip.current; if (!c) return;
    c.textContent = text; c.style.display = text ? "block" : "none"; c.style.left = `${x + 12}px`; c.style.top = `${y - 30}px`; c.dataset.bad = bad ? "1" : "";
  };
  const showGuide = (ms: number | null, lane: HTMLElement) => {
    const g = guide.current; if (!g) return;
    if (ms === null) { g.style.display = "none"; return; }
    const r = lane.getBoundingClientRect(), sec0 = lane.closest("[data-testid=tl-click]")?.getBoundingClientRect();
    g.style.display = "block"; g.style.left = `${r.left + (ms / 1000) * ppsRef.current}px`; g.style.top = `${sec0?.top ?? r.top}px`; g.style.height = `${sec0?.height ?? r.height}px`;
  };
  const mark = (attr: string, el: Element | null) => { scroll.current?.querySelectorAll(`[${attr}]`).forEach((e) => e.removeAttribute(attr)); el?.setAttribute(attr, "1"); };
  const down = (e: React.PointerEvent<HTMLElement>, bar: Bar, mode: Drag["mode"], node: HTMLElement) => {
    if (e.button !== 0 || stepper) return;
    e.stopPropagation();
    const lane = node.parentElement as HTMLElement, root = scroll.current!;
    drag.current = { mode, bar, node, x0: e.clientX, y0: e.clientY, start0: bar.start, len0: bar.len, origLeft: node.style.left, origWidth: node.style.width, moved: false, target: null, res: null, start: bar.start, len: bar.len, sections: null, gaps: null, targets: snapTargets(tl.clicks[bar.click - 1], bar), lane, pps: ppsRef.current };
    node.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current; if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    d.moved = true;
    const dms = ((e.clientX - d.x0) / d.pps) * 1000, thr = (SNAP_PX / d.pps) * 1000, free = e.altKey;
    const sn = (ms: number) => (free ? { ms: Math.round(ms / 10) * 10, hit: null } : snap(ms, d.targets, thr, GRID));
    let hit: ReturnType<typeof snap>["hit"] = null, text = "";
    if (d.mode === "move") {
      const r = sn(Math.max(0, d.start0 + dms)), r2 = sn(Math.max(0, d.start0 + dms + d.len0)); // 시작 또는 끝이 후보에 붙는다
      const useEnd = !r.hit && !!r2.hit; d.start = Math.max(0, useEnd ? r2.ms - d.len0 : r.ms); hit = useEnd ? r2.hit : r.hit; text = `Delay ${sec(d.start)}`;
    } else if (d.mode === "r") {
      const r = sn(Math.max(d.start0 + 50, d.start0 + d.len0 + dms)); d.len = Math.max(0, r.ms - d.start0); hit = r.hit; text = `Duration ${sec(d.len)}`;
    } else {
      const end = d.start0 + d.len0, r = sn(Math.min(end, Math.max(0, d.start0 + dms))); d.start = r.ms; d.len = Math.max(0, end - r.ms); hit = r.hit; text = `Delay ${sec(d.start)}`;
    }
    d.node.style.left = `${(d.start / 1000) * d.pps}px`; d.node.style.width = `${Math.max(HANDLE, (d.len / 1000) * d.pps)}px`;
    // 위아래: 다른 구역 또는 새 구역
    let target: Target | null = null;
    if (d.mode === "move" && (d.sections || Math.abs(e.clientY - d.y0) > 8)) {
      if (!d.sections) {
        const root0 = scroll.current!;
        d.sections = [...root0.querySelectorAll<HTMLElement>("[data-testid=tl-click]")].map((s) => { const r = s.getBoundingClientRect(); return { click: Number(s.dataset.click), top: r.top, bottom: r.bottom }; });
        d.gaps = [...root0.querySelectorAll<HTMLElement>("[data-gap]")].map((s) => { const r = s.getBoundingClientRect(); return { gap: Number(s.dataset.gap), top: r.top, bottom: r.bottom }; });
      }
      const y = e.clientY, secHit = d.sections.find((s) => y >= s.top && y < s.bottom), gapHit = (d.gaps as NonNullable<Drag["gaps"]>).find((g) => y >= g.top && y < g.bottom);
      target = secHit ? (secHit.click === d.bar.click ? null : { click: secHit.click }) : gapHit ? { gap: gapHit.gap } : null;
      d.node.style.transform = `translateY(${Math.round(e.clientY - d.y0)}px)`;
      d.node.style.zIndex = "5";
    }
    d.target = target;
    d.res = target ? moveToClick(act.current.specs, d.bar, target) : null;
    const root = scroll.current;
    mark("data-drop", target && "click" in target ? root?.querySelector(`[data-testid=tl-click][data-click="${target.click}"]`) ?? null : target ? root?.querySelector(`[data-gap="${target.gap}"]`) ?? null : null);
    const bad = !!d.res && !d.res.ok;
    if (bad) { text = (d.res as { reason: string }).reason; root?.querySelector(`[data-drop]`)?.setAttribute("data-invalid", "1"); }
    else if (hit && hit.kind !== "click") text = `${hit.kind === "with" ? "With previous" : "After previous"} · ${nameFor(hit.ref!.el)}`;
    else if (hit?.kind === "click") text = "On click";
    showChip(text, e.clientX, e.clientY, bad);
    showGuide(hit ? hit.t : null, d.lane);
  };
  const end = (e: React.PointerEvent<HTMLElement>, cancel = false) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.node.hasPointerCapture(e.pointerId)) d.node.releasePointerCapture(e.pointerId);
    d.node.style.left = d.origLeft; d.node.style.width = d.origWidth; d.node.style.transform = ""; d.node.style.zIndex = "";
    mark("data-drop", null); scroll.current?.querySelectorAll("[data-invalid]").forEach((x) => x.removeAttribute("data-invalid"));
    showChip("", 0, 0); showGuide(null, d.lane);
    if (cancel) return;
    if (!d.moved) { flushSync(() => setSelBar(d.bar.id)); const el0 = elOf(d.bar); requestAnimationFrame(() => p.onSelect(el0)); return; } // 막대 강조는 바로(타임라인만 다시 그림), 캔버스 선택(편집기 전체)은 다음 프레임
    const b = d.bar, s = act.current.specs;
    const steps: ((x: StepSpec[]) => Res)[] = [];
    if (d.target) steps.push((x) => moveToClick(x, b, d.target as Target));
    if (d.start !== d.start0 || d.len !== d.len0) steps.push((x) => setBarTime(x, b, { start: d.start, len: d.len }));
    if (!steps.length) return;
    const res = compose(s, ...steps);
    if (!commit(res)) say((res as { reason: string }).reason);
    else if (d.target) say(`${nameFor(b.el)} moved to ${"click" in d.target ? `click ${d.target.click}` : "a new click"}`);
    else say(`${nameFor(b.el)} delay ${sec(d.start)}, lasts ${sec(d.len)}`);
  };

  // ---- 키보드(막대) ----
  const bars = tl.clicks.flatMap((c) => c.bars);
  const activeId = selBar && bars.some((b) => b.id === selBar) ? selBar : bars.find((b) => b.el === selRow)?.id ?? bars[0]?.id ?? null;
  const focusBar = (id: string) => scroll.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
  const key = (e: React.KeyboardEvent<HTMLElement>, b: Bar) => {
    const k = e.key;
    if (/^(Arrow(Left|Right|Up|Down)|Delete|Backspace|Enter|Home)$/.test(k) || (!e.metaKey && !e.ctrlKey && /^[wa]$/i.test(k))) e.nativeEvent.stopPropagation(); // 편집기의 전역 단축키로 새지 않게 한다
    const i = bars.findIndex((x) => x.id === b.id), c = tl.clicks[b.click - 1], key2 = `anim:${b.id}`;
    if (stepper) return;
    if ((k === "ArrowUp" || k === "ArrowDown") && !e.altKey) { e.preventDefault(); const n = bars[i + (k === "ArrowUp" ? -1 : 1)]; if (n) { setSelBar(n.id); focusBar(n.id); } return; }
    if ((k === "ArrowUp" || k === "ArrowDown") && e.altKey) {
      e.preventDefault();
      const to: Target = k === "ArrowUp" ? (b.click > 1 ? { click: b.click - 1 } : { gap: 0 }) : (b.click < N ? { click: b.click + 1 } : { gap: N });
      commit(moveToClick(specs, b, to)); say(`${nameFor(b.el)} moved to ${"click" in to ? `click ${to.click}` : "a new click"}`); return;
    }
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const d = (k === "ArrowLeft" ? -1 : 1) * GRID;
      const res = e.shiftKey ? setBarTime(specs, b, { len: Math.max(0, b.len + d) }) : setBarTime(specs, b, { start: Math.max(0, b.start + d) });
      if (commit(res, key2)) say(e.shiftKey ? `${nameFor(b.el)} lasts ${sec(Math.max(0, b.len + d))}` : `${nameFor(b.el)} delay ${sec(Math.max(0, b.start + d))}`);
    } else if (k === "Home") { e.preventDefault(); commit(setBarTime(specs, b, { start: 0 }), key2); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); const n = bars[i + 1] ?? bars[i - 1]; commit(removeBar(specs, b)); say(`${nameFor(b.el)} ${b.kind === "in" ? "In" : "Out"} removed`); if (n) setSelBar(n.id); }
    else if (k === "Enter") { e.preventDefault(); setSelBar(b.id); p.onSelect(elOf(b)); }
    else if (!e.metaKey && !e.ctrlKey && /^[wa]$/i.test(k)) {
      e.preventDefault();
      const above = aboveOf(c, b); if (!above) { say("No bar above"); return; }
      const start = k.toLowerCase() === "w" ? above.start : above.end;
      if (commit(setBarTime(specs, b, { start }))) say(`${nameFor(b.el)} starts ${k.toLowerCase() === "w" ? "with" : "after"} previous`);
    } else if (k === "Escape") { (e.currentTarget as HTMLElement).blur(); }
  };

  H.current = { down, move, end, key, rulerDown, rulerMove, rulerUp } as never;

  // ---- 눈금과 구역 ----
  const ticks = Array.from({ length: Math.floor(T / 500) + 1 }, (_, i) => i * 500);
  const gridBg = `repeating-linear-gradient(to right, transparent 0, transparent ${Math.max(1, pps * 0.25 - 1)}px, var(--color-border, #2b2b30) ${Math.max(1, pps * 0.25 - 1)}px, var(--color-border, #2b2b30) ${pps * 0.25}px)`;
  const toolbarClick = headK === null ? N : curClick;
  const goClick = (n: number) => p.head.set({ k: Math.max(1, Math.min(N + 1, n + 1)), animate: false, scrub: null });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="timeline">
      <div className="flex h-7 shrink-0 items-center gap-1 px-2">
        <Tooltip content={p.playing ? "Stop" : "Play all clicks. A short pause stands for each click."} side="top">
          <Button aria-label={p.playing ? "Stop preview" : "Play"} variant="ghost" size="compact" leadingIcon={p.playing ? Square : Play} onClick={p.onPlay}>{p.playing ? "Stop" : "Play"}</Button>
        </Tooltip>
        <Button aria-label="Previous click" variant="ghost" size="icon-compact" disabled={N === 0 || toolbarClick <= 0} onClick={() => goClick(toolbarClick - 1)}><ChevronLeft /></Button>
        <span data-testid="tl-click-label" className="min-w-14 text-center text-caption tabular-nums text-muted-foreground">{N === 0 ? "" : `Click ${toolbarClick}/${N}`}</span>
        <Button aria-label="Next click" variant="ghost" size="icon-compact" disabled={N === 0 || toolbarClick >= N} onClick={() => goClick(toolbarClick + 1)}><ChevronRight /></Button>
        <span ref={timeLabel} aria-live="polite" data-testid="tl-time" className="min-w-24 text-caption tabular-nums text-muted-foreground" />
        <span className="flex-1" />
        {N > 10 && (() => { const allOpen = tl.clicks.every((c) => !folded0(c.click)); return <Button aria-label={allOpen ? "Collapse all clicks" : "Expand all clicks"} variant="ghost" size="compact" onClick={() => setFolded(Object.fromEntries(tl.clicks.map((c) => [c.click, allOpen])))}>{allOpen ? "Collapse all" : "Expand all"}</Button>; })()}
        <Button aria-label="Zoom out" variant="ghost" size="icon-compact" onClick={() => setZoom(Math.max(30, pps / 1.25))}><Minus /></Button>
        <Button aria-label="Fit" variant="ghost" size="compact" onClick={() => setZoom(null)}>Fit</Button>
        <Button aria-label="Zoom in" variant="ghost" size="icon-compact" onClick={() => setZoom(Math.min(800, pps * 1.25))}><Plus /></Button>
        <Tooltip content="How timing works" side="top"><Button aria-label="How timing works" aria-expanded={help} variant="ghost" size="icon-compact" onClick={() => setHelp((v) => !v)}><CircleHelp /></Button></Tooltip>
        <Tooltip content="Add an In (or Out) animation to the selected element." side="top">
          <Button aria-label="Add animation" variant="ghost" size="compact" leadingIcon={Plus} disabled={!canAdd || stepper} onClick={addAnim}>Add animation</Button>
        </Tooltip>
      </div>
      {help && (
        <div role="note" data-testid="tl-help" className="mx-2 mb-1 rounded-md bg-hover p-2 text-caption text-muted-foreground">
          <p><b className="text-foreground">Click n</b>: plays when you click (or press →) the n-th time while presenting. Bars inside one click share a time axis.</p>
          <p><b className="text-foreground">Delay</b> is how long a bar waits after the click (its left edge); <b className="text-foreground">Duration</b> is its length. Bars that start together play <b className="text-foreground">with previous</b>; a bar placed where another ends plays <b className="text-foreground">after previous</b>. Drag a bar to a different click to change when it plays.</p>
        </div>
      )}
      <span ref={live} role="status" aria-live="polite" data-testid="tl-live" className="sr-only" />
      {stepper && <div className="mx-2 mb-1 rounded-md bg-hover px-2 py-1 text-caption text-muted-foreground">This slide uses a custom stepper. The timeline is read-only.</div>}
      <div ref={scroll} className="relative min-h-0 flex-1 overflow-auto px-2 pb-2" data-testid="tl-scroll">
        <ul aria-label="Animation warnings" className="m-0 list-none p-0">
          {rows.map((r, i) => r.range.issues.length > 0 && (
            <li key={i} data-testid="tl-warning" className="flex items-center gap-1 py-0.5 text-caption text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{`${nameFor(i)}: ${r.range.issues.map((x) => issueText(x.code, x.value)).join("; ")}`}</span>
              <Button size="compact" variant="ghost" onClick={() => p.onFix ? p.onFix(r.el) : p.onAnim([[r.el, r.spec]])}>Fix</Button>
            </li>
          ))}
        </ul>
        {N === 0 && selRow < 0 && <div data-testid="tl-empty" className="py-3 text-center text-caption text-muted-foreground">No animations yet.<br />Select an element, then press Add animation.</div>}
        <div role="region" aria-label="Animation timeline" style={{ minWidth: LABEL_W + areaW }} className="relative">
          {tl.clicks.map((c, ci) => (
            <div key={c.click}>
              <div data-gap={ci} data-testid="tl-gap" className="h-1.5 data-[drop]:h-3 data-[drop]:bg-focus-ring/40 data-[invalid]:bg-destructive/40" />
              <ClickSection c={c} pps={pps} areaW={areaW} T={T} ticks={ticks} gridBg={gridBg} folded={folded0(c.click)} curClick={curClick}
                onFold={() => setFolded((f) => ({ ...f, [c.click]: !folded0(c.click) }))} rows={rows} sel={selRow} selBar={selBar} activeId={activeId} stepper={stepper}
                nameFor={nameFor} down={stable.current.down as SectionProps["down"]} move={stable.current.move as SectionProps["move"]} end={stable.current.end as SectionProps["end"]} key2={stable.current.key as SectionProps["key2"]} rulerDown={stable.current.rulerDown as SectionProps["rulerDown"]} rulerMove={stable.current.rulerMove as SectionProps["rulerMove"]} rulerUp={stable.current.rulerUp as SectionProps["rulerUp"]}
                onPlayClick={() => { p.head.set({ k: c.click, animate: false, scrub: null }); requestAnimationFrame(() => p.head.set({ k: c.click + 1, animate: true, scrub: null })); }} />
            </div>
          ))}
          <div data-gap={N} data-testid="tl-new-click" className="mt-1 rounded-md border border-dashed border-border px-2 py-1 text-center text-caption text-muted-foreground data-[drop]:border-focus-ring data-[drop]:bg-focus-ring/20 data-[invalid]:border-destructive">New click: drop a bar here</div>
          {selRow >= 0 && !hasIn && !hasOut && !stepper && (
            <button type="button" data-testid="tl-ghost" onClick={addAnim} className="mt-1 flex w-full items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-left text-caption text-muted-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
              <Plus className="size-3.5" />{nameFor(selRow)} — Add animation
            </button>
          )}
        </div>
        <div ref={chip} data-testid="tl-chip" className="pointer-events-none fixed z-50 hidden rounded bg-foreground px-1.5 py-0.5 text-micro text-background data-[bad]:bg-destructive data-[bad]:text-white" style={{ display: "none" }} />
        <div ref={guide} data-testid="tl-guide" className="pointer-events-none fixed z-40 w-px border-l border-dashed border-focus-ring" style={{ display: "none" }} />
      </div>
    </div>
  );
}

type SectionProps = {
  c: Click; pps: number; areaW: number; T: number; ticks: number[]; gridBg: string; folded: boolean; curClick: number; onFold(): void; rows: AnimRow[]; sel: number; selBar: string | null; activeId: string | null; stepper: boolean;
  nameFor(i: number): string;
  down(e: React.PointerEvent<HTMLElement>, bar: Bar, mode: Drag["mode"], node: HTMLElement): void; move(e: React.PointerEvent<HTMLElement>): void; end(e: React.PointerEvent<HTMLElement>, cancel?: boolean): void;
  key2(e: React.KeyboardEvent<HTMLElement>, b: Bar): void;
  rulerDown(e: React.PointerEvent<HTMLElement>, click: number): void; rulerMove(e: React.PointerEvent<HTMLElement>, click: number): void; rulerUp(e: React.PointerEvent<HTMLElement>, click: number): void;
  onPlayClick(): void;
};

function ClickSection(s: SectionProps) {
  const { c } = s;
  return (
    <section data-testid="tl-click" data-click={c.click} role="group" aria-label={`Click ${c.click}, 0.0 to ${sec(c.length)}`} className="relative rounded-md data-[drop]:bg-focus-ring/10 data-[invalid]:bg-destructive/10" style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${ROW_H * (c.bars.length + 1)}px` }}>
      <div className="flex" style={{ height: ROW_H - 4 }}>
        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-background pr-2 text-caption text-foreground" style={{ width: LABEL_W }}>
          <button type="button" aria-expanded={!s.folded} aria-label={`${s.folded ? "Expand" : "Collapse"} Click ${c.click}`} onClick={s.onFold} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">{s.folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
          <Tooltip content={`Plays when you click (or press →) for the ${c.click === 1 ? "1st" : c.click === 2 ? "2nd" : c.click === 3 ? "3rd" : `${c.click}th`} time while presenting.`} side="top"><span className="font-medium">{`Click ${c.click}`}</span></Tooltip>
          <span className="text-micro tabular-nums text-muted-foreground">{`0.0–${sec(c.length)}`}</span>
          <Button aria-label={`Play Click ${c.click}`} variant="ghost" size="icon-compact" onClick={s.onPlayClick}><Play /></Button>
        </div>
        <div data-testid="tl-ruler" data-ruler={c.click} className="relative cursor-col-resize touch-none select-none text-micro text-muted-foreground" style={{ width: s.areaW }} title="Drag to scrub this click"
          onPointerDown={(e) => s.rulerDown(e, c.click)} onPointerMove={(e) => s.rulerMove(e, c.click)} onPointerUp={(e) => s.rulerUp(e, c.click)} onPointerCancel={(e) => s.rulerUp(e, c.click)}>
          {s.ticks.map((t) => <span key={t} className="absolute top-0.5 tabular-nums" style={{ left: (t / 1000) * s.pps + 2 }}>{t % 1000 === 0 ? `${t / 1000}s` : ""}</span>)}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-border" />
        </div>
      </div>
      {!s.folded && (
        <ul role="list" aria-label={`Click ${c.click} animations`} className="m-0 list-none p-0">
          {c.bars.map((b, i) => <TrackRow key={b.id} {...s} b={b} above={i > 0 ? c.bars[i - 1] : null} />)}
        </ul>
      )}
      <div data-testid="tl-playhead" data-click={c.click} className="pointer-events-none absolute inset-y-0 z-20 w-px bg-focus-ring" style={{ display: "none", left: LABEL_W }} />
    </section>
  );
}

type RowProps = SectionProps & { b: Bar; above: Bar | null };
const TrackRow = memo(function TrackRow(s: RowProps) {
  const { b, c } = s, spec = s.rows[b.el].spec, name = s.nameFor(b.el), rel = relationOf(b, s.above), on = b.el === s.sel, strong = s.selBar === b.id;
  const left = (b.start / 1000) * s.pps, w = Math.max(HANDLE, (b.len / 1000) * s.pps);
  const effect = quickOf(b.kind === "in" ? awayOf(spec) : outAwayOf(spec)), label = effect ? effect[0].toUpperCase() + effect.slice(1) : "Custom";
  const delayText = `delay ${sec(b.start)}`;
  const tip = `${label} · ${rel === "delay" ? `Starts ${sec(b.start)} after the click` : REL_TEXT[rel]} · delay ${sec(b.start)} · lasts ${sec(b.len)}`;
  return (
    <li role="listitem" data-testid="tl-track" data-el={b.el} data-kind={b.kind} className={`flex ${on ? "bg-hover" : ""}`} style={{ height: ROW_H }}>
      <div title={name} className={`sticky left-0 z-10 flex shrink-0 items-center gap-1 truncate pr-2 text-caption ${on ? "bg-hover text-foreground" : "bg-background text-muted-foreground"}`} style={{ width: LABEL_W }}>
        <span aria-hidden="true" className="shrink-0 rounded px-1 text-micro text-foreground" style={{ background: b.kind === "in" ? "color-mix(in srgb, var(--color-focus-ring, #a78bfa) 35%, transparent)" : "rgba(245,158,11,.35)" }}>{b.kind === "in" ? "In" : "Out"}</span>
        <span className="min-w-0 truncate">{name}</span>
      </div>
      <div className="relative" style={{ width: s.areaW, backgroundImage: s.gridBg }} data-testid="tl-lane">
        <div role="button" tabIndex={s.activeId === b.id ? 0 : -1} aria-roledescription="animation bar" aria-label={barLabel(name, b, spec, rel, delayText, w > 56 ? `${label} ${sec(b.len)}` : null)} title={tip}
          data-testid="tl-bar" data-id={b.id} data-el={b.el} data-kind={b.kind} data-click={b.click} data-start={b.start} data-len={b.len} data-sel={on ? "1" : undefined} data-picked={strong ? "1" : undefined}
          className={`absolute inset-y-1 touch-none select-none overflow-hidden whitespace-nowrap px-1.5 text-micro leading-[18px] text-black outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${strong ? "ring-2 ring-foreground" : ""} ${b.kind === "in" ? "rounded-sm bg-focus-ring" : "bg-amber-400 [clip-path:polygon(0_0,100%_0,calc(100%-6px)_100%,0_100%)]"} ${on ? "" : "opacity-80"}`}
          style={{ left, width: w, cursor: s.stepper ? "default" : "grab" }}
          onPointerDown={(e) => s.down(e, b, "move", e.currentTarget)} onPointerMove={s.move} onPointerUp={(e) => s.end(e)} onPointerCancel={(e) => s.end(e, true)} onKeyDown={(e) => s.key2(e, b)}>
          <span aria-hidden="true" data-testid="tl-handle-l" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => { e.stopPropagation(); s.down(e, b, "l", e.currentTarget.parentElement as HTMLElement); }} onPointerMove={s.move} onPointerUp={(e) => s.end(e)} />
          <span aria-hidden="true" data-testid="tl-handle-r" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => { e.stopPropagation(); s.down(e, b, "r", e.currentTarget.parentElement as HTMLElement); }} onPointerMove={s.move} onPointerUp={(e) => s.end(e)} />
          {w > 56 ? `${label} ${sec(b.len)}` : null}
        </div>
      </div>
    </li>
  );
}, (a, b) => a.b.start === b.b.start && a.b.len === b.b.len && a.b.click === b.b.click && a.b.id === b.b.id && a.pps === b.pps && a.areaW === b.areaW && (a.above?.start ?? -1) === (b.above?.start ?? -1) && (a.above?.end ?? -1) === (b.above?.end ?? -1)
  && (a.sel === a.b.el) === (b.sel === b.b.el) && (a.selBar === a.b.id) === (b.selBar === b.b.id) && (a.activeId === a.b.id) === (b.activeId === b.b.id) && a.stepper === b.stepper && a.gridBg === b.gridBg && a.rows[a.b.el]?.spec === b.rows[b.b.el]?.spec && a.nameFor(a.b.el) === b.nameFor(b.b.el));
