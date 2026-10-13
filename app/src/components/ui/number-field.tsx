"use client";

import { forwardRef, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSize } from "@/lib/size-context";
import { useShape } from "@/lib/shape-context";

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
      unit = "px", placeholder, muted, mixed, "aria-label": ariaLabel, className,
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

    const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
      if (e.button !== 0) return;
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
      onScrubEnd?.();
    };

    return (
      <div
        className={cn(
          "flex items-center min-w-0 bg-hover text-foreground focus-within:ring-2 focus-within:ring-focus-ring",
          size.control,
          shape.input,
          className
        )}
      >
        <span
          ref={labelRef}
          aria-hidden="true"
          className={cn(
            "flex h-full shrink-0 items-center justify-center select-none touch-none cursor-ew-resize text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5",
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
          className={cn(
            "h-full w-full min-w-0 flex-1 bg-transparent outline-none tabular-nums placeholder:text-muted-foreground",
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
      </div>
    );
  }
);
NumberField.displayName = "NumberField";

export { NumberField };
export type { NumberFieldProps };
