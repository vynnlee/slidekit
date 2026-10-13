"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InspectorSection } from "@/components/ui/inspector-section";
import { ColorField } from "@/components/ui/color-field";
import { NumberField } from "@/components/ui/number-field";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { readTokens, setToken } from "@/lib/deck-tokens";
import { deckFonts, familyNames } from "@/lib/deck-fonts";

// SPEC 4절의 기본값. 덱이 선언하지 않은 토큰은 이 값을 보여 준다(흐리게).
const DEFAULTS: Record<string, string> = {
  "--sk-bg": "#000", "--sk-fg": "#fff", "--sk-muted": "#9a9a9f", "--sk-faint": "#5c5c62", "--sk-line": "#2b2b30",
  "--sk-panel": "#0f0f12", "--sk-accent": "#a78bfa",
  "--sk-font": '"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif',
  "--sk-font-mono": '"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace',
  "--sk-pad-y": "150px", "--sk-pad-x": "170px", "--sk-gap": "56px",
  "--sk-fs-h1": "120px", "--sk-fs-h2": "68px", "--sk-fs-body": "36px", "--sk-fs-small": "28px",
};
const COLORS: [string, string][] = [["--sk-bg", "Page background"], ["--sk-fg", "Text"], ["--sk-muted", "Muted text"], ["--sk-faint", "Faint text"], ["--sk-line", "Line"], ["--sk-panel", "Panel"], ["--sk-accent", "Accent"]];
const SPACING: [string, string, string][] = [["--sk-pad-x", "Padding X", "Pad X"], ["--sk-pad-y", "Padding Y", "Pad Y"], ["--sk-gap", "Gap", "Gap"]];
const SIZES: [string, string, string][] = [["--sk-fs-h1", "Heading 1 size", "H1"], ["--sk-fs-h2", "Heading 2 size", "H2"], ["--sk-fs-body", "Body size", "Body"], ["--sk-fs-small", "Small size", "Small"]];
const FONT_PRESETS: [string, string][] = [
  ["Noto Sans KR", DEFAULTS["--sk-font"]],
  ["System", 'system-ui,-apple-system,"Segoe UI",sans-serif'],
  ["Serif", 'Georgia,"Noto Serif KR",serif'],
];
const MONO_PRESETS: [string, string][] = [
  ["JetBrains Mono", DEFAULTS["--sk-font-mono"]],
  ["System mono", 'ui-monospace,"SF Mono",Menlo,monospace'],
];

// 기본값과 같은지 비교할 때 쓰는 정규화: 공백과 대소문자를 없애고 #rgb를 #rrggbb로 펼친다.
const norm = (v: string) => {
  const t = v.toLowerCase().replace(/\s+/g, "");
  return /^#[0-9a-f]{3}$/.test(t) ? "#" + [...t.slice(1)].map((c) => c + c).join("") : t;
};
const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\))$/i.test(v.trim());

// "Deck variables"는 처음 한 번만 접어 둔다. InspectorSection은 저장된 접힘 목록이 있으면 defaultOpen을 무시하므로 목록에 직접 넣는다.
const COLLAPSE_KEY = "slidekit.inspector.collapsed", SEED_KEY = "slidekit.inspector.seeded";
function seedCollapsed(id: string) {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(SEED_KEY) ?? "[]");
    if (seen.includes(id)) return;
    const list: string[] = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]");
    if (!list.includes(id)) list.push(id);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list));
    localStorage.setItem(SEED_KEY, JSON.stringify([...seen, id]));
  } catch { /* 저장소를 못 쓰면 기본 펼침 */ }
}

/** 기본값과 다른 토큰에만 보이는 작은 점. 누르면 기본값으로 되돌린다. */
function ResetDot({ changed, label, onReset }: { changed: boolean; label: string; onReset(): void }) {
  if (!changed) return null;
  return (
    <Tooltip content="Reset to default" side="top">
      <button type="button" aria-label={`Reset ${label} to default`} onClick={onReset}
        className="absolute right-0 top-1/2 flex h-4 w-3 -translate-y-1/2 cursor-pointer items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
        <span className="h-1.5 w-1.5 rounded-full bg-focus-ring" />
      </button>
    </Tooltip>
  );
}

interface TokensPanelProps {
  /** 덱 head를 담은 원문(편집기의 shell.prefix). */
  prefix: string;
  /** 확정된 새 prefix. 변경 한 번에 한 번만 불린다(undo 1건). 입력이 멈춘 뒤 400ms, 스크럽은 끝날 때. */
  onPrefixChange(next: string): void;
  /** 캔버스 iframe의 문서. 있으면 입력하는 동안 `:root`에 바로 반영해 미리 보여 준다. */
  canvas?: Document | null;
}

function FontRow({ label, value, cur, opts, onSet }: { label: string; value: string; cur: string; opts: [string, string][]; onSet(v: string): void }) {
  const [adv, setAdv] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Select value={cur} onValueChange={(n) => onSet(opts.find(([k]) => k === n)![1])} size="compact">
            <SelectTrigger aria-label={label} />
            <SelectContent>{opts.map(([n], i) => <SelectItem key={n} index={i} value={n}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="compact" aria-pressed={adv} aria-label={`Edit ${label} CSS`} onClick={() => setAdv((x) => !x)}>CSS</Button>
      </div>
      {adv && (
        <Field aria-label={`${label} CSS`} defaultValue={value} key={value}
          onBlur={(e) => e.target.value !== value && onSet(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      )}
    </div>
  );
}

export function TokensPanel({ prefix, onPrefixChange, canvas }: TokensPanelProps) {
  useState(() => seedCollapsed("tokens-custom"));
  const declared = useMemo(() => readTokens(prefix), [prefix]);
  const val = (n: string) => declared[n] ?? DEFAULTS[n] ?? "";
  const dim = (n: string) => !(n in declared);
  const changed = (n: string) => n in declared && n in DEFAULTS && norm(declared[n]) !== norm(DEFAULTS[n]);

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
  // 글꼴은 Select 하나로 고른다(덱이 선언한 글꼴이 위, 그다음 프리셋). CSS 문자열은 접힌 고급 입력에서 고친다.
  const declaredFonts = useMemo(() => deckFonts(prefix), [prefix]);
  const fontRow = (name: string, label: string, presets: [string, string][], generic: string) => {
    const v = val(name), cur = familyNames(v)[0] ?? "";
    const opts: [string, string][] = [
      ...declaredFonts.map((n) => [n, presets.find(([p]) => p === n)?.[1] ?? `"${n}",${generic}`] as [string, string]),
      ...presets.filter(([p]) => !declaredFonts.includes(p)),
    ];
    if (cur && !opts.some(([n]) => n === cur)) opts.unshift([cur, v]);
    return <FontRow key={name} label={label} value={v} cur={cur} opts={opts} onSet={(x) => set(name, x, true)} />;
  };
  const num = (rows: [string, string, string][]) => (
    <div className="grid grid-cols-2 gap-x-2 gap-y-2">
      {rows.map(([n, label, short]) => (
        <div key={n} className="relative min-w-0">
          <Tooltip content={n} side="top">
            <div className="min-w-0">
              <NumberField label={short} aria-label={label} value={val(n)} muted={dim(n)} min={0}
                onChange={(v) => set(n, v)} onScrubEnd={flush} />
            </div>
          </Tooltip>
          <ResetDot changed={changed(n)} label={label} onReset={() => set(n, DEFAULTS[n], true)} />
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="mt-2 flex items-center gap-2 border-t border-border/60 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Deck styles</div>
      <InspectorSection id="tokens-colors" title="Colors">
        <div className="flex flex-col gap-1">
          {COLORS.map(([n, label]) => (
            <div key={n} className="flex items-center gap-2">
              <div className="relative w-16 shrink-0">
                <Tooltip content={n} side="top"><span className="block truncate pr-3 text-caption text-muted-foreground">{label}</span></Tooltip>
                <ResetDot changed={changed(n)} label={label} onReset={() => set(n, DEFAULTS[n], true)} />
              </div>
              <ColorField aria-label={label} value={val(n)} onChange={(v) => set(n, v)} className="min-w-0 flex-1" />
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection id="tokens-fonts" title="Fonts">
        {fontRow("--sk-font", "Font", FONT_PRESETS, "system-ui,sans-serif")}
        {fontRow("--sk-font-mono", "Mono font", MONO_PRESETS, "ui-monospace,monospace")}
      </InspectorSection>
      <InspectorSection id="tokens-spacing" title="Spacing">{num(SPACING)}</InspectorSection>
      <InspectorSection id="tokens-sizes" title="Text sizes">{num(SIZES)}</InspectorSection>
      {custom.length > 0 && (
        <InspectorSection id="tokens-custom" defaultOpen={false}
          title={<span className="flex items-center gap-1.5">Deck variables<span className="rounded-full bg-hover px-1.5 text-[10px] font-normal tabular-nums text-muted-foreground">{custom.length}</span></span>}>
          {custom.map((n) => {
            const v = declared[n], ref = /^var\(/i.test(v.trim());
            return (
              <div key={n} className="flex items-center gap-2">
                <Tooltip content={n} side="top"><span className="w-20 shrink-0 truncate text-caption text-muted-foreground">{n}</span></Tooltip>
                {isColor(v)
                  ? <ColorField aria-label={n} value={v} onChange={(x) => set(n, x)} className="min-w-0 flex-1" />
                  : <Field aria-label={n} defaultValue={v} key={v} className={ref ? "flex-1 text-muted-foreground" : "flex-1"} title={ref ? `Reference: ${v}. Type a value to override it` : undefined}
                      onBlur={(e) => e.target.value !== v && set(n, e.target.value.trim(), true)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />}
              </div>
            );
          })}
        </InspectorSection>
      )}
    </>
  );
}
export type { TokensPanelProps };
