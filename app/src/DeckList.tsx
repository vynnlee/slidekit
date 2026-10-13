import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, LayoutGrid, List, MonitorPlay, Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardGroup, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { CommandMenu, CommandMenuDialog, CommandMenuEmpty, CommandMenuFooter, CommandMenuInput, CommandMenuList, type CommandMenuItemData } from "@/components/ui/command-menu";
import { Shell } from "./Shell";
import { go } from "./App";
import { deckUrl, type DeckEntry } from "@/lib/deck";

const SORTS = { date: "Date", title: "Name" } as const;
type Sort = keyof typeof SORTS;
// 표지 썸네일: 1920x1080 임베드 iframe을 축소한다. 화면에 들어오면 잠깐 뒤 한 번만 만들고 유지한다.
function Thumb({ deck, width: fixed }: { deck: DeckEntry; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fixed ?? 280);
  useEffect(() => {
    if (fixed) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  const width = w;
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e.isIntersecting) t = setTimeout(() => { setSeen(true); io.disconnect(); }, 60);
    }, { rootMargin: "120px" });
    io.observe(ref.current!);
    return () => { clearTimeout(t); io.disconnect(); };
  }, []);
  return (
    <div ref={ref} className="relative shrink-0 overflow-hidden rounded-md bg-hover" style={{ width: fixed ?? "100%", aspectRatio: "16 / 9" }}>
      {seen && (
        <iframe
          src={deckUrl(deck.folder, "?embed=1")} title={deck.title} tabIndex={-1} loading="lazy"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-black"
          style={{ width: 1920, height: 1080, transform: `scale(${width / 1920})` }}
        />
      )}
    </div>
  );
}

const ago = (iso?: string) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });
  return m < 60 ? rtf.format(-m, "minute") : m < 1440 ? rtf.format(-Math.round(m / 60), "hour") : rtf.format(-Math.round(m / 1440), "day");
};
const Badge = ({ deck }: { deck: DeckEntry }) => (
  <span className="shrink-0 rounded bg-hover px-1.5 text-caption text-muted-foreground">{deck.visibility === "password" ? "Password" : "Public"}</span>
);
const meta = (d: DeckEntry) => [d.slides != null && `${d.slides} slides`, ago(d.modified)].filter(Boolean).join("  ");

const pref = <T extends string>(k: string, ok: readonly T[], d: T) => { const v = localStorage.getItem(k) as T; return ok.includes(v) ? v : d; };

export function DeckList() {
  const [decks, setDecks] = useState<DeckEntry[] | null>(null);
  const [view, setView] = useState(() => pref("slidekit:list-view", ["grid", "list"], "grid"));
  const [sort, setSort] = useState<Sort>(() => pref("slidekit:list-sort", ["date", "title"], "date"));
  const [palette, setPalette] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const load = () => fetch("/api/decks").then((r) => r.json()).then(setDecks);
  useEffect(() => { load(); }, []);
  useEffect(() => { localStorage.setItem("slidekit:list-view", view); localStorage.setItem("slidekit:list-sort", sort); }, [view, sort]);

  const sorted = useMemo(() => {
    const l = [...(decks ?? [])];
    return sort === "title" ? l.sort((a, b) => a.title.localeCompare(b.title, "ko")) : l.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [decks, sort]);

  const open = (d: DeckEntry) => go(`/edit/${encodeURIComponent(d.id)}`);
  const sub = (d: DeckEntry) => [d.date, d.author].filter(Boolean).join("  ") || d.folder;
  const cycleSort = () => setSort((s) => (s === "date" ? "title" : "date"));

  const create = async () => {
    const r = await fetch("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? "Could not create deck");
    setCreating(false); setName(""); setErr("");
    go(`/edit/${encodeURIComponent(j.id)}`);
  };
  const startCreate = () => { setPalette(false); setErr(""); setCreating(true); };

  const items: CommandMenuItemData[] = useMemo(() => [
    { value: "new", label: "New deck", icon: Plus, group: "Actions", onSelect: startCreate },
    { value: "view", label: view === "grid" ? "View as list" : "View as grid", icon: view === "grid" ? List : LayoutGrid, group: "Actions", onSelect: () => setView(view === "grid" ? "list" : "grid") },
    { value: "sort", label: `Sort by ${SORTS[sort === "date" ? "title" : "date"]}`, icon: ArrowDownUp, group: "Actions", onSelect: cycleSort },
    ...sorted.flatMap((d): CommandMenuItemData[] => [
      { value: `edit:${d.id}`, label: d.title, description: "Edit", icon: Pencil, group: "Decks", keywords: [d.folder, d.author ?? ""], onSelect: () => open(d) },
      { value: `present:${d.id}`, label: d.title, description: "Presenter view", icon: MonitorPlay, group: "Decks", keywords: [d.folder, "present"], onSelect: () => go(`/present/${encodeURIComponent(d.id)}`) },
    ]),
  ], [sorted, view, sort]);

  return (
    <>
      <Shell
        toolbar={
          <>
            <span className="px-2 text-subtitle font-medium">slidekit</span>
            <Button variant="ghost" size="compact" leadingIcon={Search} className="ml-auto text-muted-foreground" onClick={() => setPalette(true)}>Search ⌘K</Button>
            <Button variant="ghost" size="compact" leadingIcon={ArrowDownUp} onClick={cycleSort}>{SORTS[sort]}</Button>
            <Tooltip content={view === "grid" ? "View as list" : "View as grid"} side="bottom">
              <Button variant="ghost" size="icon-compact" aria-label="Toggle view" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <List /> : <LayoutGrid />}</Button>
            </Tooltip>
            <Button variant="primary" size="compact" leadingIcon={Plus} onClick={startCreate}>New deck</Button>
          </>
        }
      >
        <div className="p-4">
          {decks?.length === 0 && <p className="text-caption text-muted-foreground">No decks yet</p>}
          {view === "grid" ? (
            <CardGroup columns={3} separated>
              {sorted.map((d) => (
                <Card key={d.id} onClick={() => open(d)} label={d.title}>
                  <Thumb deck={d} />
                  <CardHeader>
                    <CardTitle>{d.title}</CardTitle>
                    <CardDescription>{sub(d)}  {meta(d)}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </CardGroup>
          ) : (
            <CardGroup columns={1} separated>
              {sorted.map((d) => (
                <Card key={d.id} onClick={() => open(d)} label={d.title}>
                  <div className="flex items-center gap-3">
                    <Thumb deck={d} width={56} />
                    <span className="min-w-0 flex-1 truncate text-body">{d.title}</span>
                    <Badge deck={d} />
                    <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{meta(d)}</span>
                    <span className="hidden shrink-0 text-caption text-muted-foreground tabular-nums sm:inline">{sub(d)}</span>
                  </div>
                </Card>
              ))}
            </CardGroup>
          )}
        </div>
      </Shell>

      <CommandMenuDialog open={palette} onOpenChange={setPalette} title="Search" description="Open a deck or run an action">
        <CommandMenu items={items}>
          <CommandMenuInput placeholder="Deck name or action" />
          <CommandMenuList />
          <CommandMenuEmpty>No results</CommandMenuEmpty>
          <CommandMenuFooter />
        </CommandMenu>
      </CommandMenuDialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="sm">
          <DialogTitle>New deck</DialogTitle>
          <form className="flex flex-col gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create(); }}>
            <Field autoFocus aria-label="Deck name" placeholder="deck-name" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
            <p className={err ? "text-caption text-destructive" : "text-caption text-muted-foreground"}>{err || "Lowercase letters, digits and - only"}</p>
            <Button type="submit" variant="primary" size="compact" disabled={!name.trim()} className="self-end">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
