"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { ColorPickerPopover } from "@/components/ui/color-picker";

interface Rgba { r: number; g: number; b: number; a: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// hex(3, 4, 6, 8자리)와 rgb()/rgba()를 직접 파싱한다. 알 수 없으면 null.
function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const h = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (h) {
    let x = h[1];
    if (x.length <= 4) x = x.split("").map((c) => c + c).join("");
    return {
      r: parseInt(x.slice(0, 2), 16),
      g: parseInt(x.slice(2, 4), 16),
      b: parseInt(x.slice(4, 6), 16),
      a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  const ch = (v: string) => clamp(v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v), 0, 255);
  const al = m[4] === undefined ? 1 : clamp(m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]), 0, 1);
  return { r: Math.round(ch(m[1])), g: Math.round(ch(m[2])), b: Math.round(ch(m[3])), a: al };
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const toHex = ({ r, g, b }: Rgba) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
// 알파 100%면 #rrggbb, 아니면 rgb(r g b / a)
const serialize = (c: Rgba) =>
  c.a >= 1 ? toHex(c) : `rgb(${c.r} ${c.g} ${c.b} / ${Math.round(c.a * 100) / 100})`;

interface ColorFieldProps {
  /** 임의 CSS 색 문자열. 빈 문자열은 "None". */
  value: string;
  onChange: (v: string) => void;
  "aria-label": string;
  /** true면 hex 칸을 비워 확정할 때 빈 문자열로 지운다. */
  allowNone?: boolean;
  className?: string;
}

export function ColorField({ value, onChange, "aria-label": ariaLabel, allowNone, className }: ColorFieldProps) {
  const color = parseColor(value);
  const base: Rgba = color ?? { r: 0, g: 0, b: 0, a: 1 };
  const hex = color ? toHex(color).toUpperCase() : "";
  const alphaPct = String(Math.round(base.a * 100));

  // null이면 입력 중이 아니므로 value에서 파생한 값을 보여 준다.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [alphaDraft, setAlphaDraft] = useState<string | null>(null);

  const commitHex = () => {
    const draft = hexDraft?.trim();
    setHexDraft(null);
    if (draft === undefined) return;
    if (draft === "" || draft === "None") {
      if (allowNone) onChange("");
      return;
    }
    const withHash = draft.startsWith("#") ? draft : `#${draft}`;
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(withHash)) return; // 잘못된 입력은 복원
    const p = parseColor(withHash)!;
    onChange(serialize({ ...p, a: color ? base.a : 1 }));
  };

  const commitAlpha = () => {
    const draft = alphaDraft?.trim();
    setAlphaDraft(null);
    if (draft === undefined) return;
    const n = parseFloat(draft);
    if (draft === "" || Number.isNaN(n)) return;
    onChange(serialize({ ...base, a: clamp(n, 0, 100) / 100 }));
  };

  const enterToBlur = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") {
      setHexDraft(null);
      setAlphaDraft(null);
      e.currentTarget.blur();
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ColorPickerPopover
        value={base.a < 1 ? `${toHex(base)}${hex2(Math.round(base.a * 255))}` : toHex(base)}
        onValueChange={(_, c) => onChange(serialize({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: c.a }))}
        triggerShowValue={false}
        format="hex"
        size="compact"
      />
      <Field
        aria-label={`${ariaLabel} hex`}
        placeholder="None"
        spellCheck={false}
        value={hexDraft ?? hex}
        onChange={(e) => setHexDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={enterToBlur}
        className={cn("flex-1 uppercase placeholder:normal-case")}
      />
      <Field
        aria-label={`${ariaLabel} opacity percent`}
        inputMode="numeric"
        value={alphaDraft ?? alphaPct}
        onChange={(e) => setAlphaDraft(e.target.value)}
        onBlur={commitAlpha}
        onKeyDown={enterToBlur}
        className={cn("w-14 shrink-0 text-right")}
      />
    </div>
  );
}
