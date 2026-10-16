import { memo, useRef, useState, useSyncExternalStore } from "react";
import { GripVertical, Play, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NumberField } from "@/components/ui/number-field";
import { awayOf, setAway, setDelay, type ListRow, type Op, type StepSpec } from "@/lib/animation-model";
import { listOf, planAdd, planEdit, slideStepCount } from "@/lib/animation-dom";
import type { PlayHead } from "@/lib/play-head";
import { nameOf } from "./LayerTree";
import { AnimControls } from "./AnimControls";

// 하단 Animation 탭(spec/ANIMATION.md 4절): Keynote식 애니메이션 목록. 줄 = 요소, In/Out, 효과, 시작 방식, 시간. 단계 번호는 화면에 없고
// 줄 순서와 시작 방식(On click, With previous, After previous)에서 data-step과 지연이 계산되어 저장된다(animation-model.ts의 edit).
// 줄을 누르면 캔버스가 그 줄의 단계까지 실행된 상태가 된다(재생 헤드). 한 번의 조작 = 실행 취소 한 건.
type Props = {
  slide: HTMLElement | null;
  sel: Element | null;
  rev: unknown; // 슬라이드 내용이 바뀔 때마다 달라져 다시 그린다
  head: PlayHead; // 재생 헤드 저장소(k가 null이면 마지막 단계)
  playing: boolean;
  onStep(k: number | null): void;
  onAnim(edits: [HTMLElement, StepSpec][]): void;
  onSelect(el: HTMLElement): void;
  onPlay(): void;
};

const AWAY_FIELDS = [["opacity", "Opacity", "O", ""], ["x", "X", "X", "px"], ["y", "Y", "Y", "px"], ["scale", "Scale", "S", ""], ["blur", "Blur", "B", "px"]] as const;

const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (e: object) => ids.get(e) ?? (ids.set(e, ++nextId), nextId);
type Act = { run(op: Op): void; go(i: number): void; anim(edits: [HTMLElement, StepSpec][]): void; toggle(id: string): void; drag: { current: number | null } };
type RowProps = { r: ListRow; i: number; el: HTMLElement; spec: StepSpec; name: string; on: boolean; cur: boolean; linked: boolean; isOpen: boolean; sig: string; act: { current: Act } };

// 줄 하나. 값이 같으면 다시 그리지 않는다(재생 헤드를 옮길 때 줄이 100개 넘어도 바뀐 줄만 그린다). 콜백은 act ref로 항상 최신을 부른다.
const Row = memo(function Row({ r, i, el, spec, name, on, cur, linked, isOpen, act }: RowProps) {
  const A = () => act.current, id = `${r.id}:${r.kind}`;
  return (
    <li tabIndex={0} aria-label={`${name}, ${r.kind === "in" ? "In" : "Out"}`} aria-current={on ? "true" : undefined} data-testid="anim-row" data-kind={r.kind} data-group={r.group} data-start={r.start}
      className={`rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${on ? "bg-hover" : ""} ${cur ? "border-l-2 border-focus-ring" : "border-l-2 border-transparent"}`}
      onKeyDown={(e) => rowKey(e, i, A())}
      onDragOver={(e) => { if (A().drag.current !== null) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); const from = A().drag.current; A().drag.current = null; if (from !== null && from !== i) A().run({ t: "move", from, to: i }); }}>
      <div className="flex min-h-7 flex-wrap items-center gap-1 px-1">
        <span aria-hidden="true" className="w-12 shrink-0 text-micro text-muted-foreground">{r.start === "click" ? `Click ${r.group}` : ""}</span>
        <span draggable aria-hidden="true" title="Drag to reorder" data-testid="anim-grip" className="cursor-grab text-muted-foreground"
          onDragStart={(e) => { A().drag.current = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }} onDragEnd={() => { A().drag.current = null; }}><GripVertical className="size-3.5" /></span>
        <button type="button" className={`min-w-0 flex-1 basis-24 truncate rounded text-left text-caption outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${on ? "text-foreground" : "text-muted-foreground"}`} title={name} onClick={() => A().go(i)}>{name}</button>
        <span className="w-8 shrink-0 rounded bg-hover px-1 text-center text-micro text-foreground">{r.kind === "in" ? "In" : "Out"}</span>
        <AnimControls row={r} spec={spec} name={name} first={i === 0} linked={linked} onSpec={(s) => A().anim([[el, s]])} onStart={(start) => A().run({ t: "start", at: i, start })} />
        {linked ? <span className="w-16 shrink-0" /> : <Button variant="ghost" size="compact" className="w-16 shrink-0" aria-expanded={isOpen} aria-label={`Custom values of ${name}`} onClick={() => A().toggle(id)}>Custom</Button>}
        <Button aria-label={`Remove ${r.kind === "in" ? "In" : "Out"} animation of ${name}`} variant="ghost" size="icon-compact" onClick={() => A().run({ t: "remove", at: i })}><Trash2 /></Button>
      </div>
      {isOpen && !linked && (
        <div role="group" aria-label={`Custom values of ${name}`} className="grid grid-cols-3 gap-2 px-1 pb-1 pl-[4.5rem] sm:grid-cols-6 [&>*]:min-w-0">
          {AWAY_FIELDS.map(([f, aria, label, unit]) => (
            <NumberField key={f} label={label} aria-label={`Away ${aria.toLowerCase()} of ${name}`} unit={unit} step={f === "opacity" || f === "scale" ? 0.1 : 1}
              value={awayOf(spec)[f].replace(/px$/, "")} muted={spec.away[f] === undefined} onChange={(v) => A().anim([[el, setAway(spec, f, v.trim() === "" ? "" : `${Number(v)}${unit}`)]])} />
          ))}
          <NumberField label="+" aria-label={`Delay of ${name} in ms`} unit="" min={0} step={20} value={String(spec.delay ?? 0)} muted={spec.delay === null}
            onChange={(v) => A().anim([[el, setDelay(spec, v.trim() === "" ? null : Number(v))]])} />
        </div>
      )}
    </li>
  );
}, (a, b) => a.sig === b.sig);

// 줄에 포커스가 있을 때의 키: Alt+위/아래는 순서, Delete는 삭제, Enter는 요소 선택과 헤드 이동
function rowKey(e: React.KeyboardEvent<HTMLElement>, i: number, a: Act) {
  if (e.target !== e.currentTarget) return; // 칸 안의 키(select 등)는 그대로 둔다
  if (/^(Arrow(Up|Down)|Delete|Backspace|Enter|Escape)$/.test(e.key)) e.nativeEvent.stopPropagation(); // 편집기의 전역 단축키(요소 삭제 등)로 새지 않게 한다
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); a.run({ t: "move", from: i, to: i + (e.key === "ArrowUp" ? -1 : 1) }); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); a.run({ t: "remove", at: i }); }
  else if (e.key === "Enter") { e.preventDefault(); a.go(i); }
}

export function AnimationPanel(p: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set()); // Custom을 연 줄(요소와 종류)
  const dragFrom = useRef<number | null>(null), act = useRef<Act>(null as unknown as Act);
  const { rows, list } = p.slide ? listOf(p.slide, p.sel) : { rows: [], list: [] };
  const S = p.slide ? slideStepCount(p.slide, rows) : 1;
  const k0 = useSyncExternalStore(p.head.subscribe, () => p.head.get().k), k = Math.min(k0 ?? S, S);
  const groups = list.length ? list[list.length - 1].group : 0, shown = list.filter((r) => r.step <= k).at(-1)?.group ?? 0;

  if (!p.slide) return <div className="px-3 text-caption text-muted-foreground">Open a slide to edit its animation</div>;
  const slide = p.slide, sel = p.sel as HTMLElement | null;
  const selId = sel ? rows.findIndex((r) => r.el === sel) : -1;
  const run = (op: Op) => { const e = planEdit(slide, p.sel, op); if (e) p.onAnim(e); };
  const add = () => {
    if (!sel || selId < 0) return;
    const hasIn = list.some((r) => r.id === String(selId) && r.kind === "in");
    const e = planAdd(slide, sel, hasIn ? "out" : "in");
    if (e) p.onAnim(e);
  };
  const canAdd = selId >= 0 && list.filter((r) => r.id === String(selId)).length < 2;
  const go = (i: number) => { const r = list[i]; p.onSelect(rows[+r.id].el); p.onStep(r.step); };

  act.current = { run, go, anim: p.onAnim, toggle: (id) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; }), drag: dragFrom };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 px-2">
        <Tooltip content={p.playing ? "Stop" : "Play the animations"} side="top">
          <Button aria-label={p.playing ? "Stop preview" : "Play"} variant="ghost" size="compact" leadingIcon={p.playing ? Square : Play} onClick={p.onPlay}>{p.playing ? "Stop" : "Play"}</Button>
        </Tooltip>
        <span aria-live="polite" className="text-caption tabular-nums text-muted-foreground" data-testid="anim-step-label">{groups === 0 ? "" : shown === 0 ? "Before first click" : `Click ${shown} of ${groups}`}</span>
        <span className="flex-1" />
        <Button aria-label="Add animation" variant="ghost" size="compact" leadingIcon={Plus} disabled={!canAdd} onClick={add}>Add animation</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2" data-testid="anim-scroll">
        {list.length === 0 && <div className="py-2 text-caption text-muted-foreground">No animations. Select an element and choose Add animation.</div>}
        <ul aria-label="Animations" className="flex flex-col gap-0.5">
          {list.map((r, i) => {
            const { el, spec } = rows[+r.id], linked = r.kind === "out" && list.some((o) => o.id === r.id && o.kind === "in");
            const props = { r, i, el, spec, name: nameOf(el), on: el === p.sel, cur: r.step === k, linked, isOpen: open.has(`${r.id}:${r.kind}`) };
            return <Row key={`${r.id}:${r.kind}`} {...props} sig={JSON.stringify([r, i, spec, props.name, props.on, props.cur, linked, props.isOpen, idOf(el)])} act={act} />;
          })}
        </ul>
      </div>
    </div>
  );
}
