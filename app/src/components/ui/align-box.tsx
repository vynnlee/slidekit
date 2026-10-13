"use client";

import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";

const VALUES = ["flex-start", "center", "flex-end"] as const;
const ROW_NAMES = ["Top", "Center", "Bottom"] as const;
const COL_NAMES = ["left", "center", "right"] as const;

interface AlignBoxProps {
  direction: "row" | "column";
  justify: string;
  align: string;
  onChange: (justify: string, align: string) => void;
}

export function AlignBox({ direction, justify, align, onChange }: AlignBoxProps) {
  const shape = useShape();
  // 화면의 가로 축(x)과 세로 축(y)에 어느 CSS 속성이 대응하는지는 direction이 정한다.
  const isRow = direction === "row";
  const xVal = isRow ? justify : align;
  const yVal = isRow ? align : justify;
  const xi = VALUES.indexOf(xVal as (typeof VALUES)[number]);
  const yi = VALUES.indexOf(yVal as (typeof VALUES)[number]);

  return (
    <div role="group" aria-label="Alignment" className={cn("grid size-14 grid-cols-3 grid-rows-3 bg-hover p-0.5", shape.bg)}>
      {ROW_NAMES.flatMap((rowName, r) =>
        COL_NAMES.map((colName, c) => {
          const selected = r === yi && c === xi;
          const name = r === 1 && c === 1 ? "Center" : `${rowName} ${colName}`;
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              aria-label={name}
              aria-pressed={selected}
              onClick={() => {
                const x = VALUES[c], y = VALUES[r];
                if (isRow) onChange(x, y); else onChange(y, x);
              }}
              className={cn(
                "flex cursor-pointer items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                shape.item
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "rounded-full transition-colors duration-80",
                  selected ? "size-1.5 bg-foreground" : "size-1 bg-muted-foreground"
                )}
              />
            </button>
          );
        })
      )}
    </div>
  );
}
