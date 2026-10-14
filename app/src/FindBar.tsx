import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";

// 덱 전체 찾기와 바꾸기 줄(Cmd+F). 찾는 일과 바꾸는 일은 Editor가 lib/find.ts로 하고, 이 컴포넌트는 입력과 단추만 그린다.
export type FindState = { q: string; r: string; matchCase: boolean; notes: boolean };

export function FindBar({ state, onChange, total, current, slides, onNext, onPrev, onReplace, onReplaceAll, onClose, focusTick }: {
  state: FindState;
  onChange(patch: Partial<FindState>): void;
  total: number;
  current: number; // 0부터, 일치가 없으면 -1
  slides: number; // 일치가 든 슬라이드 수
  onNext(): void; onPrev(): void; onReplace(): void; onReplaceAll(): void; onClose(): void;
  focusTick: number; // 바뀔 때마다 찾기 칸에 포커스(Cmd+F를 다시 눌렀을 때)
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusTick]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); (e.shiftKey ? onPrev : onNext)(); }
  };
  return (
    <div role="search" aria-label="Find and replace" data-testid="find-bar" className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
      <Field ref={input} aria-label="Find" placeholder="Find" value={state.q} spellCheck={false} onChange={(e) => onChange({ q: e.target.value })} onKeyDown={key} className="w-44" />
      <span data-testid="find-count" aria-live="polite" className="min-w-24 text-caption tabular-nums text-muted-foreground">
        {state.q ? (total ? `${current + 1} of ${total} in ${slides} slide${slides > 1 ? "s" : ""}` : "No results") : ""}
      </span>
      <Tooltip content="Previous (Shift+Enter)" side="bottom"><Button aria-label="Previous match" variant="ghost" size="icon-compact" disabled={!total} onClick={onPrev}><ChevronUp /></Button></Tooltip>
      <Tooltip content="Next (Enter)" side="bottom"><Button aria-label="Next match" variant="ghost" size="icon-compact" disabled={!total} onClick={onNext}><ChevronDown /></Button></Tooltip>
      <Tooltip content="Match case" side="bottom"><Button aria-label="Match case" aria-pressed={state.matchCase} variant={state.matchCase ? "secondary" : "ghost"} size="compact" onClick={() => onChange({ matchCase: !state.matchCase })}>Aa</Button></Tooltip>
      <Tooltip content="Also search speaker notes" side="bottom"><Button aria-label="Include notes" aria-pressed={state.notes} variant={state.notes ? "secondary" : "ghost"} size="compact" onClick={() => onChange({ notes: !state.notes })}>Notes</Button></Tooltip>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      <Field aria-label="Replace with" placeholder="Replace with" value={state.r} spellCheck={false} onChange={(e) => onChange({ r: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onReplace(); } }} className="w-44" />
      <Button variant="ghost" size="compact" disabled={!total} onClick={onReplace}>Replace</Button>
      <Button variant="ghost" size="compact" disabled={!total} onClick={onReplaceAll}>Replace all</Button>
      <span className="ml-auto" />
      <Tooltip content="Close (Esc)" side="bottom"><Button aria-label="Close find" variant="ghost" size="icon-compact" onClick={onClose}><X /></Button></Tooltip>
    </div>
  );
}
