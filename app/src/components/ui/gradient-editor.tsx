"use client";

import { useRef, useState } from "react";
import { Minus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { NumberField } from "@/components/ui/number-field";
import { Tooltip } from "@/components/ui/tooltip";
import { addStop, normalize, removeStop, serializeGradient, type Gradient } from "@/lib/gradient";
import { cn } from "@/lib/utils";

// 선형 그라디언트 편집기(Figma 식): 막대 위의 스톱 핸들을 끌어 위치를 바꾸고, 막대를 눌러 스톱을 더하며(최대 4개), 고른 스톱의 색과 위치, 전체 각도를 숫자로 고친다.
// 값은 언제나 표준 linear-gradient()로 내보낸다(lib/gradient.ts). 색은 ColorField라 Fluid ColorPicker와 덱 토큰 var()를 그대로 쓴다.
const CHECKER = "repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%) 0 0 / 8px 8px";

export function GradientEditor({ value, onChange, onScrub, label = "Gradient" }: {
  value: Gradient;
  onChange(g: Gradient): void;
  /** 핸들을 끄는 동안 true(한 번의 실행 취소로 묶는다) */
  onScrub?(on: boolean): void;
  label?: string;
}) {
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const s = Math.min(sel, value.stops.length - 1);
  const posAt = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)); };
  const patchStop = (i: number, patch: Partial<{ color: string; pos: number }>) => {
    const next = { ...value, stops: value.stops.map((x, k) => (k === i ? { ...x, ...patch } : x)) };
    const n = normalize(next, i);
    setSel(n.selected); onChange(n.g);
  };
  const drag = (i: number, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    setSel(i); onScrub?.(true);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let cur = i; // 끄는 중 다른 스톱을 넘으면 번호가 바뀐다
    const move = (m: PointerEvent) => {
      const stops = value.stops.map((x, k) => (k === cur ? { ...x, pos: posAt(m.clientX) } : x));
      const n = normalize({ ...value, stops }, cur);
      cur = n.selected; setSel(cur); onChange(n.g);
      value = n.g; // 다음 이동은 방금 결과에서 이어 간다
    };
    const up = () => { onScrub?.(false); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const cur = value.stops[s];
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className="relative pb-3">
        <div ref={bar} data-testid="gradient-bar" className="h-6 w-full cursor-copy overflow-hidden rounded-md border border-border"
          style={{ background: `${serializeGradient({ angle: 90, stops: value.stops })}, ${CHECKER}` }}
          onPointerDown={(e) => { if (value.stops.length >= 4) return; const a = addStop(value, posAt(e.clientX)); if (a) { setSel(a.selected); onChange(a.g); } }} />
        {value.stops.map((st, i) => (
          <button key={i} type="button" role="slider" aria-label={`Gradient stop ${i + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.pos)} aria-valuetext={`${Math.round(st.pos)}%`}
            data-selected={i === s} onPointerDown={(e) => drag(i, e)} onFocus={() => setSel(i)}
            onKeyDown={(e) => { const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0; if (d) { e.preventDefault(); patchStop(i, { pos: st.pos + d * (e.shiftKey ? 10 : 1) }); } }}
            className={cn("absolute top-[18px] size-3 -translate-x-1/2 cursor-ew-resize rounded-[3px] border-2 outline-none", i === s ? "border-focus-ring" : "border-white")}
            style={{ left: `${st.pos}%`, background: st.color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label={<RotateCw />} aria-label="Gradient angle" unit="" min={0} max={360} value={String(value.angle)} onChange={(v) => onChange({ ...value, angle: ((parseFloat(v) || 0) % 360 + 360) % 360 })} onScrubStart={() => onScrub?.(true)} onScrubEnd={() => onScrub?.(false)} />
        <NumberField label="%" aria-label="Stop position" unit="" min={0} max={100} value={String(Math.round(cur.pos * 10) / 10)} onChange={(v) => patchStop(s, { pos: parseFloat(v) || 0 })} onScrubStart={() => onScrub?.(true)} onScrubEnd={() => onScrub?.(false)} />
      </div>
      <div className="flex items-center gap-1">
        <ColorField aria-label="Gradient stop color" className="min-w-0 flex-1" value={cur.color} onChange={(v) => patchStop(s, { color: v })} />
        <Tooltip content={value.stops.length <= 2 ? "A gradient needs two stops" : "Remove stop"} side="top">
          <span className="inline-flex"><Button aria-label="Remove stop" variant="ghost" size="icon-compact" disabled={value.stops.length <= 2} onClick={() => { const g = removeStop(value, s); if (g) { setSel(Math.max(0, s - 1)); onChange(g); } }}><Minus /></Button></span>
        </Tooltip>
      </div>
    </div>
  );
}
