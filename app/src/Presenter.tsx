import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MonitorPlay, Pause, Play, RotateCcw } from "lucide-react";
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

const VIEW_KEY = "slidekit:view";
const NOTES_KEY = "slidekit:notes-size";
const NOTES_MIN = 14, NOTES_MAX = 56;
const VIEW_ITEMS = { current: "Current slide", next: "Next slide", notes: "Notes", timer: "Timer", clock: "Clock", chapters: "Chapters" } as const;
type View = Record<keyof typeof VIEW_ITEMS, boolean>;
const defaultView = Object.fromEntries(Object.keys(VIEW_ITEMS).map((k) => [k, true])) as View;

const SHORTCUTS = [["← →", "Move"], ["F", "Full screen"], ["+ -", "Notes size"], ["PgUp PgDn", "Scroll notes"], ["T", "Start or pause timer"], ["R", "Reset timer"]];
const pad = (n: number) => String(n).padStart(2, "0");
const hms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
const rid = () => Math.random().toString(36).slice(2, 8);

export function Presenter({ id }: { id: string }) {
  const [deck, setDeck] = useState<DeckEntry | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [pos, setPos] = useState<Pos>({ slide: 1, step: 1 });
  const [view, setView] = useState<View>(() => ({ ...defaultView, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") }));
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const [win, setWin] = useState<boolean | null>(presentationOpen);
  const [notesSize, setNotesSize] = useState(() => Number(localStorage.getItem(NOTES_KEY)) || 20);
  const notesRef = useRef<HTMLDivElement>(null);

  const curRef = useRef<HTMLIFrameElement>(null);
  const nextRef = useRef<HTMLIFrameElement>(null);
  const chan = useRef<BroadcastChannel | null>(null);
  const me = useRef(rid());
  const posRef = useRef(pos);
  const lastKey = useRef("");
  posRef.current = pos;

  useEffect(() => { fetch("/api/decks").then((r) => r.json()).then((l: DeckEntry[]) => setDeck(l.find((d) => d.id === id) ?? null)); }, [id]);
  useEffect(() => { warmScreens(); }, []);
  useEffect(() => { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); }, [view]);
  useEffect(() => { localStorage.setItem(NOTES_KEY, String(notesSize)); }, [notesSize]);
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
  const goto = useCallback((slide: number, step = 1) => post(curRef.current, { type: "goto", slide, step }), []);

  // BroadcastChannel: 발표 화면 창과 위치를 맞춘다.
  useEffect(() => {
    if (!deck) return;
    const ch = new BroadcastChannel(`slidekit:${deck.id}`);
    chan.current = ch;
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.v !== 1 || m.from === me.current) return;
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
      if (m.type === "ready" || m.type === "info") { setInfo(m.info); setPos({ slide: m.info.slide, step: m.info.step }); }
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
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); post(curRef.current, { type: "next" }); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); post(curRef.current, { type: "prev" }); }
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
        el?.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * el.clientHeight * 0.8, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const present = async () => setErr(deck ? await startPresentation(deck.folder) : null);

  if (!deck) return null;
  const slide = info?.slides[pos.slide - 1];
  const chapterNo = slide?.chapter ?? 0;
  const chapter = info?.chapters[chapterNo - 1];
  const src = deckUrl(deck.folder, "?embed=1");
  // 부모 칸(container-type:size)에 맞춰 16:9 상자를 가능한 크게 잡는다.
const frame = "aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden rounded-lg bg-black shadow-surface-3";
const cell = "flex min-h-0 min-w-0 items-center justify-center [container-type:size]";

  return (
    <Shell
      bare={full}
      toolbar={
        <>
          <Tooltip content="All decks" side="bottom"><Button variant="ghost" size="icon-compact" aria-label="All decks" onClick={() => go("/")}><ArrowLeft /></Button></Tooltip>
          <span className="truncate text-subtitle font-medium">{deck.title}</span>
          <span className="ml-auto text-caption text-muted-foreground tabular-nums">{info ? `${pos.slide} / ${total}` : ""}</span>
          {err && <span className="text-caption text-muted-foreground">{err}</span>}
          {win !== null && <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><span className={`size-1.5 rounded-full ${win ? "bg-green-500" : "bg-red-500"}`} />{win ? "Presentation window open" : "Presentation window closed"}</span>}
          <Button variant="primary" size="compact" leadingIcon={MonitorPlay} onClick={present}>Present</Button>
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
                    <SidebarMenuButton isActive={i + 1 === chapterNo} onClick={() => goto(c.n)}>{c.title}</SidebarMenuButton>
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
        {(view.current || view.next) && (
          <div className="flex min-h-0 flex-[3] gap-4">
            <div className={cn(cell, view.current ? "flex-[5]" : "hidden")}>
              <div className={frame}><iframe ref={curRef} src={src} title="Current slide" className="pointer-events-none h-full w-full border-0" /></div>
            </div>
            <div className={cn(cell, view.next ? "flex-[2]" : "hidden")}>
              <div className={frame}><iframe ref={nextRef} src={src} title="Next slide" className="pointer-events-none h-full w-full border-0" /></div>
            </div>
          </div>
        )}
        {(view.timer || view.clock || (view.chapters && chapter)) && (
          <div className="flex shrink-0 items-center gap-6 text-body tabular-nums">
            {view.chapters && <span>{chapterNo > 0 && info ? `Chapter ${chapterNo} / ${info.chapters.length}  ${chapter?.title}` : ""}</span>}
            {view.timer && (
              <span className="ml-auto flex items-center gap-1">
                {hms(elapsed)}
                <Tooltip content="Start or pause (T)" side="top"><Button variant="ghost" size="icon-compact" aria-label="Start or pause timer" onClick={() => setRunning((r) => !r)}>{running ? <Pause /> : <Play />}</Button></Tooltip>
                <Tooltip content="Reset (R)" side="top"><Button variant="ghost" size="icon-compact" aria-label="Reset timer" onClick={() => { setRunning(false); setElapsed(0); }}><RotateCcw /></Button></Tooltip>
              </span>
            )}
            {view.clock && <span className={view.timer ? "" : "ml-auto"}>{`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`}</span>}
          </div>
        )}
        {view.notes && (
          <div
            ref={notesRef}
            tabIndex={0}
            aria-label="Speaker notes"
            style={{ fontSize: notesSize, lineHeight: 1.5 }}
            className="min-h-0 flex-[2] overflow-auto rounded-lg text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p+*]:mt-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-hover [&_pre]:p-2 [&_strong]:text-foreground [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: slide?.notes ? markdown(slide.notes) : "<p>No notes</p>" }}
          />
        )}
      </div>
    </Shell>
  );
}
