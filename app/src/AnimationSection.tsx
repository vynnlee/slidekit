import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_MS, QUICK, awayOf, outAwayOf, quickOf, type StepSpec } from "@/lib/animation-model";
import { planEdit, readSlide } from "@/lib/animation-dom";
import { addBar, aboveOf, moveToClick, barOf, removeBar, setBarTime, setEffect, timelineOf, type Bar, type Res } from "@/lib/timeline";

// 인스펙터의 Animation 섹션(spec/ANIMATION.md v2 4.2, DESIGN.md 1.4): + In, + Out 단추, 이미 있으면 Effect, Delay, Duration, Click 칸과 With previous / After previous 단추(숫자를 채울 뿐 저장하지 않는다), 삭제.
// 숫자(초)는 여기서만 입력한다. 타임라인의 막대를 끌면 같은 값이 바뀐다.
type Props = {
  els: HTMLElement[];
  slide: HTMLElement | null;
  onAnim(edits: [HTMLElement, StepSpec][], key?: string): void;
};

const SEL = "h-6 min-w-0 rounded-md bg-hover px-1 text-caption text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
const secs = (ms: number) => String(Math.round(ms) / 1000);

export function AnimationSection({ els, slide, onAnim }: Props) {
  const el = els[0];
  if (!el || !slide || !slide.contains(el)) return null;
  if (els.length > 1) return <p className="text-caption text-muted-foreground">Select one element to edit its animation.</p>;
  const rows = readSlide(slide, el), specs = rows.map((r) => r.spec), tl = timelineOf(specs), i = rows.findIndex((r) => r.el === el), N = tl.clicks.length;
  const inn = barOf(tl, i, "in"), out = barOf(tl, i, "out");
  const run = (res: Res, key?: string) => { const e = planEdit(rows, res); if (e) onAnim(e, key); };
  const time = (b: Bar, f: "start" | "len", text: string) => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || n < 0 || n * 1000 > MAX_MS) return false;
    run(setBarTime(specs, b, f === "start" ? { start: n * 1000 } : { len: n * 1000 }), `anim:${b.id}:${f}`);
    return true;
  };
  const block = (b: Bar) => {
    const spec = specs[b.el], eff = quickOf(b.kind === "in" ? awayOf(spec) : outAwayOf(spec)), above = aboveOf(tl.clicks[b.click - 1], b), label = b.kind === "in" ? "In" : "Out";
    const num = (f: "start" | "len", name: string, tip: string) => (
      <label className="flex items-center justify-between gap-2" title={tip}>
        <span className="text-micro text-muted-foreground">{name}</span>
        <input key={`${b.id}-${f}-${f === "start" ? b.start : b.len}`} type="number" inputMode="decimal" step={0.05} min={0} max={MAX_MS / 1000} defaultValue={secs(f === "start" ? b.start : b.len)} aria-label={`${name} of ${label} (seconds)`}
          className={`${SEL} w-20 text-right tabular-nums [appearance:textfield]`}
          onBlur={(e) => { if (!time(b, f, e.target.value)) { e.target.value = secs(f === "start" ? b.start : b.len); } }}
          onKeyDown={(e) => { e.nativeEvent.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </label>
    );
    return (
      <div key={b.kind} role="group" aria-label={`${label} animation`} className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-micro font-medium text-foreground" title={b.kind === "in" ? "The element enters (appears) at this click." : "The element leaves (disappears) at this click. It must come after its In."}>{label}</span>
          <Button aria-label={`Remove ${label} animation`} variant="ghost" size="icon-compact" onClick={() => run(removeBar(specs, b))}><Trash2 /></Button>
        </div>
        <label className="flex items-center justify-between gap-2" title="How the element moves in or out.">
          <span className="text-micro text-muted-foreground">Effect</span>
          <select aria-label={`Effect of ${label}`} value={eff ?? "custom"} className={`${SEL} w-20`} onChange={(e) => run(setEffect(specs, b, e.target.value))}>
            {QUICK.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            {eff === null && <option value="custom" disabled>Custom</option>}
          </select>
        </label>
        {num("start", "Delay", "Seconds to wait after the click before this starts.")}
        {num("len", "Duration", "How long this takes.")}
        <label className="flex items-center justify-between gap-2" title="Which click plays this. New click makes a new one.">
          <span className="text-micro text-muted-foreground">Click</span>
          <select aria-label={`Click of ${label}`} value={b.click} className={`${SEL} w-24`} onChange={(e) => run(e.target.value === "new" ? moveToClick(specs, b, { gap: N }) : moveToClick(specs, b, { click: Number(e.target.value) }))}>
            {tl.clicks.map((c) => <option key={c.click} value={c.click}>{`Click ${c.click}`}</option>)}
            <option value="new">New click</option>
          </select>
        </label>
        <div className="flex gap-1">
          <Button variant="secondary" size="compact" className="min-w-0 flex-1" disabled={!above} title="Start at the same time as the bar above (copies its Delay)." onClick={() => above && run(setBarTime(specs, b, { start: above.start }))}>With previous</Button>
          <Button variant="secondary" size="compact" className="min-w-0 flex-1" disabled={!above} title="Start when the bar above ends (its Delay + Duration)." onClick={() => above && run(setBarTime(specs, b, { start: above.end }))}>After previous</Button>
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {!inn && <Button variant="secondary" size="compact" className="flex-1" leadingIcon={Plus} title="The element enters (appears) at this click." onClick={() => run(addBar(specs, i, "in"))}>In</Button>}
        {!out && <Button variant="secondary" size="compact" className="flex-1" leadingIcon={Plus} title="The element leaves (disappears) at this click." onClick={() => run(addBar(specs, i, "out"))}>Out</Button>}
      </div>
      {[inn, out].map((b) => b && block(b))}
    </div>
  );
}
