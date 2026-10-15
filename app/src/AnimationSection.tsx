import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NumberField } from "@/components/ui/number-field";
import { QUICK, DEFAULT_MS, afterPrevious, applyQuick, awayOf, hasAnimation, matchQuick, setAway, setDelay, setIn, setMs, setOut, type Away, type StepSpec } from "@/lib/animation-model";
import { readSlide, readSpec } from "@/lib/animation-dom";

// 인스펙터의 Animation 섹션(spec/ANIMATION.md 4.2): 등장과 퇴장 단계, 빠른 선택(Fade 등: 누르면 변수 값이 채워진다), 벗어난 상태 값, 시간, 지연, After previous, Play.
// 값은 모두 요소의 data-step, data-step-out과 인라인 변수로 저장되고 이름은 저장되지 않는다. 다중 선택이면 각 요소에 같은 연산을 적용한다(실행 취소 한 건).
type Props = {
  els: HTMLElement[];
  slide: HTMLElement | null;
  onAnim(edits: [HTMLElement, StepSpec][]): void;
  onPlay(el: HTMLElement): void;
};

const AWAY_FIELDS: readonly [keyof Away, string, string][] = [
  ["opacity", "Away opacity", ""], ["x", "Away X", "px"], ["y", "Away Y", "px"], ["scale", "Away scale", ""], ["blur", "Away blur", "px"],
];

export function AnimationSection({ els, slide, onAnim, onPlay }: Props) {
  const el = els[0];
  if (!el) return null;
  const spec = readSpec(el), has = hasAnimation(spec), quick = matchQuick(spec);
  const apply = (fn: (s: StepSpec, e: HTMLElement) => StepSpec) => onAnim(els.map((e) => [e, fn(readSpec(e), e)] as [HTMLElement, StepSpec]));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const prevOf = (e: HTMLElement, s: StepSpec) => (slide ? readSlide(slide).filter((r) => r.el !== e && r.spec.in === s.in).map((r) => r.spec) : []);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
        <NumberField label="In" aria-label="Appears at step" unit="" min={1} step={1} value={spec.in === null ? "1" : String(spec.in)} muted={spec.in === null}
          onChange={(v) => apply((s) => setIn(s, num(v)))} />
        <NumberField label="Out" aria-label="Disappears at step" unit="" min={2} step={1} placeholder="None" value={spec.out === null ? "" : String(spec.out)} muted={spec.out === null}
          onChange={(v) => apply((s) => setOut(s, num(v)))} />
      </div>
      {has && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-micro text-muted-foreground">Quick</span>
            <div role="group" aria-label="Quick effect" className="flex flex-wrap gap-1">
              {QUICK.map(([id, label]) => <Button key={id} aria-label={label} aria-pressed={quick === id} variant={quick === id ? "secondary" : "ghost"} size="compact" onClick={() => apply((s) => applyQuick(s, id))}>{label}</Button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
            {AWAY_FIELDS.map(([k, aria, unit]) => (
              <NumberField key={k} label={k === "opacity" ? "O" : k === "x" ? "X" : k === "y" ? "Y" : k === "scale" ? "S" : "B"} aria-label={aria} unit={unit} step={k === "opacity" || k === "scale" ? 0.1 : 1}
                value={awayOf(spec)[k].replace(/px$/, "")} muted={spec.away[k] === undefined} onChange={(v) => apply((s) => setAway(s, k, v.trim() === "" ? "" : `${Number(v)}${unit}`))} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
            <NumberField label="ms" aria-label="Duration" unit="" min={0} step={20} value={String(spec.ms ?? DEFAULT_MS)} muted={spec.ms === null} onChange={(v) => apply((s) => setMs(s, num(v)))} />
            <NumberField label="+" aria-label="Delay" unit="" min={0} step={20} value={String(spec.delay ?? 0)} muted={spec.delay === null} onChange={(v) => apply((s) => setDelay(s, num(v)))} />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="compact" className="min-w-0 flex-1" onClick={() => apply((s, e) => afterPrevious(s, prevOf(e, s)))}>After previous</Button>
            <Tooltip content="Preview this element" side="top"><Button aria-label="Play animation" variant="ghost" size="icon-compact" onClick={() => onPlay(el)}><Play /></Button></Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
