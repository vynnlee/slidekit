"use client";

import { forwardRef, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSize } from "@/lib/size-context";
import { useShape } from "@/lib/shape-context";
import { controlDisabled, controlError, controlFocusWithin, controlSurface } from "@/lib/control-surface";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface NumberFieldProps {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  muted?: boolean;
  mixed?: boolean;
  /** 단위 표시(예: %, px). 포커스나 호버 때만 보인다. */
  suffix?: string;
  /** 기본값과 다른 "설정됨" 상태. 라벨 모서리에 작은 점이 뜬다. */
  dirty?: boolean;
  /** 주면 dirty일 때 호버나 포커스에서 Reset 버튼이 나온다. */
  onReset?: () => void;
  /** Reset 버튼의 툴팁 문구. 요소 속성은 "Reset", 덱 토큰은 "Reset to default"처럼 쓴다. */
  resetLabel?: string;
  disabled?: boolean;
  /** 비활성일 때 호버 툴팁으로 보여 줄 이유 */
  disabledReason?: string;
  error?: boolean;
  "aria-label": string;
  className?: string;
}

const NUM = "(-?\\d*\\.?\\d+)";
const UNITS = "(px|%|em|rem|vw|vh)";
const reValue = new RegExp(`^${NUM}\\s*${UNITS}?$`, "i");
const reFormula = new RegExp(`^([+\\-*/])\\s*${NUM}$`);

function parse(v: string): { n: number; unit: string } | null {
  const m = reValue.exec(v.trim());
  return m ? { n: parseFloat(m[1]), unit: (m[2] ?? "").toLowerCase() } : null;
}

// 표시용: px와 단위 없음은 숫자만, 나머지는 단위를 붙인다
function display(v: string): string {
  const p = parse(v);
  if (!p) return v.trim();
  return `${Math.round(p.n * 100) / 100}${p.unit === "px" ? "" : p.unit}`;
}

const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  (
    {
      label, value, onChange, onScrubStart, onScrubEnd, step = 1, min, max,
      unit = "px", placeholder, muted, mixed, suffix, dirty, onReset, resetLabel = "Reset", disabled, disabledReason, error, "aria-label": ariaLabel, className,
    },
    ref
  ) => {
    const size = useSize();
    const shape = useShape();
    const [draft, setDraftState] = useState<string | null>(null);
    const draftRef = useRef<string | null>(null);
    const setDraft = (v: string | null) => {
      draftRef.current = v;
      setDraftState(v);
    };
    const labelRef = useRef<HTMLSpanElement>(null);
    const scrub = useRef<{ x: number; acc: number; n: number; unit: string; last: string } | null>(null);

    const cur = parse(value);
    const outUnit = (u?: string) => (unit === "" ? "" : u || unit);

    const format = (n: number, u: string) => {
      let r = n;
      if (min !== undefined) r = Math.max(min, r);
      if (max !== undefined) r = Math.min(max, r);
      return `${Math.round(r * 100) / 100}${u}`;
    };

    const commit = () => {
      const t = draftRef.current;
      setDraft(null);
      if (t === null) return;
      const s = t.trim();
      if (s === display(value)) return;
      if (s === "") return onChange("");
      if (s.toLowerCase() === "auto") return onChange("auto");
      const f = reFormula.exec(s);
      if (f) {
        const b = cur?.n ?? 0;
        const x = parseFloat(f[2]);
        if (f[1] === "/" && x === 0) return;
        const r = f[1] === "+" ? b + x : f[1] === "-" ? b - x : f[1] === "*" ? b * x : b / x;
        return onChange(format(r, outUnit(cur?.unit)));
      }
      const p = parse(s);
      if (p) onChange(format(p.n, p.unit ? outUnit(p.unit) : outUnit(cur?.unit)));
    };

    const nudge = (dir: 1 | -1, e: KeyboardEvent) => {
      e.preventDefault();
      const d = step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * dir;
      const src = draftRef.current !== null ? parse(draftRef.current) ?? cur : cur;
      const out = format((src?.n ?? 0) + d, outUnit(src?.unit));
      onChange(out);
      setDraft(display(out));
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowUp") nudge(1, e);
      else if (e.key === "ArrowDown") nudge(-1, e);
      else if (e.key === "Enter") {
        commit();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        setDraft(null);
        e.currentTarget.blur();
      }
    };

    // 스크럽 중에는 포인터가 라벨을 벗어나도 커서와 선택이 바뀌지 않게 문서에 잠근다.
    const lock = (on: boolean) => {
      document.documentElement.style.cursor = on ? "ew-resize" : "";
      document.documentElement.style.userSelect = on ? "none" : "";
    };

    const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
      if (e.button !== 0 || disabled) return;
      lock(true);
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      scrub.current = { x: e.clientX, acc: 0, n: step >= 1 ? Math.round(cur?.n ?? 0) : cur?.n ?? 0, unit: outUnit(cur?.unit), last: value };
      onScrubStart?.();
    };

    const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
      const s = scrub.current;
      if (!s) return;
      const r = labelRef.current?.getBoundingClientRect();
      const v = r && e.clientY < r.top - 16 ? 2 : r && e.clientY > r.bottom + 16 ? 0.5 : 1;
      s.acc += (e.clientX - s.x) * step * (e.altKey ? 0.1 : e.shiftKey ? 10 : 1) * v;
      s.x = e.clientX;
      const out = format(s.n + s.acc, s.unit);
      if (out !== s.last) {
        s.last = out;
        onChange(out);
      }
    };

    const endScrub = () => {
      if (!scrub.current) return;
      scrub.current = null;
      lock(false);
      onScrubEnd?.();
    };

    const field = (
      <div
        className={cn(
          "group/nf relative flex items-center min-w-0",
          controlSurface,
          controlFocusWithin,
          size.control,
          shape.input,
          error && controlError,
          disabled && cn(controlDisabled, "hover:bg-transparent"),
          className
        )}
      >
        {dirty && <span aria-hidden="true" data-dirty="" className="pointer-events-none absolute left-0.5 top-0.5 size-1.5 rounded-full bg-focus-ring" />}
        <span
          ref={labelRef}
          aria-hidden="true"
          className={cn(
            "flex h-full shrink-0 items-center justify-center select-none touch-none text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5",
            disabled ? "cursor-not-allowed" : "cursor-ew-resize",
            size.text,
            size.itemPx
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          {label}
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          aria-invalid={error || undefined}
          disabled={disabled}
          className={cn(
            "h-full w-full min-w-0 flex-1 bg-transparent outline-none tabular-nums placeholder:text-muted-foreground disabled:cursor-not-allowed",
            size.field,
            size.itemPx,
            "pl-0",
            muted && draft === null && "text-muted-foreground"
          )}
          placeholder={mixed ? "Mixed" : placeholder}
          value={draft ?? (mixed ? "" : display(value))}
          onFocus={(e) => {
            setDraft(mixed ? "" : display(value));
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {suffix && !(dirty && onReset) && (
          <span aria-hidden="true" className={cn("shrink-0 select-none pr-2 text-muted-foreground opacity-0 transition-opacity group-focus-within/nf:opacity-100 group-hover/nf:opacity-100", size.type.caption)}>{suffix}</span>
        )}
        {dirty && onReset && !disabled && (
          <Tooltip content={resetLabel}>
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label={`${resetLabel} ${ariaLabel}`}
              onClick={onReset}
              className="mr-0.5 size-5 shrink-0 p-0 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/nf:opacity-100 group-hover/nf:opacity-100 [&_svg]:size-3"
            >
              <RotateCcw />
            </Button>
          </Tooltip>
        )}
      </div>
    );
    // 비활성 이유는 호버 툴팁으로 알린다(래퍼는 포인터를 받아야 하므로 pointer-events를 끄지 않는다).
    return disabled && disabledReason ? <Tooltip content={disabledReason}>{field}</Tooltip> : field;
  }
);
NumberField.displayName = "NumberField";

export { NumberField };
export type { NumberFieldProps };
