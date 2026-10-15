import { useEffect, useRef } from "react";
import { Play, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { clearAll, clearOut, hasAnimation, setIn, setOut, shift, type StepSpec } from "@/lib/animation-model";
import { readSlide, slideStepCount, type AnimRow } from "@/lib/animation-dom";
import { nameOf } from "./LayerTree";

// 하단 Animation 탭(spec/ANIMATION.md 4절): 단계 격자와 요소별 막대(보이는 구간 N부터 M 직전). 막대 끝을 끌면 등장과 퇴장, 몸통을 끌면 둘 다 같은 간격으로 이동한다.
// 끄는 동안은 React 상태를 쓰지 않고 막대 DOM의 left와 width만 직접 바꾸며, 놓을 때 한 번만 onEdit한다(실행 취소 한 건).
const COL = 56; // 단계 칸의 최소 너비(px)
const NAME_W = 148;

type Props = {
  slide: HTMLElement | null;
  sel: Element | null;
  rev: unknown; // 슬라이드 내용이 바뀔 때마다 달라져 다시 그린다
  step: number | null; // 재생 헤드(null이면 마지막 단계)
  playing: boolean;
  onStep(k: number | null): void;
  onEdit(el: HTMLElement, next: StepSpec): void;
  onSelect(el: HTMLElement): void;
  onAddStep(total: number): void;
  onPlay(): void;
};

type Drag = { part: "in" | "out" | "body"; x0: number; colW: number; spec: StepSpec; S: number; moved: boolean; bar: HTMLElement; next: StepSpec; restore: () => void };

const geom = (s: StepSpec, S: number) => {
  const start = s.in ?? 1, end = s.out ?? S + 1;
  return { left: `${((start - 1) / S) * 100}%`, width: `${((end - start) / S) * 100}%` };
};

const label = (name: string, s: StepSpec) =>
  `${name}, ${s.in === null ? "visible from the start" : `appears at step ${s.in}`}${s.out === null ? "" : `, disappears at step ${s.out}`}`;

export function AnimationPanel(p: Props) {
  const drag = useRef<Drag | null>(null);
  const rows: AnimRow[] = p.slide ? readSlide(p.slide, p.sel) : [];
  const S = p.slide ? slideStepCount(p.slide, rows) : 1;
  const head = Math.min(p.step ?? S, S);
  const areaW = Math.max(1, S) * COL;

  useEffect(() => () => { drag.current = null; }, []);

  const next = (part: Drag["part"], spec: StepSpec, dcol: number, S0: number): StepSpec => {
    if (part === "body") return shift(spec, Math.max(-(spec.in ?? spec.out ?? 2), Math.min(dcol, S0 - Math.max(spec.in ?? 1, spec.out === null ? 1 : spec.out - 0) )));
    if (part === "in") {
      const base = spec.in ?? 1, n = base + dcol, limit = (spec.out ?? S0 + 1) - 1;
      return setIn(spec, n <= 1 ? null : Math.min(n, limit));
    }
    const base = spec.out ?? S0 + 1, m = base + dcol;
    return m >= S0 + 1 ? setOut(spec, null) : setOut(spec, Math.max(m, (spec.in ?? 1) + 1));
  };

  const down = (e: React.PointerEvent<HTMLElement>, row: AnimRow, part: Drag["part"], bar: HTMLElement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const area = bar.parentElement!, colW = area.getBoundingClientRect().width / S;
    const g0 = geom(row.spec, S);
    drag.current = {
      part, x0: e.clientX, colW, spec: row.spec, S, moved: false, bar, next: row.spec,
      restore: () => { bar.style.left = g0.left; bar.style.width = g0.width; },
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dcol = Math.round((e.clientX - d.x0) / d.colW);
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    d.next = next(d.part, d.spec, dcol, d.S);
    const g = geom(d.next, d.S);
    d.bar.style.left = g.left; d.bar.style.width = g.width; // 끄는 동안은 DOM만 바꾼다
  };
  const up = (row: AnimRow) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) { p.onSelect(row.el); return; }
    p.onEdit(row.el, d.next);
  };
  const cancel = () => { const d = drag.current; drag.current = null; d?.restore(); };

  const key = (e: React.KeyboardEvent<HTMLElement>, row: AnimRow) => {
    if (/^(Arrow(Left|Right)|Delete|Backspace|Enter|Escape)$/.test(e.key)) e.nativeEvent.stopPropagation(); // 편집기의 전역 단축키(방향키 이동과 넛지, Delete로 요소 삭제)로 새지 않게 한다
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (dir) {
      e.preventDefault();
      const s = row.spec;
      p.onEdit(row.el, e.altKey ? (s.out === null ? (dir > 0 ? s : setOut(s, S)) : setOut(s, s.out + dir > S ? null : s.out + dir)) : e.shiftKey ? setIn(s, (s.in ?? 1) + dir) : shift(s, dir));
    } else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); p.onEdit(row.el, clearAll(row.spec)); }
    else if (e.key === "Enter") { e.preventDefault(); p.onSelect(row.el); }
    else if (e.key === "Escape") cancel();
  };

  if (!p.slide) return <div className="px-3 text-caption text-muted-foreground">Open a slide to edit its animation</div>;

  const minW = NAME_W + areaW;
  const lines = `repeating-linear-gradient(to right, transparent 0, transparent calc(100%/${S} - 1px), var(--color-border, #2b2b30) calc(100%/${S} - 1px), var(--color-border, #2b2b30) calc(100%/${S}))`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 px-2">
        <Tooltip content={p.playing ? "Stop" : "Play the steps"} side="top">
          <Button aria-label={p.playing ? "Stop preview" : "Play steps"} variant="ghost" size="icon-compact" onClick={p.onPlay}>{p.playing ? <Square /> : <Play />}</Button>
        </Tooltip>
        <span aria-live="polite" className="text-caption tabular-nums text-muted-foreground" data-testid="anim-step-label">{`Step ${head} of ${S}`}</span>
        <span className="flex-1" />
        <Tooltip content="Add an empty step" side="top"><Button aria-label="Add step" variant="ghost" size="compact" leadingIcon={Plus} onClick={() => p.onAddStep(S + 1)}>Step</Button></Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2" data-testid="anim-scroll">
        <div role="grid" aria-label="Animation steps" style={{ minWidth: minW }}>
          <div role="row" className="flex h-6 items-center">
            <div role="columnheader" className="sticky left-0 z-10 shrink-0 bg-background pr-2 text-micro text-muted-foreground" style={{ width: NAME_W }}>Element</div>
            <div className="flex" style={{ width: areaW }}>
              {Array.from({ length: S }, (_, i) => i + 1).map((k) => (
                <div role="columnheader" key={k} className="flex-1" style={{ minWidth: COL }}>
                  <button type="button" aria-label={`Step ${k}`} aria-pressed={head === k} onClick={() => p.onStep(k)}
                    className={`h-5 w-full rounded text-micro tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${head === k ? "bg-hover text-foreground" : "text-muted-foreground hover:bg-hover"}`}>{k}</button>
                </div>
              ))}
            </div>
          </div>
          {rows.length === 0 && <div role="row"><div role="gridcell" className="py-2 text-caption text-muted-foreground">No animated elements. Select an element and set Appears at step in the Inspector.</div></div>}
          {rows.map((r) => {
            const name = nameOf(r.el), on = r.el === p.sel, g = geom(r.spec, S), has = hasAnimation(r.spec);
            return (
              <div role="row" key={rows.indexOf(r)} aria-selected={on} className="flex h-6 items-center" data-testid="anim-row">
                <div role="rowheader" title={name} className={`sticky left-0 z-10 shrink-0 truncate bg-background pr-2 text-caption ${on ? "text-foreground" : "text-muted-foreground"}`} style={{ width: NAME_W }}>{name}</div>
                <div role="gridcell" className="relative h-5 rounded-sm" style={{ width: areaW, backgroundImage: lines }}>
                  <div style={{ position: "absolute", top: 0, bottom: 0, left: `${((head - 0.5) / S) * 100}%`, width: 1 }} className="pointer-events-none bg-focus-ring/60" aria-hidden="true" />
                  {has && (
                    <div role="button" tabIndex={0} aria-label={label(name, r.spec)} data-testid="anim-bar" data-in={r.spec.in ?? ""} data-out={r.spec.out ?? ""}
                      className={`absolute inset-y-0.5 touch-none select-none rounded-sm outline-none ring-offset-0 focus-visible:ring-2 focus-visible:ring-focus-ring ${on ? "bg-focus-ring" : "bg-muted-foreground/60"}`}
                      style={{ left: g.left, width: g.width, cursor: "grab" }}
                      onPointerDown={(e) => down(e, r, "body", e.currentTarget)} onPointerMove={move} onPointerUp={() => up(r)} onPointerCancel={cancel} onKeyDown={(e) => key(e, r)}>
                      <span aria-hidden="true" data-testid="anim-handle-in" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => down(e, r, "in", e.currentTarget.parentElement as HTMLElement)} onPointerMove={move} onPointerUp={() => up(r)} />
                      <span aria-hidden="true" data-testid="anim-handle-out" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => down(e, r, "out", e.currentTarget.parentElement as HTMLElement)} onPointerMove={move} onPointerUp={() => up(r)} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
