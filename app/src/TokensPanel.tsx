"use client";

import { useEffect, useMemo, useRef } from "react";
import { InspectorSection } from "@/components/ui/inspector-section";
import { ColorField } from "@/components/ui/color-field";
import { NumberField } from "@/components/ui/number-field";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { readTokens, setToken } from "@/lib/deck-tokens";

// SPEC 4절의 기본값. 덱이 선언하지 않은 토큰은 이 값을 보여 준다(흐리게).
const DEFAULTS: Record<string, string> = {
  "--sk-bg": "#000", "--sk-fg": "#fff", "--sk-muted": "#9a9a9f", "--sk-faint": "#5c5c62", "--sk-line": "#2b2b30",
  "--sk-panel": "#0f0f12", "--sk-accent": "#a78bfa",
  "--sk-font": '"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif',
  "--sk-font-mono": '"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace',
  "--sk-pad-y": "150px", "--sk-pad-x": "170px", "--sk-gap": "56px",
  "--sk-fs-h1": "120px", "--sk-fs-h2": "68px", "--sk-fs-body": "36px", "--sk-fs-small": "28px",
};
const COLORS: [string, string][] = [["--sk-bg", "Background"], ["--sk-fg", "Text"], ["--sk-muted", "Muted text"], ["--sk-faint", "Faint text"], ["--sk-line", "Line"], ["--sk-panel", "Panel"], ["--sk-accent", "Accent"]];
const SPACING: [string, string, string][] = [["--sk-pad-x", "Padding X", "X"], ["--sk-pad-y", "Padding Y", "Y"], ["--sk-gap", "Gap", "G"]];
const SIZES: [string, string, string][] = [["--sk-fs-h1", "Heading 1 size", "H1"], ["--sk-fs-h2", "Heading 2 size", "H2"], ["--sk-fs-body", "Body size", "P"], ["--sk-fs-small", "Small size", "S"]];
const FONT_PRESETS: [string, string][] = [
  ["Noto Sans KR", DEFAULTS["--sk-font"]],
  ["System", 'system-ui,-apple-system,"Segoe UI",sans-serif'],
  ["Serif", 'Georgia,"Noto Serif KR",serif'],
];
const MONO_PRESETS: [string, string][] = [
  ["JetBrains Mono", DEFAULTS["--sk-font-mono"]],
  ["System mono", 'ui-monospace,"SF Mono",Menlo,monospace'],
];

interface TokensPanelProps {
  /** 덱 head를 담은 원문(편집기의 shell.prefix). */
  prefix: string;
  /** 확정된 새 prefix. 변경 한 번에 한 번만 불린다(undo 1건). 입력이 멈춘 뒤 400ms, 스크럽은 끝날 때. */
  onPrefixChange(next: string): void;
  /** 캔버스 iframe의 문서. 있으면 입력하는 동안 `:root`에 바로 반영해 미리 보여 준다. */
  canvas?: Document | null;
}

export function TokensPanel({ prefix, onPrefixChange, canvas }: TokensPanelProps) {
  const declared = useMemo(() => readTokens(prefix), [prefix]);
  const val = (n: string) => declared[n] ?? DEFAULTS[n] ?? "";
  const dim = (n: string) => !(n in declared);

  // 대기 중인 값은 prefix에 쌓아 두었다가 한 번에 내보낸다.
  const latest = useRef(prefix), pending = useRef(false), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const out = useRef(onPrefixChange); out.current = onPrefixChange;
  if (!pending.current) latest.current = prefix;
  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    out.current(latest.current);
  };
  useEffect(() => flush, []);

  const set = (name: string, value: string, now = false) => {
    let next: string;
    try { next = setToken(latest.current, name, value); } catch { return; } // 규칙에 어긋난 입력은 무시
    latest.current = next; pending.current = true;
    canvas?.documentElement.style.setProperty(name, value);
    clearTimeout(timer.current);
    if (now) flush(); else timer.current = setTimeout(flush, 400);
  };

  const custom = Object.keys(declared).filter((n) => !(n in DEFAULTS));
  const fontRow = (name: string, label: string, presets: [string, string][]) => {
    const v = val(name), known = presets.find(([, f]) => f === v)?.[0];
    return (
      <div className="flex gap-2">
        <Field aria-label={label} defaultValue={v} key={v} className="flex-1" onBlur={(e) => e.target.value !== v && set(name, e.target.value.trim(), true)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        <Select value={known ?? ""} onValueChange={(k) => set(name, presets.find(([n]) => n === k)![1], true)} size="compact">
          <SelectTrigger aria-label={`${label} presets`} className="w-28" />
          <SelectContent>{presets.map(([n], i) => <SelectItem key={n} index={i} value={n}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    );
  };
  const num = (rows: [string, string, string][]) => (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(([n, label, short]) => (
        <NumberField key={n} label={short} aria-label={label} value={val(n)} muted={dim(n)} min={0}
          onChange={(v) => set(n, v)} onScrubEnd={flush} />
      ))}
    </div>
  );

  return (
    <>
      <InspectorSection id="tokens-colors" title="Colors">
        <div className="flex flex-col gap-2">
          {COLORS.map(([n, label]) => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-16 shrink-0 truncate text-caption text-muted-foreground">{label}</span>
              <ColorField aria-label={label} value={val(n)} onChange={(v) => set(n, v)} className="flex-1" />
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection id="tokens-fonts" title="Fonts">
        {fontRow("--sk-font", "Font", FONT_PRESETS)}
        {fontRow("--sk-font-mono", "Mono font", MONO_PRESETS)}
      </InspectorSection>
      <InspectorSection id="tokens-spacing" title="Spacing">{num(SPACING)}</InspectorSection>
      <InspectorSection id="tokens-sizes" title="Text sizes">{num(SIZES)}</InspectorSection>
      {custom.length > 0 && (
        <InspectorSection id="tokens-custom" title="Deck variables">
          {custom.map((n) => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-caption text-muted-foreground" title={n}>{n}</span>
              <Field aria-label={n} defaultValue={declared[n]} key={declared[n]} className="flex-1"
                onBlur={(e) => e.target.value !== declared[n] && set(n, e.target.value.trim(), true)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
            </div>
          ))}
        </InspectorSection>
      )}
    </>
  );
}
export type { TokensPanelProps };
