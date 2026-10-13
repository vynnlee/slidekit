"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { NumberField } from "@/components/ui/number-field";

type Side = "top" | "right" | "bottom" | "left";

interface SidesFieldProps {
  /** 호출 측이 쓰는 속성 아이콘. 라벨은 한 글자라 이 컴포넌트는 그리지 않는다. */
  icon?: ReactNode;
  /** aria-label 접두로 쓰는 속성 이름(예: "Padding"). */
  label: string;
  values: Record<Side, string>;
  /** 어느 변들을 어떤 값으로 바꿀지. 변의 의미(corner 등)는 호출 측이 해석한다. */
  onChange: (sides: Side[], v: string) => void;
  unit?: string;
}

export function SidesField({ label, values, onChange, unit }: SidesFieldProps) {
  const [expanded, setExpanded] = useState(false);

  const field = (letter: string, name: string, sides: Side[], value: string, mixed = false) => (
    <NumberField
      key={letter}
      label={letter}
      aria-label={`${label} ${name}`}
      value={value}
      mixed={mixed}
      unit={unit}
      min={0}
      onChange={(v) => onChange(sides, v)}
    />
  );

  const hSame = values.left === values.right;
  const vSame = values.top === values.bottom;

  const toggle = (
    <Tooltip content={expanded ? "Combine sides" : "Show each side"}>
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={`${label} ${expanded ? "combine sides" : "show each side"}`}
        aria-pressed={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </Button>
    </Tooltip>
  );

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
      {expanded ? (
        <>
          {field("T", "top", ["top"], values.top)}
          {field("R", "right", ["right"], values.right)}
          {toggle}
          {field("B", "bottom", ["bottom"], values.bottom)}
          {field("L", "left", ["left"], values.left)}
        </>
      ) : (
        <>
          {field("H", "horizontal", ["left", "right"], hSame ? values.left : "", !hSame)}
          {field("V", "vertical", ["top", "bottom"], vSame ? values.top : "", !vSame)}
          {toggle}
        </>
      )}
    </div>
  );
}
