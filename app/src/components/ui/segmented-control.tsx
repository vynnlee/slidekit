"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useSize } from "@/lib/size-context";
import { useShape } from "@/lib/shape-context";
import { Tooltip } from "@/components/ui/tooltip";

interface SegmentedOption {
  value: string;
  icon: ReactNode;
  label: string;
}

interface SegmentedControlProps {
  value: string;
  onChange: (v: string) => void;
  options: SegmentedOption[];
  "aria-label": string;
  className?: string;
}

function SegmentedControl({ value, onChange, options, "aria-label": ariaLabel, className }: SegmentedControlProps) {
  const size = useSize();
  const shape = useShape();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = options.length;
  const idx = options.findIndex((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir || !n) return;
    e.preventDefault();
    const next = (Math.max(idx, 0) + dir + n) % n;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("relative grid grid-flow-col auto-cols-fr min-w-0", size.control, className)}
    >
      {idx >= 0 && (
        <motion.div
          aria-hidden="true"
          className={cn("absolute inset-y-0 bg-hover pointer-events-none", shape.bg)}
          initial={false}
          animate={{ left: `${(idx * 100) / n}%`, width: `${100 / n}%` }}
          transition={spring.moderate}
        />
      )}
      {options.map((o, i) => {
        const on = i === idx;
        return (
          <Tooltip key={o.value} content={o.label}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
              ref={(el) => {
                refs.current[i] = el;
              }}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative z-10 flex h-full items-center justify-center outline-none cursor-pointer select-none transition-colors duration-80 [&_svg]:h-3.5 [&_svg]:w-3.5",
                "focus-visible:ring-2 focus-visible:ring-focus-ring",
                shape.bg,
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
