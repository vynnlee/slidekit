import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, MonitorPlay } from "lucide-react";
import { TextArea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Shell } from "./Shell";
import { Canvas, textual, type CanvasApi } from "./Canvas";
import { Filmstrip } from "./Filmstrip";
import { LayerTree } from "./LayerTree";
import { Inspector } from "./Inspector";
import { go } from "./App";
import { byPath, compose, duplicateHtml, newKey, newSlideHtml, pathOf, splitDeck, type Unit } from "@/lib/deck-source";
import { ExportMenu } from "./ExportMenu";
import { startPresentation } from "@/lib/present";
import type { Comment, DeckEntry } from "@/lib/deck";

const KEYS: [string, string][] = [
  ["Cmd+S", "Save"], ["Cmd+Z", "Undo"], ["Shift+Cmd+Z", "Redo"], ["Delete", "Delete selection"], ["Cmd+D", "Duplicate"],
  ["Up, Down", "Go to slide"], ["Double-click", "Edit text"], ["Enter", "Finish editing"], ["Esc", "Deselect"], ["Tab", "Select next element"], ["Cmd+Scroll, Cmd+0", "Zoom, fit"], ["Cmd+Enter", "Present from this slide"], ["Shift+Cmd+Enter", "Present from the start"], ["Cmd+\\", "Toggle panels"], ["Shift+Cmd+\\", "Toggle filmstrip"], ["Cmd+E", "Toggle notes"], ["Cmd+/", "Shortcuts"],
];
// 슬라이드 원문에서 노트(aside[data-notes])의 글자만 꺼낸다. 앞뒤 공백은 보기용으로만 뗀다.
const noteOf = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.querySelector("aside[data-notes]")?.textContent?.trim() ?? "";
};
type Shell_ = { prefix: string; suffix: string };

export function Editor({ id }: { id: string }) {
  const [deck, setDeck] = useState<DeckEntry | null>(null);
  const [shell, setShell] = useState<Shell_ | null>(null);
  const [units, setUnitsState] = useState<Unit[]>([]);
  const [index, setIndexState] = useState(0);
  const [sel, setSel] = useState<Element | null>(null);
  const [selId, setSelId] = useState(0);
  const [tab, setTab] = useState("props");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [changed, setChanged] = useState(false); // 열어 둔 사이 파일이 밖에서 바뀜
  const [help, setHelp] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(() => localStorage.getItem("slidekit:notesOpen") !== "0");
  const [notesH, setNotesH] = useState(() => Number(localStorage.getItem("slidekit:notesH")) || 140);
  useEffect(() => { localStorage.setItem("slidekit:notesOpen", notesOpen ? "1" : "0"); }, [notesOpen]);
  useEffect(() => { localStorage.setItem("slidekit:notesH", String(notesH)); }, [notesH]);
  useEffect(() => { setDraft(null); }, [index, selId]);

  const canvas = useRef<CanvasApi>(null);
  const unitsRef = useRef<Unit[]>([]), indexRef = useRef(0), shellRef = useRef<Shell_ | null>(null);
  const savedRef = useRef(""), mtime = useRef(0);
  const origin = useRef(new Map<string, number>()); // 슬라이드 key -> 마지막 저장(불러오기) 때의 번호. 코멘트 번호가 이 기준이다
  const prefixOf = useRef(new WeakMap<Unit[], string>()); // 실행 취소 기록이 가리키는 시점의 덱 head
  const past = useRef<Unit[][]>([]), future = useRef<Unit[][]>([]);
  const last = useRef<{ key: string; t: number } | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  unitsRef.current = units; indexRef.current = index; shellRef.current = shell;

  const folder = deck?.folder ?? "";
  const text = useMemo(() => (shell ? compose({ ...shell, units }) : ""), [shell, units]);
  const dirty = !!shell && text !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 자동 저장: 편집 뒤 1.5초 동안 입력이 없으면 저장한다. 충돌(409)이나 실패 뒤에는 멈추고 사용자가 고른다.
  useEffect(() => {
    if (!dirty || changed || status === "error") return;
    const t = setTimeout(() => { save(); }, 1500);
    return () => clearTimeout(t);
  }, [text, dirty, changed, status]); // eslint-disable-line

  // 불러오기
  const load = useCallback(async (folder: string, keepIndex = 0) => {
    const res = await fetch(`/api/decks/${folder}/source`);
    if (!res.ok) throw new Error(`Could not load the deck (${res.status})`);
    const r = await res.json();
    const d = splitDeck(r.source);
    past.current = []; future.current = [];
    savedRef.current = r.source; mtime.current = r.mtime;
    setSaved(r.source); setChanged(false); setSel(null);
    const i = Math.min(keepIndex, d.units.length - 1);
    unitsRef.current = d.units;
    origin.current = new Map(d.units.map((u, i) => [u.key, i + 1]));
    setShell({ prefix: d.prefix, suffix: d.suffix }); setUnitsState(d.units); setIndexState(i); indexRef.current = i;
    canvas.current?.apply(d.units);
  }, []);

  useEffect(() => {
    fetch("/api/decks").then((r) => { if (!r.ok) throw new Error(`Could not load decks (${r.status})`); return r.json(); }).then((l: DeckEntry[]) => {
      const d = l.find((x) => x.id === id) ?? null;
      setDeck(d);
      if (d) {
        load(d.folder).catch((e) => setErr(String(e)));
        fetch(`/api/comments?deck=${d.folder}`).then((r) => { if (!r.ok) throw new Error(`Could not load comments (${r.status})`); return r.json(); }).then(setComments).catch((e) => setErr(String(e.message ?? e)));
      }
    }).catch((e) => setErr(String(e.message ?? e)));
  }, [id, load]);

  // 코멘트와 파일 변경 이벤트(SSE)
  useEffect(() => {
    if (!folder) return;
    const es = new EventSource("/api/events");
    const on = (type: string, fn: (d: any) => void) => es.addEventListener(type, (e) => {
      try { const d = JSON.parse((e as MessageEvent).data); if (d.deck === folder) fn(d); } catch {}
    });
    const upsert = (c: Comment) => setComments((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]));
    on("comment", (d) => upsert(d.comment));
    on("reply", (d) => upsert(d.comment));
    on("comments", (d) => setComments(d.comments));
    on("deck-changed", async () => {
      try {
        const res = await fetch(`/api/decks/${folder}/source`);
        if (!res.ok) throw new Error(`Could not check the file (${res.status})`);
        const r = await res.json();
        if (r.source === savedRef.current) return; // 우리가 쓴 저장
        if (dirtyRef.current) setChanged(true);
        else await load(folder, indexRef.current);
      } catch (e: any) { setErr(String(e.message ?? e)); }
    });
    return () => es.close();
  }, [folder, load]);

  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, []);

  // 기록. 같은 coalesce 키가 0.8초 안에 이어지면 하나로 묶는다.
  const scrub = useRef(false); // 숫자 필드를 끄는 동안은 한 번의 실행 취소로 묶는다
  const record = (coalesce?: string) => {
    const now = Date.now();
    if (!(coalesce && last.current?.key === coalesce && (scrub.current || now - last.current.t < 800))) {
      past.current.push(unitsRef.current);
      if (shellRef.current) prefixOf.current.set(unitsRef.current, shellRef.current.prefix);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
    }
    last.current = coalesce ? { key: coalesce, t: now } : null;
  };
  const setUnits = (next: Unit[]) => { unitsRef.current = next; setUnitsState(next); };
  const pickSel = (el: Element | null) => { setSel(el); setSelId((n) => n + 1); };
  const setIndex = (i: number) => {
    i = Math.max(0, Math.min(unitsRef.current.length - 1, i));
    if (i === indexRef.current) return;
    indexRef.current = i; setIndexState(i); pickSel(null);
  };

  // 캔버스에서 일어난 편집을 모델에 반영한다.
  const commit = (coalesce?: string) => {
    const i = indexRef.current, u = unitsRef.current[i], html = canvas.current?.serialize(i);
    if (!u || !html || html === u.html) return;
    record(coalesce);
    canvas.current!.mark(u.key, html);
    setUnits(unitsRef.current.map((x, k) => (k === i ? { ...x, html } : x)));
  };
  const structure = (next: Unit[], to: number) => {
    record();
    setUnits(next);
    canvas.current?.apply(next);
    indexRef.current = Math.max(0, Math.min(next.length - 1, to)); setIndexState(indexRef.current); pickSel(null);
  };
  const restore = (from: Unit[][], to: Unit[][]) => {
    const prev = from.pop();
    if (!prev) return;
    to.push(unitsRef.current);
    if (shellRef.current) prefixOf.current.set(unitsRef.current, shellRef.current.prefix);
    last.current = null;
    setUnits(prev);
    const pf = prefixOf.current.get(prev);
    if (pf !== undefined && shellRef.current && pf !== shellRef.current.prefix) setShell({ ...shellRef.current, prefix: pf });
    else canvas.current?.apply(prev);
    const keep = sel && canvas.current?.slide(indexRef.current) ? pathOf(canvas.current.slide(indexRef.current)!, sel) : null;
    indexRef.current = Math.min(indexRef.current, prev.length - 1); setIndexState(indexRef.current);
    const s = canvas.current?.slide(indexRef.current);
    pickSel(keep && s ? byPath(s, keep) : null); // 되돌린 뒤에도 같은 요소를 선택해 둔다
  };

  // 덱 토큰(:root 변수) 변경은 head를 바꾸므로 한 번의 실행 취소 단위로 기록한다.
  const changePrefix = (next: string) => {
    const sh = shellRef.current;
    if (!sh || next === sh.prefix) return;
    record();
    setUnits([...unitsRef.current]);
    setShell({ ...sh, prefix: next });
  };
  const shownPrefix = useRef<string | null>(null);
  useEffect(() => {
    if (shownPrefix.current !== null && shell && shownPrefix.current !== shell.prefix) canvas.current?.reload();
    shownPrefix.current = shell?.prefix ?? null;
  }, [shell?.prefix]); // eslint-disable-line

  const moveSlide = (from: number, to: number) => {
    if (from === to) return;
    const a = [...unitsRef.current], [u] = a.splice(from, 1);
    a.splice(to, 0, u);
    structure(a, to);
  };
  const dupSlide = (i: number) => {
    const a = [...unitsRef.current], u = a[i];
    a.splice(i + 1, 0, { key: newKey(), gap: u.gap, html: duplicateHtml(u.html) });
    structure(a, i + 1);
  };
  const addSlide = (i: number) => {
    const a = [...unitsRef.current];
    a.splice(i + 1, 0, { key: newKey(), gap: a[i].gap, html: newSlideHtml() });
    structure(a, i + 1);
  };
  const delSlide = (i: number) => {
    if (unitsRef.current.length < 2) return;
    structure(unitsRef.current.filter((_, k) => k !== i), Math.min(i, unitsRef.current.length - 2));
  };
  const delSelected = () => {
    if (!sel) return delSlide(indexRef.current);
    sel.remove(); pickSel(null); commit();
  };
  const [filmCollapsed, setFilmCollapsed] = useState(() => localStorage.getItem("slidekit.filmstrip.collapsed") === "1");
  const toggleFilm = () => setFilmCollapsed((v) => { localStorage.setItem("slidekit.filmstrip.collapsed", v ? "0" : "1"); return !v; });
  const clip = useRef("");
  const copySel = () => {
    if (!sel) return;
    clip.current = sel.outerHTML;
    const b = (t: string) => new Blob([clip.current], { type: t });
    navigator.clipboard?.write?.([new ClipboardItem({ "text/html": b("text/html"), "text/plain": b("text/plain") })]).catch(() => {});
  };
  const pasteSel = () => {
    const s = canvas.current?.slide(indexRef.current);
    if (!s || !clip.current) return;
    const t = s.ownerDocument.createElement("template");
    t.innerHTML = clip.current;
    const n = t.content.firstElementChild;
    if (!n) return;
    n.removeAttribute("id");
    if (sel && s.contains(sel)) sel.after(n);
    else { const a = s.querySelector(":scope > aside[data-notes]"); if (a) a.before(n); else s.append(n); }
    pickSel(n); commit();
  };
  const toggleHidden = (el: HTMLElement) => { if (el.style.display === "none") el.style.removeProperty("display"); else el.style.setProperty("display", "none"); pickSel(sel); commit(); };
  const renameEl = (el: Element, name: string) => { if (name) el.setAttribute("data-name", name); else el.removeAttribute("data-name"); pickSel(sel); commit(); };
  const moveEl = (el: Element, target: Element, after: boolean) => {
    if (el.contains(target) || !target.parentElement) return;
    if (after) target.after(el); else target.before(el);
    pickSel(el); commit();
  };
  const emphasis = (k: string) => {
    if (canvas.current?.format(k === "b" ? "strong" : "em") || !sel) return;
    const c = sel.ownerDocument.defaultView!.getComputedStyle(sel);
    if (k === "b") style("font-weight", +c.fontWeight >= 600 ? "400" : "700"); else style("font-style", c.fontStyle === "italic" ? "normal" : "italic");
  };
  const dupSelected = () => {
    if (!sel) return dupSlide(indexRef.current);
    const c = sel.cloneNode(true) as Element;
    c.removeAttribute("id");
    sel.after(c); pickSel(c); commit();
  };

  // Tab: 선택 가능한 요소(글자 요소, 도식, 이미지)를 문서 순서로 돈다.
  const cycle = (dir: 1 | -1) => {
    const s = canvas.current?.slide(indexRef.current);
    if (!s) return;
    const all = [...s.querySelectorAll("*")].filter((e) =>
      !e.closest("aside[data-notes]") &&
      (e.tagName === "svg" ? !e.parentElement?.closest("svg")
        : !e.closest("svg") && (e.tagName === "IMG" || (textual(e) && !(e.parentElement && textual(e.parentElement))))));
    if (!all.length) return;
    const i = sel ? all.indexOf(sel) : -1;
    pickSel(all[i < 0 ? (dir > 0 ? 0 : all.length - 1) : (i + dir + all.length) % all.length]);
  };
  const style = (prop: string, v: string) => { const el = sel as HTMLElement | null; if (!el) return; if (v) el.style.setProperty(prop, v); else el.style.removeProperty(prop); commit("style:" + prop); };
  const elAttr = (name: string, v: string | null) => { const el = sel as HTMLElement | null; if (!el) return; if (v === null) el.removeAttribute(name); else el.setAttribute(name, v); pickSel(el); commit("elattr:" + name); };
  const slideStyle = (prop: string, v: string) => { const s = canvas.current?.slide(indexRef.current); if (!s) return; if (v) s.style.setProperty(prop, v); else s.style.removeProperty(prop); commit("slide:" + prop); };
  const attr = (name: string, v: string | null) => {
    const s = canvas.current?.slide(indexRef.current);
    if (!s) return;
    if (v === null) s.removeAttribute(name); else s.setAttribute(name, v);
    commit("attr:" + name);
  };
  const notes = (t: string) => {
    const s = canvas.current?.slide(indexRef.current);
    if (!s) return;
    let a = s.querySelector(":scope > aside[data-notes]");
    if (!t.trim()) a?.remove();
    else {
      if (!a) { a = document.createElement("aside"); a.setAttribute("data-notes", ""); s.appendChild(a); }
      a.textContent = t;
    }
    commit("notes");
  };

  // 저장: 임시 파일에 쓰고 rename은 서버가 한다. 읽은 뒤 파일이 바뀌었으면 409.
  // 저장 요청은 한 번에 하나만 보낸다(자동 저장과 Cmd+S가 겹치면 낡은 base로 409가 나기 때문).
  const inflight = useRef<Promise<boolean> | null>(null);
  const save = async (force = false): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    const p = doSave(force);
    inflight.current = p;
    try { return await p; } finally { inflight.current = null; }
  };
  const doSave = async (force: boolean) => {
    if (!deck || !shellRef.current) return true;
    const us = unitsRef.current;
    const body = compose({ ...shellRef.current, units: us });
    if (!force && body === savedRef.current) return true;
    const slideMap: Record<number, number> = {};
    us.forEach((u, i) => { const o = origin.current.get(u.key); if (o && !(o in slideMap)) slideMap[o] = i + 1; });
    setStatus("saving");
    const prev = savedRef.current;
    savedRef.current = body;
    try {
      const r = await fetch(`/api/decks/${deck.folder}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: body, base: mtime.current, force, slideMap }),
      });
      if (r.status === 409) { savedRef.current = prev; setChanged(true); setStatus("idle"); return false; }
      if (!r.ok) throw new Error(String(r.status));
      mtime.current = (await r.json()).mtime;
      origin.current = new Map(us.map((u, i) => [u.key, i + 1]));
      setSaved(body); setChanged(false); setStatus("idle");
      return true;
    } catch {
      savedRef.current = prev; setStatus("error");
      return false;
    }
  };

  const postComment = async (t: string) => {
    if (!deck || !sel || !t || !(await save())) return; // 번호가 파일과 맞도록 먼저 저장한다
    const s = canvas.current?.slide(indexRef.current);
    if (!s) return;
    const body = { deck: deck.folder, slide: indexRef.current + 1, path: pathOf(s, sel), excerpt: (sel.textContent ?? "").trim().slice(0, 80), text: t };
    const r = await fetch("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return setErr("Could not send the comment");
    const { id } = await r.json();
    setComments((l) => (l.some((c) => c.id === id) ? l : [...l, { id, slide: body.slide, path: body.path, excerpt: body.excerpt, text: t, status: "open", createdAt: new Date().toISOString() }]));
    setTab("comments");
  };
  const slideOf = (n: number) => unitsRef.current.findIndex((u) => origin.current.get(u.key) === n);
  const jump = (c: Comment) => {
    const i = slideOf(c.slide);
    if (c.slideDeleted || i < 0) return;
    setIndex(i);
    const s = canvas.current?.slide(i);
    pickSel((s && byPath(s, c.path)) ?? null);
  };

  keyRef.current = (e) => {
    const t = e.target as HTMLElement, mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (!!t.closest?.('[role=dialog],[role=menu],[role=listbox],[role=radiogroup]') && !t.closest?.('[data-testid=filmstrip]')); // 슬라이드 필름스트립은 편집기 단축키(실행 취소 등)를 그대로 쓴다
    if (mod && k === "\\" && e.view !== window) {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", metaKey: e.metaKey, ctrlKey: e.ctrlKey, cancelable: true }));
    } else if (mod && k === "s") { e.preventDefault(); save(); }
    else if (mod && k === "e") { e.preventDefault(); setNotesOpen((v) => !v); }
    else if (mod && e.shiftKey && (k === "|" || k === "\\")) { e.preventDefault(); toggleFilm(); }
    else if (mod && k === "/") { e.preventDefault(); setHelp((v) => !v); }
    else if (mod && e.key === "Enter") { e.preventDefault(); present(e.shiftKey); }
    else if (mod && (k === "b" || k === "i") && !/^(INPUT|TEXTAREA)$/.test(t.tagName) && (sel || t.isContentEditable || e.view !== window)) { e.preventDefault(); emphasis(k); }
    else if (typing) return;
    else if (mod && k === "c" && sel) { e.preventDefault(); copySel(); }
    else if (mod && k === "v" && clip.current) { e.preventDefault(); pasteSel(); }
    else if (mod && k === "0") { e.preventDefault(); canvas.current?.zoom(0); }
    else if (mod && (k === "=" || k === "+")) { e.preventDefault(); canvas.current?.zoom(1); }
    else if (mod && k === "-") { e.preventDefault(); canvas.current?.zoom(-1); }
    else if (!mod && e.key === "Tab") { if (e.view === window && t !== document.body) return; e.preventDefault(); cycle(e.shiftKey ? -1 : 1); } // 패널 안에서는 브라우저의 Tab 이동을 지킨다
    else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? restore(future.current, past.current) : restore(past.current, future.current); }
    else if (mod && k === "d") { e.preventDefault(); dupSelected(); }
    else if (!mod && (e.key === "Delete" || e.key === "Backspace")) { if (!sel) return; e.preventDefault(); delSelected(); }
    else if (!mod && e.key === "Escape") pickSel(null);
    else if (!mod && (e.key === "ArrowDown" || e.key === "ArrowRight")) { e.preventDefault(); setIndex(indexRef.current + 1); }
    else if (!mod && (e.key === "ArrowUp" || e.key === "ArrowLeft")) { e.preventDefault(); setIndex(indexRef.current - 1); }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (!deck || !shell) return err ? <p className="p-4 text-caption text-muted-foreground">{err}</p> : null;

  const present = async (fromStart = false) => {
    if (!(await save())) return;
    setErr(await startPresentation(deck.folder, fromStart ? 1 : indexRef.current + 1));
    go(`/present/${encodeURIComponent(deck.id)}`);
  };
  const back = async () => { if (await save()) go("/"); };
  const label = status === "saving" ? "Saving..." : dirty ? "Unsaved" : "Saved";

  return (
    <>
      <Shell
        heading={deck.title} leftLabel="Layers" rightLabel="Properties"
        toolbar={
          <>
            <Tooltip content="Decks" side="bottom"><Button aria-label="Decks" variant="ghost" size="icon-compact" onClick={back}><ArrowLeft /></Button></Tooltip>
            <span className="truncate text-subtitle font-medium">{deck.title}</span>
            {status === "error"
              ? <Button variant="ghost" size="compact" onClick={() => save()}>Save failed. Retry</Button>
              : <span className="text-caption text-muted-foreground">{label}</span>}
            {changed && (
              <>
                <span className="text-caption text-muted-foreground">File changed outside the editor</span>
                <Button variant="ghost" size="compact" onClick={() => load(deck.folder, indexRef.current)}>Reload</Button>
                <Button variant="ghost" size="compact" onClick={() => save(true)}>Overwrite</Button>
              </>
            )}
            {err && <span className="text-caption text-muted-foreground">{err}</span>}
            <span className="ml-auto" />
            {dirty && !changed && <Button variant="ghost" size="compact" onClick={() => save()}>Save</Button>}
            <ExportMenu folder={deck.folder} dirty={dirty} onSave={() => save()} />
            <Button variant="primary" size="compact" leadingIcon={MonitorPlay} onClick={() => present()}>Present</Button>
          </>
        }
        left={
          <div className="flex h-full flex-col">
            <div className="shrink-0 px-3 pt-2 text-caption font-semibold">Layers</div>
            <div className="min-h-0 flex-1 overflow-auto">
              <LayerTree slide={canvas.current?.slide(index) ?? null} sel={sel} rev={units} slideName={canvas.current?.slide(index)?.getAttribute("data-title") || `Slide ${index + 1}`} onSelectSlide={() => pickSel(null)} onSelect={pickSel} onHover={(el) => canvas.current?.hover(el)}
                onToggleHidden={toggleHidden} onRename={renameEl} onMove={moveEl} />
            </div>
          </div>
        }
        right={
          <Inspector sel={sel} slide={canvas.current?.slide(index) ?? null} selId={selId} tab={tab} onTab={setTab}
            comments={comments} onJump={jump} onStyle={style} onAttr={attr} onElAttr={elAttr} onShowLayers={() => {}} prefix={shell.prefix} onPrefixChange={changePrefix} canvasDoc={canvas.current?.document() ?? null} onSlideStyle={slideStyle} onScrub={(b) => { scrub.current = b; last.current = null; }} />
        }
      >
        <div className="flex h-full flex-col">
        <Filmstrip shell={shell} folder={folder} units={units} index={index}
          marked={new Set(comments.filter((c) => !c.slideDeleted && c.status === "open").map((c) => c.slide))} origin={origin.current}
          collapsed={filmCollapsed} onToggle={toggleFilm}
          onSelect={setIndex} onMove={moveSlide} onDuplicate={dupSlide} onDelete={delSlide} onAdd={addSlide} />
        <div className="min-h-0 flex-1 bg-[var(--canvas-bg)]">
        <Canvas ref={canvas} shell={shell} folder={folder} units={units} index={index} sel={sel}
          comments={comments.filter((c) => !c.slideDeleted && c.slide === origin.current.get(units[index]?.key ?? ""))}
          onSel={pickSel} onReady={() => pickSel(null)} onCommit={commit} onKey={(e) => keyRef.current(e)} onDelete={delSelected}
          onComment={postComment} onMarker={(cid) => { setTab("comments"); const c = comments.find((x) => x.id === cid); if (c) jump(c); }} />
        </div>
        <div className="shrink-0 border-t border-border" style={{ height: notesOpen ? notesH : undefined }}>
          {notesOpen && (
            <div
              className="-mt-1 h-2 cursor-row-resize"
              onPointerDown={(e) => {
                const y0 = e.clientY, h0 = notesH;
                const mv = (m: PointerEvent) => setNotesH(Math.max(64, Math.min(window.innerHeight * 0.6, h0 + y0 - m.clientY)));
                const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
                window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
              }}
            />
          )}
          <div className="flex h-7 items-center gap-1 px-3">
            <span className="text-caption text-muted-foreground">Notes</span>
            <span className="ml-auto" />
            <Tooltip content="Toggle notes Cmd+E" side="top">
              <Button aria-label="Toggle notes" variant="ghost" size="icon-compact" onClick={() => setNotesOpen((v) => !v)}>{notesOpen ? <ChevronDown /> : <ChevronUp />}</Button>
            </Tooltip>
          </div>
          {notesOpen && (
            <div className="px-2 pb-2" style={{ height: notesH - 36 }}>
              <TextArea
                className="h-full"
                placeholder="Speaker notes (Markdown)"
                value={draft?.key === units[index]?.key ? draft.text : noteOf(units[index]?.html ?? "")}
                onChange={(e) => { setDraft({ key: units[index].key, text: e.target.value }); notes(e.target.value); }}
              />
            </div>
          )}
        </div>
        </div>
      </Shell>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent size="sm">
          <DialogTitle>Shortcuts</DialogTitle>
          <div className="flex flex-col gap-1 pt-2">
            {KEYS.map(([k, v]) => (
              <div key={k} className="flex justify-between text-body"><span className="text-muted-foreground">{v}</span><span>{k}</span></div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
