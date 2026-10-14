"use client";

import { Link2 } from "lucide-react";
import { ColorSwatch } from "@/components/ui/color-picker";
import { contrastRatio, colorsInDeck, deckTokenColors, readRecentColors, wcagLevel } from "@/lib/deck-colors";
import { cn } from "@/lib/utils";

// 색 선택기 아래에 붙는 섹션: Deck colors(토큰, var()로 연결), This deck(덱에서 쓰는 색), Recent, 글자 색의 대비 칩.
// Fluid ColorPicker는 수정하지 않고, 같은 팝오버 안에 포털로 끼워 넣는다(color-field.tsx).
const Heading = ({ children }: { children: string }) => <div className="px-1 pb-1 text-micro text-muted-foreground">{children}</div>;

export function ColorSections({ html, value, resolved, onPick, contrastBg, tokenLinks = true }: {
  html: string | null;
  /** 지금 값(var()일 수 있음) */
  value: string;
  /** 지금 값을 풀어 낸 색(없으면 null) */
  resolved: string | null;
  onPick(color: string): void;
  /** 글자 색일 때 비교할 배경 색 */
  contrastBg?: string;
  /** false면 토큰을 var()로 연결하지 않고 값만 넣는다(토큰 편집 칸) */
  tokenLinks?: boolean;
}) {
  const tokens = html ? deckTokenColors(html) : [];
  const used = html ? colorsInDeck(html).slice(0, 12) : [];
  const recent = readRecentColors();
  const ratio = contrastBg && resolved ? contrastRatio(resolved, contrastBg) : null;
  const cur = resolved?.toLowerCase();
  return (
    <div data-testid="color-sections" className="mt-1 flex w-full flex-col gap-3 rounded-lg bg-surface-3 p-2.5 shadow-surface-3">
      {ratio !== null && (
        <div className="flex items-center justify-between px-1 text-caption">
          <span className="text-muted-foreground">Contrast with slide</span>
          <span data-testid="contrast-chip" className={cn("rounded px-1.5 py-0.5 tabular-nums", wcagLevel(ratio) === "fail" ? "bg-destructive/20 text-destructive" : "bg-hover text-foreground")}>
            {ratio.toFixed(1)}:1 {wcagLevel(ratio)}
          </span>
        </div>
      )}
      {tokens.length > 0 && (
        <div>
          <Heading>Deck colors</Heading>
          <div className="flex flex-col">
            {tokens.map((t) => {
              const linked = value.includes(`var(${t.name}`);
              return (
                <button key={t.name} type="button" data-testid="deck-token" aria-label={`${t.label} ${t.value}`} aria-pressed={linked}
                  onClick={() => onPick(tokenLinks ? `var(${t.name})` : t.value)}
                  className={cn("flex h-7 cursor-default items-center gap-2 rounded-md px-1 text-left text-body hover:bg-hover", linked && "bg-hover")}>
                  <span className="relative inline-flex"><ColorSwatch color={t.value} size={20} tabIndex={-1} aria-hidden="true" />
                    {tokenLinks && <Link2 aria-hidden="true" className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-surface-3 text-muted-foreground" />}</span>
                  <span className="flex-1 truncate">{t.label}</span>
                  <span className="text-caption uppercase tabular-nums text-muted-foreground">{t.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {used.length > 0 && (
        <div>
          <Heading>This deck</Heading>
          <div className="flex flex-wrap gap-1.5 px-1">
            {used.map((c) => <ColorSwatch key={c.value} color={c.value} size={20} selected={cur === c.value} aria-label={`Use ${c.value}`} data-testid="deck-color" onClick={() => onPick(c.value)} />)}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <Heading>Recent</Heading>
          <div className="flex flex-wrap gap-1.5 px-1">
            {recent.map((c) => <ColorSwatch key={c} color={c} size={20} selected={cur === c} aria-label={`Recent ${c}`} data-testid="recent-color" onClick={() => onPick(c)} />)}
          </div>
        </div>
      )}
    </div>
  );
}
