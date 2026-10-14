"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { controlFocus } from "@/lib/control-surface";
import { useDeckHtml } from "@/lib/deck-colors-context";
import { pushRecentColor, resolveVar } from "@/lib/deck-colors";
import { readTokens } from "@/lib/deck-tokens";
import { ColorSections } from "@/components/ui/color-sections";
// 색 선택기(@base-ui 포함 약 140KB)는 처음 열 때만 불러온다.
const ColorPickerPopover = lazy(() => import("@/components/ui/color-picker").then((m) => ({ default: m.ColorPickerPopover })));

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
  /** 글자 색 칸이면 비교할 슬라이드 배경 색. 있으면 선택기 아래에 대비 칩이 보인다. */
  contrastBg?: string;
  /** false면 덱 토큰을 var()로 연결하지 않는다(토큰 편집 칸). 기본은 연결한다. */
  tokenLinks?: boolean;
  /** true면 hex와 투명도 칸 없이 스와치만 보인다(툴바용). */
  swatchOnly?: boolean;
}

export function ColorField({ value, onChange: onChangeRaw, "aria-label": ariaLabel, allowNone, className, contrastBg, tokenLinks = true, swatchOnly }: ColorFieldProps) {
  const deckHtml = useDeckHtml();
  const linked = /^var\(/i.test(value.trim()); // 토큰에 연결된 값(var(--sk-accent))
  const resolved = linked && deckHtml ? resolveVar(value.trim(), readTokens(deckHtml)) : linked ? null : value;
  // 최근 색에는 확정한 값만 넣는다(선택기를 끄는 동안의 중간 값은 닫을 때 마지막 것 하나만).
  const [lastPicked, setLastPicked] = useState<string | null>(null);
  const onChange = (v: string) => { if (parseColor(v)) pushRecentColor(v); onChangeRaw(v); };
  const color = parseColor(resolved ?? "");
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

  // 선택기를 불러오기 전에 보이는 스와치. 누르면 선택기를 불러와 바로 연다.
  const [picker, setPicker] = useState(false);
  // 선택기 팝업 안에 섹션을 포털로 끼운다(팝업 안이라 바깥 클릭으로 닫히지 않는다).
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!picker) { setPanel(null); return; }
    const t = setInterval(() => { const el = document.querySelector<HTMLElement>('[aria-label="Color picker"]'); if (el) { setPanel(el); clearInterval(t); } }, 30);
    return () => clearInterval(t);
  }, [picker]);
  const swatch = (
    <button type="button" aria-label={`${ariaLabel} swatch`} onClick={() => setPicker(true)}
      className={cn("h-7 w-7 shrink-0 cursor-default rounded-md border border-border outline-none", controlFocus)}
      style={{ background: color ? serialize(color) : "transparent" }}>
      {linked && <Link2 aria-hidden="true" data-testid="token-link" className="m-auto size-3 rounded-full bg-black/50 p-px text-white" />}
    </button>
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="relative inline-flex shrink-0">
      {picker ? (
        <Suspense fallback={swatch}>
          <ColorPickerPopover
            value={base.a < 1 ? `${toHex(base)}${hex2(Math.round(base.a * 255))}` : toHex(base)}
            onValueChange={(_, c) => { const v = serialize({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: c.a }); setLastPicked(v); onChangeRaw(v); }}
            onOpenChange={(o) => { if (!o && lastPicked) { pushRecentColor(lastPicked); setLastPicked(null); } }}
            triggerAriaLabel={`${ariaLabel} swatch`}
            triggerShowValue={false}
            format="hex"
            size="compact"
            defaultOpen
          />
        </Suspense>
      ) : swatch}
      {picker && linked && <Link2 aria-hidden="true" data-testid="token-link" className="pointer-events-none absolute inset-0 m-auto size-3 rounded-full bg-black/50 p-px text-white" />}
      </span>
      {panel && createPortal(
        <ColorSections html={deckHtml} value={value} resolved={color ? serialize(color) : null} contrastBg={contrastBg} tokenLinks={tokenLinks} onPick={onChange} />,
        panel,
      )}
      {!swatchOnly && <Field
        aria-label={`${ariaLabel} hex`}
        placeholder="None"
        spellCheck={false}
        value={hexDraft ?? hex}
        onChange={(e) => setHexDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={enterToBlur}
        className={cn("min-w-20 flex-1 uppercase placeholder:normal-case")}
      />}
      {!swatchOnly && <Field
        aria-label={`${ariaLabel} opacity percent`}
        inputMode="numeric"
        value={alphaDraft ?? alphaPct}
        onChange={(e) => setAlphaDraft(e.target.value)}
        onBlur={commitAlpha}
        onKeyDown={enterToBlur}
        className={cn("w-10 shrink-0 px-1.5 text-right")}
      />}
    </div>
  );
}
