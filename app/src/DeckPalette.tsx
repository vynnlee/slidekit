import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, Keyboard, LayoutGrid, List, MonitorPlay, Pencil, Plus, Presentation } from "lucide-react";
import { CommandMenu, CommandMenuDialog, CommandMenuEmpty, CommandMenuFooter, CommandMenuInput, CommandMenuItem, CommandMenuList, type CommandMenuItemData } from "@/components/ui/command-menu";
import { pauseThumbs } from "@/lib/thumb-queue";
import type { DeckEntry } from "@/lib/deck";
import { go } from "./App";

// 덱 목록의 검색 팔레트. 검색어 상태(q)를 목록 밖 이 컴포넌트가 가지고 있어서, 글자를 칠 때마다 덱 카드 수십 개가 다시 그려지지 않는다.
type SearchEntry = { folder: string; id: string; title: string; slides: { n: number; title: string; text: string; notes: string }[] };
// 일치한 곳 앞뒤 글자를 잘라 보여 준다.
const snippet = (text: string, words: string[]) => {
  const low = text.toLowerCase();
  const at = words.map((w) => low.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return "";
  return `${at > 24 ? "..." : ""}${text.slice(Math.max(0, at - 24), at + 56).trim()}${text.length > at + 56 ? "..." : ""}`;
};
// 검색어와 일치한 부분을 굵게 보인다(Fluid 행의 기본 레이아웃을 같은 모양으로 직접 그린다).
const Hl = ({ text, q }: { text: string; q: string }) => {
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  return <>{text.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, i) => (i % 2 ? <mark key={i} className="bg-transparent font-semibold text-foreground">{part}</mark> : part))}</>;
};

export function DeckPalette({ open, onOpenChange, sorted, view, sortLabel, onNew, onToggleView, onCycleSort, onHelp, onOpen }: {
  open: boolean; onOpenChange(o: boolean): void; sorted: DeckEntry[]; view: string; sortLabel: string;
  onNew(): void; onToggleView(): void; onCycleSort(): void; onHelp(): void; onOpen(d: DeckEntry): void;
}) {
  // 전체 검색: 팔레트를 열 때 슬라이드 제목, 본문, 노트 색인을 받아 둔다(서버는 파일이 안 바뀌면 캐시를 쓴다).
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  useEffect(() => { pauseThumbs(open); return () => pauseThumbs(false); }, [open]);
  useEffect(() => {
    if (!open) { setQ(""); return; }
    fetch("/api/search-index").then((r) => (r.ok ? r.json() : null)).then(setIndex).catch(() => {});
  }, [open]);
  const slideHits = useMemo((): CommandMenuItemData[] => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (q.trim().length < 2 || !index) return [];
    const out: CommandMenuItemData[] = [];
    let more = false;
    for (const d of index) {
      let perDeck = 0;
      for (const sl of d.slides) {
        const hay = `${sl.title} ${sl.text} ${sl.notes}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        if (out.length >= 12) { more = true; break; }
        if (perDeck >= 3) { more = true; break; } // 흔한 낱말이 앞쪽 덱 하나를 독점하지 않게 덱마다 3장까지
        perDeck++;
        const inNotes = snippet(sl.notes, words);
        // 제목에서 이미 일치했으면 라벨이 보여 주니 본문 조각은 붙이지 않는다.
        const inTitle = words.every((w) => sl.title.toLowerCase().includes(w));
        const hit = inTitle ? "" : snippet(sl.text, words) || (inNotes ? `Notes: ${inNotes}` : "");
        out.push({
          value: `slide:${d.folder}:${sl.n}`, label: sl.title || `Slide ${sl.n}`, icon: Presentation, group: "Slides",
          description: `${d.title}, slide ${sl.n}${hit ? `: ${hit}` : ""}`, keywords: [sl.text, sl.notes],
          onSelect: () => go(`/edit/${encodeURIComponent(d.id)}?slide=${sl.n}`),
        });
      }
      if (out.length >= 12 && more) break;
    }
    if (more) out.push({ value: "slides-more", label: "More slides not shown", description: "Refine your search", group: "Slides", disabled: true, keywords: [q] });
    return out;
  }, [q, index]);
  // 팔레트에 그리는 줄 수를 제한한다(덱 60개면 줄 120개와 슬라이드 결과로 열 때와 글자마다 수백 ms가 걸렸다): 입력이 없으면 정렬 앞쪽 6개, 입력이 있으면 일치하는 덱 최대 10개.
  const paletteDecks = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sorted;
    return sorted.filter((d) => { const hay = `${d.title} ${d.folder} ${d.author ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  }, [sorted, q]);
  const shownDecks = useMemo(() => paletteDecks.slice(0, q.trim() ? 10 : 6), [paletteDecks, q]);
  const items: CommandMenuItemData[] = useMemo(() => [
    { value: "new", label: "New deck", icon: Plus, group: "Actions", shortcut: "n", onSelect: onNew },
    { value: "view", label: view === "grid" ? "View as list" : "View as grid", icon: view === "grid" ? List : LayoutGrid, group: "Actions", onSelect: onToggleView },
    { value: "keys", label: "Keyboard shortcuts", icon: Keyboard, group: "Actions", keywords: ["help", "keys"], onSelect: onHelp },
    { value: "sort", label: sortLabel, icon: ArrowDownUp, group: "Actions", onSelect: onCycleSort },
    ...shownDecks.flatMap((d): CommandMenuItemData[] => [
      { value: `edit:${d.id}`, label: d.title, description: "Edit", icon: Pencil, group: "Decks", keywords: [d.folder, d.author ?? ""], onSelect: () => onOpen(d) },
      { value: `present:${d.id}`, label: d.title, description: "Presenter view", icon: MonitorPlay, group: "Decks", keywords: [d.folder, "present"], onSelect: () => go(`/present/${encodeURIComponent(d.id)}`) },
    ]),
    ...(q.trim() && paletteDecks.length > shownDecks.length ? [{ value: "decks-more", label: "More decks not shown", description: "Refine your search", group: "Decks", disabled: true, keywords: [q] }] : []),
    ...slideHits,
  ], [paletteDecks, shownDecks, q, view, sortLabel, slideHits, onNew, onToggleView, onHelp, onCycleSort, onOpen]);
  return (
      <CommandMenuDialog open={open} onOpenChange={onOpenChange} title="Search" description="Open a deck or run an action">
        <CommandMenu items={items} query={q} onQueryChange={setQ}>
          <CommandMenuInput placeholder="Decks, slides, or actions" />
          <CommandMenuList renderItem={(item) => (
            <CommandMenuItem value={item.value}>
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1"><Hl text={item.label} q={q} /></span>
                {item.description && <span className="min-w-0 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1 text-foreground/75"><Hl text={item.description} q={q} /></span>}
              </span>
            </CommandMenuItem>
          )} />
          <CommandMenuEmpty>No results</CommandMenuEmpty>
          <CommandMenuFooter className="[&_kbd_*]:text-foreground/80" />
        </CommandMenu>
      </CommandMenuDialog>
  );
}
