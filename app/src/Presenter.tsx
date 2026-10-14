import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Minus, MonitorPlay, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Shell } from "./Shell";
import { go } from "./App";
import { deckUrl, type DeckEntry, type Info, type Pos } from "@/lib/deck";
import { presentationOpen, startPresentation, warmScreens } from "@/lib/present";
import { markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { StatusPage } from "./StatusPage";

const VIEW_KEY = "slidekit:view";
const NOTES_KEY = "slidekit:notes-size";
const TARGET_KEY = "slidekit:target-min";
const NOTES_MIN = 14, NOTES_MAX = 56;
const VIEW_ITEMS = { current: "Current slide", next: "Next slide", notes: "Notes", timer: "Timer", clock: "Clock", chapters: "Chapters" } as const;
type View = Record<keyof typeof VIEW_ITEMS, boolean>;
const defaultView = Object.fromEntries(Object.keys(VIEW_ITEMS).map((k) => [k, true])) as View;

const SHORTCUTS = [["← →", "Move"], ["F", "Full screen"], ["+ -", "Notes size"], ["PgUp PgDn", "Scroll notes"], ["T", "Start or pause timer"], ["R", "Reset timer"], ["B W", "Blank presentation (in its window)"]];
const mmss = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
const pad = (n: number) => String(n).padStart(2, "0");
const hms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
// 깨진 localStorage 값은 기본값으로 대체한다(흰 화면 방지).
const readJson = (k: string): Record<string, unknown> => {
  try { const v = JSON.parse(localStorage.getItem(k) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};
const rid = () => Math.random().toString(36).slice(2, 8);

export function Presenter({ id }: { id: string }) {
  const [deck, setDeck] = useState<DeckEntry | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [pos, setPos] = useState<Pos>({ slide: 1, step: 1 });
  const [view, setView] = useState<View>(() => ({ ...defaultView, ...readJson(VIEW_KEY) }));
  const [err, setErr] = useState<string | null>(null);
  const [load, setLoad] = useState<"loading" | "missing" | "error">("loading");
  const [now, setNow] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState(() => { const n = Number(localStorage.getItem(TARGET_KEY)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; });
  const [stalled, setStalled] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const [win, setWin] = useState<boolean | null>(presentationOpen);
  const [notesSize, setNotesSize] = useState(() => Math.min(NOTES_MAX, Math.max(NOTES_MIN, Number(localStorage.getItem(NOTES_KEY)) || 20)));
  const notesRef = useRef<HTMLDivElement>(null);

  const curRef = useRef<HTMLIFrameElement>(null);
  const nextRef = useRef<HTMLIFrameElement>(null);
  const chan = useRef<BroadcastChannel | null>(null);
  const me = useRef(rid());
  const posRef = useRef(pos);
  const lastKey = useRef("");
  const ready = useRef(false); // 현재 슬라이드 iframe이 준비되기 전의 goto는 대기시켰다가 ready 뒤에 적용한다
  // /present/<id>?from=N: 이 장에서 시작한다. 시작 위치가 정해지면 발표 창이 알려 주는 위치보다 우선한다.
  const startFrom = useRef<number | null>((() => { const n = Number(new URLSearchParams(location.search).get("from")); return Number.isInteger(n) && n >= 1 ? n : null; })());
  const pending = useRef<Pos | null>(startFrom.current ? { slide: startFrom.current, step: 1 } : null);
  posRef.current = pos;

  useEffect(() => {
    fetch("/api/decks")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((l: DeckEntry[]) => { const d = l.find((x) => x.id === id) ?? null; setDeck(d); setLoad(d ? "loading" : "missing"); })
      .catch(() => setLoad("error"));
  }, [id]);
  useEffect(() => { warmScreens(); }, []);
  useEffect(() => { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); }, [view]);
  useEffect(() => { localStorage.setItem(NOTES_KEY, String(notesSize)); }, [notesSize]);
  useEffect(() => { localStorage.setItem(TARGET_KEY, String(target)); }, [target]);
  // 덱 iframe이 8초 안에 ready를 보내지 않으면 멈춘 것으로 알린다.
  useEffect(() => {
    if (!deck || info) return;
    const t = setTimeout(() => setStalled(true), 8000);
    return () => clearTimeout(t);
  }, [deck, info]);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  useEffect(() => { notesRef.current?.scrollTo({ top: 0 }); }, [pos.slide]);
  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); setWin(presentationOpen()); if (running) setElapsed((e) => e + 1); }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const post = (f: HTMLIFrameElement | null, msg: object) =>
    f?.contentWindow?.postMessage({ source: "slidekit", v: 1, ...msg }, location.origin);
  const send = (msg: object) => chan.current?.postMessage({ v: 1, from: me.current, ...msg });
  const total = info?.slides.length ?? 0;
  const goto = useCallback((slide: number, step = 1) => {
    if (ready.current) post(curRef.current, { type: "goto", slide, step });
    else pending.current = { slide, step };
  }, []);

  // BroadcastChannel: 발표 화면 창과 위치를 맞춘다.
  useEffect(() => {
    if (!deck) return;
    const ch = new BroadcastChannel(`slidekit:${deck.id}`);
    chan.current = ch;
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.v !== 1 || m.from === me.current) return;
      if (startFrom.current && !ready.current) return;
      if (m.type === "state") { lastKey.current = `${m.slide}:${m.step}`; goto(m.slide, m.step); }
      else if (m.type === "hello") send({ type: "state", ...posRef.current });
    };
    send({ type: "hello" });
    return () => { ch.close(); chan.current = null; };
  }, [deck, goto]);

  // iframe postMessage: 현재 슬라이드 iframe이 위치와 info의 원천이다.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (e.origin !== location.origin || m?.source !== "slidekit") return;
      if (e.source === nextRef.current?.contentWindow) {
        if (m.type === "ready") post(nextRef.current, { type: "goto", slide: posRef.current.slide + 1 });
        return;
      }
      if (e.source !== curRef.current?.contentWindow) return;
      if (m.type === "ready") {
        ready.current = true;
        setInfo(m.info);
        startFrom.current = null;
        const q = pending.current && { ...pending.current, slide: Math.min(Math.max(1, pending.current.slide), m.info.slides.length) };
        pending.current = null;
        if (q) { setPos(q); post(curRef.current, { type: "goto", slide: q.slide, step: q.step }); }
        else setPos({ slide: m.info.slide, step: m.info.step });
      } else if (m.type === "info") { setInfo(m.info); setPos({ slide: m.info.slide, step: m.info.step }); }
      else if (m.type === "state") {
        setPos({ slide: m.slide, step: m.step });
        const key = `${m.slide}:${m.step}`;
        if (key !== lastKey.current) { lastKey.current = key; send({ type: "state", slide: m.slide, step: m.step }); }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // 다음 슬라이드 미리보기는 slide+1의 1단계를 보여 준다.
  useEffect(() => { if (info && pos.slide < total) post(nextRef.current, { type: "goto", slide: pos.slide + 1 }); }, [pos.slide, info, total]);

  // 키 입력은 앱이 받는다. 방향키만 이동한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 길게 눌러 반복되는 입력은 이동, 전체화면, 타이머에서 무시한다(노트 크기와 스크롤은 반복 허용).
      const once = e.repeat;
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]")) return;
      // 화살표는 포커스된 위젯(탭, 스위치, 목록, 메뉴, 대화상자)의 것이고, 노트 영역에서 위아래는 노트 스크롤이다.
      const arrow = e.key.startsWith("Arrow");
      if (arrow && (t.closest("[role=tablist],[role=tab],[role=switch],[role=slider],[role=listbox],[role=combobox],[role=menu],[role=menuitem],[role=dialog]") || (t.closest("[data-notes]") && (e.key === "ArrowUp" || e.key === "ArrowDown")))) return;
      // 한 글자 단축키는 버튼과 링크에 포커스가 있을 때 쓰지 않는다(그 위젯의 입력과 겹치지 않게).
      if (!arrow && e.key.length === 1 && t.closest("button,a,[role=button],[role=tab],[role=switch],[role=menuitem]")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); if (!once) post(curRef.current, { type: "next" }); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); if (!once) post(curRef.current, { type: "prev" }); }
      else if (once && /^[ftr]$/i.test(e.key)) return;
      else if (e.key === "f" || e.key === "F") {
        document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      }
      else if (e.key === "+" || e.key === "=") setNotesSize((n) => Math.min(NOTES_MAX, n + 2));
      else if (e.key === "-" || e.key === "_") setNotesSize((n) => Math.max(NOTES_MIN, n - 2));
      else if (e.key === "t" || e.key === "T") setRunning((r) => !r);
      else if (e.key === "r" || e.key === "R") { setRunning(false); setElapsed(0); }
      else if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        const el = notesRef.current;
        el?.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * el.clientHeight * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const present = async () => { setErr(null); if (deck) setErr(await startPresentation(deck.folder, pos.slide, setErr)); };

  if (!deck) {
    if (load === "loading") return null;
    const back = <Button variant="secondary" size="compact" leadingIcon={ArrowLeft} onClick={() => go("/")}>Back to decks</Button>;
    return load === "error"
      ? <StatusPage role="alert" title="Could not load decks" actions={<>{back}<Button variant="primary" size="compact" onClick={() => location.reload()}>Retry</Button></>}>Check that the slidekit server is running.</StatusPage>
      : <StatusPage role="alert" title="Deck not found" actions={back}>No deck named {id} exists.</StatusPage>;
  }
  if (stalled && !info) {
    return <StatusPage role="alert" title="This deck did not respond" actions={<><Button variant="secondary" size="compact" leadingIcon={ArrowLeft} onClick={() => go("/")}>Back to decks</Button><Button variant="primary" size="compact" onClick={() => location.reload()}>Reload</Button></>}>The slides did not load. The deck file may have an error.</StatusPage>;
  }
  const slide = info?.slides[pos.slide - 1];
  const chapterNo = slide?.chapter ?? 0;
  const chapter = info?.chapters[chapterNo - 1];
  const src = deckUrl(deck.folder, "?embed=1");
    // 부모 칸의 폭과 화면 높이 58vh 안에서 16:9 상자를 가능한 크게 잡는다. 남는 높이는 노트가 쓴다.
  const frame = "relative aspect-video w-[min(100cqw,calc(var(--sh)*16/9))] overflow-hidden rounded-lg bg-black shadow-surface-3";
  const cell = "flex min-h-0 min-w-0 flex-col items-center gap-1 [container-type:inline-size]";
  const cap = "self-start text-caption text-muted-foreground";
  const steps = slide?.steps ?? 1;
  const remain = target ? target * 60 - elapsed : 0;

  return (
    <Shell
      bare={full}
      heading={deck.title}
      leftLabel="Chapters and slides"
      rightLabel="View settings"
      toolbar={
        <>
          <Tooltip content="All decks" side="bottom"><Button variant="ghost" size="icon-compact" aria-label="All decks" onClick={() => go("/")}><ArrowLeft /></Button></Tooltip>
          <span className="mr-auto truncate text-subtitle font-medium">{deck.title}</span>
          {err && <span role="status" className="truncate text-caption text-muted-foreground">{err}</span>}
          {win !== null && <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><span className={`size-1.5 rounded-full ${win ? "bg-green-500" : "bg-red-500"}`} />{win ? "Presentation window open" : "Presentation window closed"}</span>}
          <Button variant={win ? "secondary" : "primary"} size="compact" leadingIcon={MonitorPlay} onClick={present}>{win ? "Focus presentation" : "Present"}</Button>
        </>
      }
      left={
        info && (
          <Tabs defaultValue="chapters">
            <TabsList className="mx-2 mt-2">
              <TabItem value="chapters" label="Chapters" />
              <TabItem value="slides" label="Slides" />
            </TabsList>
            <TabPanel value="chapters">
              <SidebarMenu>
                {info.chapters.map((c, i) => (
                  <SidebarMenuItem key={c.n}>
                    <SidebarMenuButton isActive={i + 1 === chapterNo} aria-current={i + 1 === chapterNo ? "step" : undefined} onClick={() => goto(c.n)}>{c.title}</SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </TabPanel>
            <TabPanel value="slides">
              <SidebarMenu>
                {info.slides.map((s) => (
                  <SidebarMenuItem key={s.n}>
                    <SidebarMenuButton isActive={s.n === pos.slide} onClick={() => goto(s.n)}>{`${s.n}  ${s.title ?? s.kind}`}</SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </TabPanel>
          </Tabs>
        )
      }
      right={
        <SidebarGroup className="p-0">
          <SidebarGroupLabel>View</SidebarGroupLabel>
          <div className="flex flex-col gap-1 px-2">
            {(Object.keys(VIEW_ITEMS) as (keyof View)[]).map((k) => (
              <Switch key={k} label={VIEW_ITEMS[k]} checked={view[k]} onToggle={() => setView((v) => ({ ...v, [k]: !v[k] }))} />
            ))}
          </div>
          <SidebarGroupLabel className="mt-3">Shortcuts</SidebarGroupLabel>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 text-caption text-muted-foreground">
            {SHORTCUTS.map(([k, d]) => (<Fragment key={k}><dt className="text-foreground">{k}</dt><dd>{d}</dd></Fragment>))}
          </dl>
        </SidebarGroup>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        {/* 보기를 꺼도 iframe은 숨기기만 한다. 언마운트하면 방향키와 동기화가 끊긴다. */}
        {/* 넓으면 [현재 | 다음] 아래에 상태 줄, 900px 이하에서는 현재 위, 다음과 상태 줄이 그 아래 나란히 */}
        <div className="grid shrink-0 grid-cols-[5fr_2fr] gap-x-4 gap-y-3 [--sh:58vh] max-[900px]:grid-cols-2 max-[900px]:[--sh:34vh]">
          <div className={cn(cell, view.current ? "max-[900px]:col-span-2" : "hidden")}>
            <span className={cap}>Current</span>
            <div className={frame}><iframe ref={curRef} src={src} title="Current slide" className="pointer-events-none h-full w-full border-0" /></div>
          </div>
          <div className={cn(cell, view.next ? "" : "hidden")}>
            <span className={cap}>Next{steps > 1 ? `, step ${pos.step} / ${steps}` : ""}</span>
            <div className={frame}>
              <iframe ref={nextRef} src={src} title="Next slide" className="pointer-events-none h-full w-full border-0" />
              {info && pos.slide >= total && <div className="absolute inset-0 flex items-center justify-center bg-black text-caption text-muted-foreground">End of deck</div>}
            </div>
          </div>
          {(info || view.timer || view.clock || (view.chapters && chapter)) && (
            <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body tabular-nums">
              {info && <span className="text-subtitle font-medium">{pos.slide} / {total}</span>}
              {view.chapters && chapterNo > 0 && info && (
                <span className="flex min-w-0 items-baseline gap-2 text-muted-foreground max-[900px]:hidden">
                  <span className="shrink-0">Chapter {chapterNo} / {info.chapters.length}</span>
                  <span className="truncate">{chapter?.title}</span>
                </span>
              )}
              {view.timer && (
                <span className="ml-auto flex items-center gap-1">
                  <span role="timer" aria-label="Elapsed time" className="text-title font-medium">{hms(elapsed)}</span>
                  {target > 0 && <span className={cn("text-caption", remain < 0 ? "text-destructive" : "text-muted-foreground")}>{remain < 0 ? `+${mmss(-remain)} over` : `${mmss(remain)} left`}</span>}
                  <Tooltip content="Start or pause (T)" side="top"><Button variant="ghost" size="icon-compact" aria-label="Start or pause timer" onClick={() => setRunning((r) => !r)}>{running ? <Pause /> : <Play />}</Button></Tooltip>
                  <Tooltip content="Reset (R)" side="top"><Button variant="ghost" size="icon-compact" aria-label="Reset timer" onClick={() => { setRunning(false); setElapsed(0); }}><RotateCcw /></Button></Tooltip>
                  <Tooltip content="Target time in minutes" side="top">
                    <Field aria-label="Target minutes" inputMode="numeric" placeholder="Goal" className="w-14 px-1.5 text-right" value={target ? String(target) : ""}
                      onChange={(e) => setTarget(Math.min(999, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)))} />
                  </Tooltip>
                </span>
              )}
              {view.clock && <span className={cn("text-muted-foreground", !view.timer && "ml-auto")}>{`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`}</span>}
            </div>
          )}
          {info && total > 1 && (
            <div role="progressbar" aria-label="Slide progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={pos.slide} aria-valuetext={`Slide ${pos.slide} of ${total}`} className="col-span-2 h-1 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-foreground/60 transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${(pos.slide / total) * 100}%` }} />
            </div>
          )}
        </div>
        {view.notes && (
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-caption text-muted-foreground">Notes</span>
              <span className="flex items-center">
                <Tooltip content="Smaller notes (-)" side="top"><Button variant="ghost" size="icon-compact" aria-label="Smaller notes" disabled={notesSize <= NOTES_MIN} onClick={() => setNotesSize((n) => Math.max(NOTES_MIN, n - 2))}><Minus /></Button></Tooltip>
                <Tooltip content="Larger notes (+)" side="top"><Button variant="ghost" size="icon-compact" aria-label="Larger notes" disabled={notesSize >= NOTES_MAX} onClick={() => setNotesSize((n) => Math.min(NOTES_MAX, n + 2))}><Plus /></Button></Tooltip>
              </span>
            </div>
            <div
              ref={notesRef}
              tabIndex={0}
              data-notes=""
              aria-label="Speaker notes"
              style={{ fontSize: notesSize, lineHeight: 1.5 }}
              className="min-h-0 flex-1 overflow-auto rounded-lg text-foreground outline-none focus-visible:ring-1 focus-visible:ring-focus-ring [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_h1]:text-[1.4em] [&_h1]:font-semibold [&_h2]:text-[1.2em] [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_p+*]:mt-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-hover [&_pre]:p-2 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: slide?.notes ? markdown(slide.notes) : '<p class="text-caption text-muted-foreground">No notes</p>' }}
            />
          </div>
        )}
      </div>
    </Shell>
  );
}
