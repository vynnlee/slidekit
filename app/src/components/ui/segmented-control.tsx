"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useSize } from "@/lib/size-context";
import { useShape } from "@/lib/shape-context";
import { controlDisabled, controlFocus, controlSurface } from "@/lib/control-surface";
import { Tooltip } from "@/components/ui/tooltip";

interface SegmentedOption {
  value: string;
  icon: ReactNode;
  /** 접근성 이름이자 기본 툴팁 */
  label: string;
  /** 툴팁을 label과 다르게 보이고 싶을 때(예: 단축키를 덧붙임) */
  tooltip?: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps {
  value: string;
  onChange: (v: string) => void;
  options: SegmentedOption[];
  "aria-label": string;
  /** "radio"(기본)는 하나만 고르는 radiogroup, "toggle"은 각 칸이 aria-pressed 버튼인 group. */
  mode?: "radio" | "toggle";
  /** 선택된 칸을 다시 누르면 onChange("")로 해제한다. toggle 모드에서 쓴다. */
  deselectable?: boolean;
  disabled?: boolean;
  className?: string;
}

// 칸은 모두 같은 폭이고, 선택 표시는 한 장의 표면이 칸 사이를 spring으로 옮겨 다닌다.
// 키보드: 화살표로 이동(radio는 이동과 동시에 선택), Home과 End로 처음과 끝.
function SegmentedControl({ value, onChange, options, "aria-label": ariaLabel, mode = "radio", deselectable, disabled, className }: SegmentedControlProps) {
  const size = useSize();
  const shape = useShape();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = options.length;
  const idx = options.findIndex((o) => o.value === value);
  const radio = mode === "radio";

  const onKeyDown = (e: KeyboardEvent) => {
    let next: number | null = null;
    const cur = Math.max(idx, 0);
    const step = (d: number) => {
      for (let k = 1; k <= n; k++) {
        const j = (cur + d * k + n * k) % n;
        if (!options[j].disabled) return j;
      }
      return cur;
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = step(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = step(-1);
    else if (e.key === "Home") next = options.findIndex((o) => !o.disabled);
    else if (e.key === "End") next = n - 1 - [...options].reverse().findIndex((o) => !o.disabled);
    if (next === null || next < 0 || !n) return;
    e.preventDefault();
    refs.current[next]?.focus();
    if (radio) onChange(options[next].value);
  };

  return (
    <div
      role={radio ? "radiogroup" : "group"}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "relative grid grid-flow-col auto-cols-fr min-w-0",
        controlSurface, "hover:bg-transparent",
        size.control, shape.input,
        disabled && controlDisabled,
        className
      )}
    >
      {radio && idx >= 0 && (
        <motion.div
          aria-hidden="true"
          className={cn("absolute inset-y-0 bg-hover pointer-events-none", shape.input)}
          initial={false}
          animate={{ left: `${(idx * 100) / n}%`, width: `${100 / n}%` }}
          transition={spring.moderate}
        />
      )}
      {options.map((o, i) => {
        const on = i === idx;
        const off = disabled || o.disabled;
        const press = () => onChange(!radio && deselectable && on ? "" : o.value);
        return (
          <Tooltip key={o.value} content={o.tooltip ?? o.label}>
            <button
              type="button"
              {...(radio ? { role: "radio", "aria-checked": on } : { "aria-pressed": on })}
              aria-label={o.label}
              disabled={off}
              tabIndex={radio ? (on || (idx < 0 && i === 0) ? 0 : -1) : 0}
              ref={(el) => {
                refs.current[i] = el;
              }}
              onClick={press}
              className={cn(
                "relative z-10 flex h-full items-center justify-center outline-none cursor-pointer select-none transition-colors duration-80 [&_svg]:size-3.5 disabled:cursor-not-allowed disabled:opacity-50",
                controlFocus,
                shape.input,
                !radio && on && "bg-hover",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.icon}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
export type { SegmentedControlProps, SegmentedOption };
