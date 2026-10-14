import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownUp, Copy, LayoutGrid, List, MonitorPlay, MoreHorizontal, Pencil, Plus, Presentation, Search, TextCursorInput, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardGroup, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { ContextMenu, MenuItems, useContextMenu } from "@/components/ui/context-menu";
import { deckMenu, type MenuItem } from "@/lib/menu-model";
import { Field } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { CommandMenu, CommandMenuDialog, CommandMenuItem, useIsMac, CommandMenuEmpty, CommandMenuFooter, CommandMenuInput, CommandMenuList, type CommandMenuItemData } from "@/components/ui/command-menu";
import { Shell } from "./Shell";
import { TrashList } from "./TrashList";
import { StatusPage } from "./StatusPage";
import { toast } from "./Toaster";
import { readRecent } from "@/lib/recent";
import { acquireThumb, pauseThumbs } from "@/lib/thumb-queue";
import { FOLDER_RE, slugify } from "@/lib/slug";
import { UNREACHABLE, isDown, onReconnect } from "@/lib/connection";
import { go } from "./App";
import { deckUrl, type DeckEntry } from "@/lib/deck";
import { cn } from "@/lib/utils";

const SORTS = { date: "Date", title: "Name", recent: "Recent" } as const;
const ORDER = ["date", "title", "recent"] as const;
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
  // iframe은 화면 가까이(120px)에 들어오면 대기열을 거쳐 동시에 3개까지만 로드하고, 화면에서 220px 넘게 멀어지면 해제한다.
  const [seen, setSeen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let want = false, cancel: (() => void) | null = null, t: ReturnType<typeof setTimeout> | undefined, guard: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (want) return;
      want = true;
      cancel = acquireThumb((release) => {
        releaseRef.current = release;
        setSeen(true);
        guard = setTimeout(release, 10000); // 로드가 끝나지 않아도 슬롯은 돌려준다
      });
    };
    const stop = () => {
      clearTimeout(t); clearTimeout(guard);
      if (!want) return;
      want = false; cancel?.(); cancel = null; releaseRef.current = null;
      setSeen(false); setLoaded(false);
    };
    const near = new IntersectionObserver(([e]) => { clearTimeout(t); if (e.isIntersecting) t = setTimeout(start, 100); }, { rootMargin: "120px" });
    const far = new IntersectionObserver(([e]) => { if (!e.isIntersecting) stop(); }, { rootMargin: "220px" });
    near.observe(ref.current!); far.observe(ref.current!);
    return () => { near.disconnect(); far.disconnect(); stop(); };
  }, []);
  return (
    <div ref={ref} className={cn("relative shrink-0 overflow-hidden rounded-md bg-hover", !loaded && "motion-safe:animate-pulse")} style={{ width: fixed ?? "100%", aspectRatio: "16 / 9" }}>
      {seen && (
        <iframe
          src={deckUrl(deck.folder, "?embed=1")} title={deck.title} aria-hidden="true" tabIndex={-1} loading="lazy"
          onLoad={(e) => {
            // 썸네일은 정지 화면이면 충분하다. 같은 출처 iframe은 부모와 메인 스레드를 나눠 쓰니, 로드가 끝나면 덱의 애니메이션과 타이머를 멈춘다.
            const f = e.currentTarget;
            try {
              const d = f.contentDocument!;
              const st = d.createElement("style"); st.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}"; d.head.appendChild(st);
              setTimeout(() => freezeFrame(f), 400);
            } catch {}
            setLoaded(true); releaseRef.current?.();
          }}
          className={cn("pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-black transition-opacity duration-300 motion-reduce:transition-none", loaded ? "opacity-100" : "opacity-0")}
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
// 공개 덱이 기본이라 Public은 표시하지 않고, 예외인 Password만 칩으로 보인다.
const Badge = ({ deck }: { deck: DeckEntry }) =>
  deck.visibility === "password" ? <span className="shrink-0 rounded bg-hover px-1.5 text-caption text-muted-foreground">Password</span> : null;
// 메타는 단위별 span으로 나눠 위계를 만든다: 슬라이드 수, 수정 시각, 작성자.
const Meta = ({ d, opened }: { d: DeckEntry; opened?: number }) => (
  <span className="flex min-w-0 flex-wrap gap-x-2 tabular-nums" title={[d.date, d.folder].filter(Boolean).join("  ")}>
    {d.slides != null && <span>{d.slides} slides</span>}
    {d.modified && <span>Edited {ago(d.modified)}</span>}
    {d.author && <span className="truncate">{d.author}</span>}
    {opened && <span className="flex items-center gap-1"><span aria-hidden className="size-1.5 rounded-full bg-focus-ring" />Opened {ago(new Date(opened).toISOString())}</span>}
  </span>
);

const api = async (path: string, method: string, body: object = {}) => {
  if (isDown()) throw new Error(UNREACHABLE);
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => { throw new Error(UNREACHABLE); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
};

// 카드와 행의 ... 버튼 메뉴. 우클릭 메뉴와 같은 항목 목록(menuFor)을 쓴다.
const hoverShow = "transition-opacity group-hover/deck:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";
function DeckMenu({ deck, items }: { deck: DeckEntry; items: MenuItem[] }) {
  return (
    <DropdownMenu>
      <DropdownTrigger render={
        <Button variant="ghost" size="icon-compact" aria-label={`Actions for ${deck.title}`} className={cn(hoverShow, "opacity-0 data-[state=open]:opacity-100")}>
          <MoreHorizontal />
        </Button>
      } />
      <DropdownContent align="end"><MenuItems items={items} /></DropdownContent>
    </DropdownMenu>
  );
}

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
// 로드가 끝난 썸네일 문서의 rAF 루프, 타이머, 웹 애니메이션, 미디어를 멈춘다(이후 장면은 그대로 보인다).
function freezeFrame(f: HTMLIFrameElement) {
  try {
    const w = f.contentWindow as (Window & typeof globalThis) | null;
    if (!w) return;
    w.requestAnimationFrame = () => 0;
    w.setInterval = (() => 0) as unknown as typeof w.setInterval;
    w.setTimeout = (() => 0) as unknown as typeof w.setTimeout;
    for (let i = 1; i < 3000; i++) { w.clearInterval(i); w.clearTimeout(i); }
    w.document.getAnimations().forEach((a) => a.pause());
    w.document.querySelectorAll("video,audio").forEach((m) => (m as HTMLMediaElement).pause());
  } catch {}
}
const pref = <T extends string>(k: string, ok: readonly T[], d: T) => { const v = localStorage.getItem(k) as T; return ok.includes(v) ? v : d; };

export function DeckList() {
  const [decks, setDecks] = useState<DeckEntry[] | null>(null);
  const [view, setView] = useState(() => pref("slidekit:list-view", ["grid", "list"], "grid"));
  const [sort, setSort] = useState<Sort>(() => pref("slidekit:list-sort", ORDER, "date"));
  const [palette, setPalette] = useState(false);
  // 전체 검색: 팔레트를 열 때 슬라이드 제목, 본문, 노트 색인을 받아 둔다(서버는 파일이 안 바뀌면 캐시를 쓴다).
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  useEffect(() => { pauseThumbs(palette); return () => pauseThumbs(false); }, [palette]);
  useEffect(() => {
    if (!palette) { setQ(""); return; }
    fetch("/api/search-index").then((r) => (r.ok ? r.json() : null)).then(setIndex).catch(() => {});
  }, [palette]);
  const [trashView, setTrashView] = useState(false);
  // 카드 열 수는 폭에서 정한다(카드 최소 폭 220px).
  const body = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.min(6, Math.floor(e.contentRect.width / 240)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false); // 폴더를 직접 고치면 제목에서 자동 제안을 멈춘다
  const [err, setErr] = useState("");

  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const cm = useContextMenu();
  const [renaming, setRenaming] = useState<DeckEntry | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameFolder, setRenameFolder] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameErr, setRenameErr] = useState("");
  const [actionErr, setActionErr] = useState("");
  const load = () => {
    setLoadErr(false);
    return fetch("/api/decks").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(setDecks).catch(() => setLoadErr(true));
  };
  useEffect(() => { load(); return onReconnect(() => { load(); }); }, []);
  useEffect(() => { localStorage.setItem("slidekit:list-view", view); localStorage.setItem("slidekit:list-sort", sort); }, [view, sort]);

  const recent = useMemo(readRecent, []);
  // 마지막으로 연 덱: 지금 있는 덱 중 가장 최근 것(지워졌거나 없는 덱의 기록은 건너뛴다).
  const lastOpened = useMemo(() => recent.find((r) => decks?.some((d) => d.id === r.id || d.folder === r.id)), [recent, decks]);
  const sorted = useMemo(() => {
    const l = [...(decks ?? [])];
    if (sort === "title") return l.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    if (sort === "recent") {
      const at = (d: DeckEntry) => recent.find((r) => r.id === d.id || r.id === d.folder)?.t ?? 0;
      return l.sort((a, b) => at(b) - at(a) || (b.date ?? "").localeCompare(a.date ?? ""));
    }
    return l.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [decks, sort, recent]);

  const open = (d: DeckEntry) => go(`/edit/${encodeURIComponent(d.id)}`);
  const cycleSort = () => setSort((s) => ORDER[(ORDER.indexOf(s) + 1) % ORDER.length]);

  // 새 덱: 폴더 이름은 제목에서 제안하고, 형식과 중복은 입력하는 동안 바로 알린다.
  const known = useMemo(() => new Set((decks ?? []).map((d) => d.folder)), [decks]);
  const folderError = (f: string, self?: string) => !f ? "" : !FOLDER_RE.test(f) ? "Use lowercase letters, digits and -" : f !== self && known.has(f) ? `A deck named ${f} already exists` : "";
  const newErr = err || folderError(name);
  const onTitle = (v: string) => { setNewTitle(v); setErr(""); if (!nameTouched) setName(v.trim() ? slugify(v) : ""); };
  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const j = await api("/api/decks", "POST", { name: name.trim(), title: newTitle.trim() || name.trim() });
      setCreating(false); setNewTitle(""); setName(""); setNameTouched(false); setErr("");
      go(`/edit/${encodeURIComponent(j.id)}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const run = async <T,>(fn: () => Promise<T>): Promise<T | false> => {
    if (busy) return false;
    setBusy(true); setActionErr("");
    try { const r = await fn(); await load(); return r; }
    catch (e) { setActionErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const present = (d: DeckEntry) => go(`/present/${encodeURIComponent(d.id)}`);
  const duplicate = async (d: DeckEntry) => {
    const j = await run(() => api(`/api/decks/${encodeURIComponent(d.folder)}/duplicate`, "POST"));
    if (j) toast(`Duplicated ${d.title}`);
  };
  const startRename = (d: DeckEntry) => { setRenameTitle(d.title); setRenameFolder(d.folder); setFolderOpen(false); setRenameErr(""); setRenaming(d); };
  const renameFolderErr = renaming ? folderError(renameFolder, renaming.folder) : "";
  const doRename = async () => {
    if (!renaming || busy || renameFolderErr || !renameTitle.trim()) return;
    setBusy(true);
    try {
      let folder = renaming.folder;
      if (renameTitle.trim() !== renaming.title) await api(`/api/decks/${encodeURIComponent(folder)}/title`, "POST", { title: renameTitle.trim() });
      if (renameFolder !== folder) { await api(`/api/decks/${encodeURIComponent(folder)}/rename`, "POST", { name: renameFolder }); folder = renameFolder; }
      setRenaming(null); await load();
    } catch (e) { setRenameErr((e as Error).message); await load(); }
    finally { setBusy(false); }
  };
  // 휴지통으로 보내는 것은 확인 없이 바로 하고, 되돌리기는 토스트의 Undo로 한다.
  const trash = async (d: DeckEntry) => {
    const j = await run(() => api(`/api/decks/${encodeURIComponent(d.folder)}/trash`, "POST"));
    if (j) toast(`Moved ${d.title} to Trash`, { action: { label: "Undo", onClick: () => { run(() => api(`/api/trash/${encodeURIComponent((j as { entry: string }).entry)}/restore`, "POST")); } } });
  };
  // 카드와 행의 메뉴 항목은 한 곳(menu-model)에서 만들고, ... 버튼과 우클릭과 ContextMenu 키가 같은 목록을 쓴다.
  const menuFor = (d: DeckEntry) => deckMenu(
    { open: () => open(d), present: () => present(d), rename: () => startRename(d), duplicate: () => { duplicate(d); }, trash: () => { trash(d); } },
    { open: Pencil, present: MonitorPlay, rename: TextCursorInput, duplicate: Copy, trash: Trash2 },
  );
  const menu = (d: DeckEntry, cls = "absolute right-2 top-2 z-30") => (
    <div className={cn(cls, "flex items-center gap-0.5")}>
      <Tooltip content="Present" side="top">
        <Button variant="ghost" size="icon-compact" aria-label={`Present ${d.title}`} className={cn(hoverShow, "opacity-0")} onClick={() => present(d)}><MonitorPlay /></Button>
      </Tooltip>
      <DeckMenu deck={d} items={menuFor(d)} />
    </div>
  );

  // 카드 사이 키보드 이동: 화살표(그리드는 열 수만큼 위아래), Cmd 또는 Ctrl+Enter로 발표. Enter는 카드 버튼의 기본 동작(열기).
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const roots = [...(body.current?.querySelectorAll<HTMLElement>("[data-deck]") ?? [])];
    const cur = roots.findIndex((r) => r.contains(document.activeElement));
    if (cur < 0) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); present(sorted[cur]); return; }
    const d = (view === "grid" ? { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } : { ArrowDown: 1, ArrowUp: -1 })[e.key as "ArrowDown"];
    const next = d && roots[cur + d];
    if (!next) return;
    e.preventDefault(); e.stopPropagation(); // CardGroup의 자체 화살표 처리보다 먼저 받는다
    [...next.querySelectorAll("button")].find((b) => !/^(Actions for|Present) /.test(b.getAttribute("aria-label") ?? ""))?.focus();
  };

  const mac = useIsMac();
  const startCreate = () => { setPalette(false); setErr(""); setNewTitle(""); setName(""); setNameTouched(false); setCreating(true); };

  // 두 글자 이상 입력하면 모든 덱의 슬라이드 제목, 본문, 노트에서 찾는다(최대 30건). 결과를 고르면 그 슬라이드의 편집기로 간다.
  const slideHits = useMemo((): CommandMenuItemData[] => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (q.trim().length < 2 || !index) return [];
    const out: CommandMenuItemData[] = [];
    for (const d of index) {
      for (const sl of d.slides) {
        const hay = `${sl.title} ${sl.text} ${sl.notes}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        const inNotes = snippet(sl.notes, words);
        // 제목에서 이미 일치했으면 라벨이 보여 주니 본문 조각은 붙이지 않는다.
        const inTitle = words.every((w) => sl.title.toLowerCase().includes(w));
        const hit = inTitle ? "" : snippet(sl.text, words) || (inNotes ? `Notes: ${inNotes}` : "");
        out.push({
          value: `slide:${d.folder}:${sl.n}`, label: sl.title || `Slide ${sl.n}`, icon: Presentation, group: "Slides",
          description: `${d.title}, slide ${sl.n}${hit ? `: ${hit}` : ""}`, keywords: [sl.text, sl.notes],
          onSelect: () => go(`/edit/${encodeURIComponent(d.id)}?slide=${sl.n}`),
        });
        if (out.length >= 30) return out;
      }
    }
    return out;
  }, [q, index]);

  const items: CommandMenuItemData[] = useMemo(() => [
    { value: "new", label: "New deck", icon: Plus, group: "Actions", onSelect: startCreate },
    { value: "view", label: view === "grid" ? "View as list" : "View as grid", icon: view === "grid" ? List : LayoutGrid, group: "Actions", onSelect: () => setView(view === "grid" ? "list" : "grid") },
    { value: "sort", label: `Sort by ${SORTS[ORDER[(ORDER.indexOf(sort) + 1) % ORDER.length]]}`, icon: ArrowDownUp, group: "Actions", onSelect: cycleSort },
    ...sorted.flatMap((d): CommandMenuItemData[] => [
      { value: `edit:${d.id}`, label: d.title, description: "Edit", icon: Pencil, group: "Decks", keywords: [d.folder, d.author ?? ""], onSelect: () => open(d) },
      { value: `present:${d.id}`, label: d.title, description: "Presenter view", icon: MonitorPlay, group: "Decks", keywords: [d.folder, "present"], onSelect: () => go(`/present/${encodeURIComponent(d.id)}`) },
    ]),
    ...slideHits,
  ], [sorted, view, sort, slideHits]);

  return (
    <>
      <Shell
        heading="Decks"
        toolbar={
          <>
            <span className="px-2 text-subtitle font-medium">slidekit</span>
            <Button variant="ghost" size="compact" leadingIcon={Search} className="ml-auto text-muted-foreground" onClick={() => setPalette(true)}><span className="max-[640px]:sr-only">Search <span className="max-[900px]:hidden">{mac ? "⌘K" : "Ctrl K"}</span></span></Button>
            <Button variant="ghost" size="compact" leadingIcon={ArrowDownUp} onClick={cycleSort}><span className="max-[640px]:sr-only">{SORTS[sort]}</span></Button>
            <Button variant="ghost" size="compact" leadingIcon={Trash2} active={trashView} aria-pressed={trashView} onClick={() => setTrashView((t) => !t)}><span className="max-[640px]:sr-only">Trash</span></Button>
            <Tooltip content={view === "grid" ? "View as list" : "View as grid"} side="bottom">
              <Button variant="ghost" size="icon-compact" aria-label="Toggle view" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <List /> : <LayoutGrid />}</Button>
            </Tooltip>
            <Button variant="primary" size="compact" leadingIcon={Plus} onClick={startCreate}><span className="max-[640px]:sr-only">New deck</span></Button>
          </>
        }
      >
        <div ref={body} onKeyDownCapture={onKeys} className="p-4">
          {trashView ? <TrashList onRestored={load} /> : <>
          {loadErr && (
            <p role="alert" className="flex items-center gap-2 text-caption text-muted-foreground">
              Could not load decks.<Button variant="ghost" size="compact" onClick={load}>Retry</Button>
            </p>
          )}
          {actionErr && <p role="alert" className="mb-2 text-caption text-destructive">{actionErr}</p>}
          {decks === null && !loadErr && (
            <div aria-hidden className="grid gap-4" style={{ gridTemplateColumns: `repeat(${view === "grid" ? cols : 1}, minmax(0, 1fr))` }}>
              {[0, 1, 2].slice(0, view === "grid" ? Math.min(3, cols) : 3).map((i) => <div key={i} className="aspect-video rounded-md bg-hover motion-safe:animate-pulse" style={view === "grid" ? undefined : { aspectRatio: "16 / 1.5" }} />)}
            </div>
          )}
          {decks?.length === 0 && (
            <StatusPage as="h2" title="No decks yet" actions={<Button variant="primary" size="compact" leadingIcon={Plus} onClick={startCreate}>New deck</Button>}>
              Create a deck to start, or run slidekit new in a terminal.
            </StatusPage>
          )}
          {view === "grid" ? (
            <CardGroup columns={cols} separated>
              {sorted.map((d) => (
                <Card key={d.id} onClick={() => open(d)} label={d.title} className="group/deck" data-deck="" {...cm.bind(() => menuFor(d))}>
                  {menu(d)}
                  <Thumb deck={d} />
                  <CardHeader>
                    <CardTitle>{d.title}</CardTitle>
                    <CardDescription><Meta d={d} opened={lastOpened && (lastOpened.id === d.id || lastOpened.id === d.folder) ? lastOpened.t : undefined} /></CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </CardGroup>
          ) : (
            <CardGroup columns={1} separated>
              {sorted.map((d) => (
                <Card key={d.id} onClick={() => open(d)} label={d.title} className="group/deck" data-deck="" {...cm.bind(() => menuFor(d))}>
                  <div className="flex items-center gap-3 pr-16">
                    <Thumb deck={d} width={56} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 truncate text-body sm:flex-1">{d.title}</span>
                      <span className="flex items-center gap-2 text-caption text-muted-foreground"><Badge deck={d} /><Meta d={d} opened={lastOpened && (lastOpened.id === d.id || lastOpened.id === d.folder) ? lastOpened.t : undefined} /></span>
                    </span>
                  </div>
                  {menu(d, "absolute right-2 top-1/2 z-30 -translate-y-1/2")}
                </Card>
              ))}
            </CardGroup>
          )}
          </>}
        </div>
      </Shell>

      <ContextMenu menu={cm} />

      <CommandMenuDialog open={palette} onOpenChange={setPalette} title="Search" description="Open a deck or run an action">
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

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent size="sm">
          <DialogTitle>Rename deck</DialogTitle>
          <form className="flex flex-col gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); doRename(); }}>
            <Field autoFocus aria-label="Title" value={renameTitle} onChange={(e) => { setRenameTitle(e.target.value); setRenameErr(""); }} />
            {folderOpen ? (
              <>
                <Field aria-label="Folder" aria-invalid={!!renameFolderErr || undefined} value={renameFolder} onChange={(e) => { setRenameFolder(e.target.value); setRenameErr(""); }} />
                <p className="text-caption text-muted-foreground">Changing the folder changes the deck address.</p>
              </>
            ) : (
              <Button type="button" variant="ghost" size="compact" className="self-start text-muted-foreground" onClick={() => setFolderOpen(true)}>Edit folder name</Button>
            )}
            <p role="alert" className="min-h-4 text-caption text-destructive">{renameErr || renameFolderErr}</p>
            <Button type="submit" variant="primary" size="compact" disabled={!renameTitle.trim() || !!renameFolderErr || busy} className="self-end">Rename</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="sm">
          <DialogTitle>New deck</DialogTitle>
          <form className="flex flex-col gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !newErr) create(); }}>
            <Field autoFocus aria-label="Title" placeholder="Title" value={newTitle} onChange={(e) => onTitle(e.target.value)} />
            <Field aria-label="Folder" placeholder="folder-name" aria-invalid={!!newErr || undefined} value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); setErr(""); }} />
            <p role={newErr ? "alert" : undefined} className={newErr ? "text-caption text-destructive" : "text-caption text-muted-foreground"}>{newErr || "Folder: lowercase letters, digits and -"}</p>
            <Button type="submit" variant="primary" size="compact" disabled={!name.trim() || !!newErr || busy} className="self-end">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
