import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StepSpec } from "@/lib/animation-model";
import { listOf, planAdd, planEdit } from "@/lib/animation-dom";
import { AnimControls } from "./AnimControls";

// 인스펙터의 Animation 섹션(spec/ANIMATION.md 4.2): + In, + Out 단추, 이미 있으면 효과, 시작 방식, 시간 세 칸만. 하단 Animation 목록과 같은 컨트롤이다.
// 고급 값(이동 거리, 투명도, 지연 직접 입력)은 하단 목록의 줄 안 Custom에 있다.
type Props = {
  els: HTMLElement[];
  slide: HTMLElement | null;
  onAnim(edits: [HTMLElement, StepSpec][]): void;
};

export function AnimationSection({ els, slide, onAnim }: Props) {
  const el = els[0];
  if (!el || !slide || !slide.contains(el)) return null;
  if (els.length > 1) return <p className="text-caption text-muted-foreground">Select one element to edit its animation.</p>;
  const { rows, list } = listOf(slide, el), id = String(rows.findIndex((r) => r.el === el)), name = el.tagName.toLowerCase();
  const mine = list.map((r, i) => ({ r, i })).filter(({ r }) => r.id === id), inn = mine.find(({ r }) => r.kind === "in"), out = mine.find(({ r }) => r.kind === "out");
  const spec = rows[+id].spec;
  const run = (e: [HTMLElement, StepSpec][] | null) => { if (e) onAnim(e); };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {!inn && <Button variant="secondary" size="compact" className="flex-1" leadingIcon={Plus} onClick={() => run(planAdd(slide, el, "in"))}>In</Button>}
        {!out && <Button variant="secondary" size="compact" className="flex-1" leadingIcon={Plus} onClick={() => run(planAdd(slide, el, "out"))}>Out</Button>}
      </div>
      {[inn, out].map((m) => m && (
        <div key={m.r.kind} role="group" aria-label={m.r.kind === "in" ? "In animation" : "Out animation"} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-micro font-medium text-foreground">{m.r.kind === "in" ? "In" : "Out"}</span>
            <Button aria-label={`Remove ${m.r.kind === "in" ? "In" : "Out"} animation`} variant="ghost" size="icon-compact" onClick={() => run(planEdit(slide, el, { t: "remove", at: m.i }))}><Trash2 /></Button>
          </div>
          <AnimControls labels row={m.r} spec={spec} name={name} first={m.i === 0} linked={m.r.kind === "out" && !!inn}
            onSpec={(s) => onAnim([[el, s]])} onStart={(start) => run(planEdit(slide, el, { t: "start", at: m.i, start }))} />
        </div>
      ))}
    </div>
  );
}
