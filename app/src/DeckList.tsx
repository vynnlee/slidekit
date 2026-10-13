import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowDownUp, Copy, LayoutGrid, List, MonitorPlay, MoreHorizontal, Pencil, Plus, Search, TextCursorInput, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardGroup, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Field } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { CommandMenu, CommandMenuDialog, CommandMenuEmpty, CommandMenuFooter, CommandMenuInput, CommandMenuList, type CommandMenuItemData } from "@/components/ui/command-menu";
import { Shell } from "./Shell";
import { TrashList } from "./TrashList";
import { go } from "./App";
import { deckUrl, type DeckEntry } from "@/lib/deck";
import { cn } from "@/lib/utils";

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

const api = async (path: string, method: string, body: object = {}) => {
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
};

// 카드와 행의 ... 메뉴. 우클릭도 같은 메뉴를 연다(메뉴는 ... 버튼 자리에 뜬다).
function DeckMenu({ deck, open, onOpenChange, onRename, onTrash, onDuplicate, onPresent, onOpen }: {
  deck: DeckEntry; open: boolean; onOpenChange: (o: boolean) => void;
  onRename: () => void; onTrash: () => void; onDuplicate: () => void; onPresent: () => void; onOpen: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownTrigger render={
        <Button variant="ghost" size="icon-compact" aria-label={`Actions for ${deck.title}`} className={cn("transition-opacity group-hover/deck:opacity-100 focus-visible:opacity-100", open ? "opacity-100" : "opacity-0")}>
          <MoreHorizontal />
        </Button>
      } />
      <DropdownContent align="end">
        <MenuItem index={0} icon={Pencil} label="Open" onSelect={onOpen} />
        <MenuItem index={1} icon={MonitorPlay} label="Present" onSelect={onPresent} />
        <MenuItem index={2} icon={Copy} label="Duplicate" onSelect={onDuplicate} />
        <MenuItem index={3} icon={TextCursorInput} label="Rename" onSelect={onRename} />
        <MenuItem index={4} icon={Trash2} label="Move to trash" onSelect={onTrash} />
      </DropdownContent>
    </DropdownMenu>
  );
}

const pref = <T extends string>(k: string, ok: readonly T[], d: T) => { const v = localStorage.getItem(k) as T; return ok.includes(v) ? v : d; };

export function DeckList() {
  const [decks, setDecks] = useState<DeckEntry[] | null>(null);
  const [view, setView] = useState(() => pref("slidekit:list-view", ["grid", "list"], "grid"));
  const [sort, setSort] = useState<Sort>(() => pref("slidekit:list-sort", ["date", "title"], "date"));
  const [palette, setPalette] = useState(false);
  const [trashView, setTrashView] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DeckEntry | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [renameErr, setRenameErr] = useState("");
  const [trashing, setTrashing] = useState<DeckEntry | null>(null);
  const [actionErr, setActionErr] = useState("");
  const load = () => {
    setLoadErr(false);
    return fetch("/api/decks").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(setDecks).catch(() => setLoadErr(true));
  };
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
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error ?? "Could not create deck");
      setCreating(false); setName(""); setErr("");
      go(`/edit/${encodeURIComponent(j.id)}`);
    } catch { setErr("Could not reach the server"); }
    finally { setBusy(false); }
  };
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setActionErr("");
    try { await fn(); await load(); return true; }
    catch (e) { setActionErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const present = (d: DeckEntry) => go(`/present/${encodeURIComponent(d.id)}`);
  const duplicate = (d: DeckEntry) => run(() => api(`/api/decks/${encodeURIComponent(d.folder)}/duplicate`, "POST"));
  const startRename = (d: DeckEntry) => { setRenameTo(d.folder); setRenameErr(""); setRenaming(d); };
  const doRename = async () => {
    if (!renaming || busy) return;
    setBusy(true);
    try { await api(`/api/decks/${encodeURIComponent(renaming.folder)}/rename`, "POST", { name: renameTo.trim() }); setRenaming(null); await load(); }
    catch (e) { setRenameErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const doTrash = async () => { const d = trashing; if (d && (await run(() => api(`/api/decks/${encodeURIComponent(d.folder)}/trash`, "POST")))) setTrashing(null); };
  const menu = (d: DeckEntry, cls = "absolute right-2 top-2 z-30") => (
    <div className={cls}>
      <DeckMenu
        deck={d} open={menuId === d.id} onOpenChange={(o) => setMenuId(o ? d.id : null)}
        onOpen={() => open(d)} onPresent={() => present(d)} onDuplicate={() => duplicate(d)} onRename={() => startRename(d)} onTrash={() => setTrashing(d)}
      />
    </div>
  );
  // 우클릭은 버튼을 뗀 뒤에 연다. 누르는 중에 열면 같은 입력의 pointerup이 메뉴 항목을 바로 실행한다.
  const ctx = (d: DeckEntry) => ({
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onMouseUp: (e: MouseEvent) => { if (e.button === 2) setMenuId(d.id); },
  });

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
        heading="Decks"
        toolbar={
          <>
            <span className="px-2 text-subtitle font-medium">slidekit</span>
            <Button variant="ghost" size="compact" leadingIcon={Search} className="ml-auto text-muted-foreground" onClick={() => setPalette(true)}>Search ⌘K</Button>
            <Button variant="ghost" size="compact" leadingIcon={ArrowDownUp} onClick={cycleSort}>{SORTS[sort]}</Button>
            <Button variant="ghost" size="compact" leadingIcon={Trash2} active={trashView} aria-pressed={trashView} onClick={() => setTrashView((t) => !t)}>Trash</Button>
            <Tooltip content={view === "grid" ? "View as list" : "View as grid"} side="bottom">
              <Button variant="ghost" size="icon-compact" aria-label="Toggle view" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <List /> : <LayoutGrid />}</Button>
            </Tooltip>
            <Button variant="primary" size="compact" leadingIcon={Plus} onClick={startCreate}>New deck</Button>
          </>
        }
      >
        <div className="p-4">
          {trashView ? <TrashList onRestored={load} /> : <>
          {loadErr && (
            <p role="alert" className="flex items-center gap-2 text-caption text-muted-foreground">
              Could not load decks.<Button variant="ghost" size="compact" onClick={load}>Retry</Button>
            </p>
          )}
          {actionErr && <p role="alert" className="mb-2 text-caption text-destructive">{actionErr}</p>}
          {decks?.length === 0 && <p className="text-caption text-muted-foreground">No decks yet</p>}
          {view === "grid" ? (
            <CardGroup columns={3} separated>
              {sorted.map((d) => (
                <Card key={d.id} onClick={() => open(d)} label={d.title} className="group/deck" {...ctx(d)}>
                  {menu(d)}
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
                <Card key={d.id} onClick={() => open(d)} label={d.title} className="group/deck" {...ctx(d)}>
                  <div className="flex items-center gap-3 pr-8">
                    <Thumb deck={d} width={56} />
                    <span className="min-w-0 flex-1 truncate text-body">{d.title}</span>
                    <Badge deck={d} />
                    <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{meta(d)}</span>
                    <span className="hidden shrink-0 text-caption text-muted-foreground tabular-nums sm:inline">{sub(d)}</span>
                  </div>
                  {menu(d, "absolute right-2 top-1/2 z-30 -translate-y-1/2")}
                </Card>
              ))}
            </CardGroup>
          )}
          </>}
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

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent size="sm">
          <DialogTitle>Rename deck</DialogTitle>
          <form className="flex flex-col gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); doRename(); }}>
            <Field autoFocus aria-label="New name" value={renameTo} onChange={(e) => { setRenameTo(e.target.value); setRenameErr(""); }} />
            <p className={renameErr ? "text-caption text-destructive" : "text-caption text-muted-foreground"}>{renameErr || "Lowercase letters, digits and - only"}</p>
            <Button type="submit" variant="primary" size="compact" disabled={!renameTo.trim() || busy} className="self-end">Rename</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!trashing} onOpenChange={(o) => !o && setTrashing(null)}>
        <DialogContent size="sm">
          <DialogTitle>Move to trash?</DialogTitle>
          <DialogDescription>{trashing?.title} moves to decks/.trash and can be restored from there.</DialogDescription>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" size="compact" onClick={() => setTrashing(null)}>Cancel</Button>
            <Button variant="primary" size="compact" disabled={busy} onClick={doTrash}>Move to trash</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="sm">
          <DialogTitle>New deck</DialogTitle>
          <form className="flex flex-col gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create(); }}>
            <Field autoFocus aria-label="Deck name" placeholder="deck-name" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
            <p className={err ? "text-caption text-destructive" : "text-caption text-muted-foreground"}>{err || "Lowercase letters, digits and - only"}</p>
            <Button type="submit" variant="primary" size="compact" disabled={!name.trim() || busy} className="self-end">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
