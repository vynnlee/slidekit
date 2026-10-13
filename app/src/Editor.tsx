import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Shell } from "./Shell";
import { Canvas, type CanvasApi } from "./Canvas";
import { Layers } from "./Layers";
import { Inspector } from "./Inspector";
import { go } from "./App";
import { byPath, compose, duplicateHtml, newKey, newSlideHtml, pathOf, splitDeck, type Unit } from "@/lib/deck-source";
import { startPresentation } from "@/lib/present";
import type { Comment, DeckEntry } from "@/lib/deck";

const KEYS: [string, string][] = [
  ["Cmd+S", "저장"], ["Cmd+Z", "실행 취소"], ["Shift+Cmd+Z", "다시 실행"], ["Delete", "선택 삭제"], ["Cmd+D", "복제"],
  ["위 아래 방향키", "슬라이드 이동"], ["더블클릭", "텍스트 편집"], ["Enter", "편집 끝"], ["Esc", "선택 해제"], ["Cmd+\\", "패널 접기"], ["Cmd+/", "단축키 안내"],
];
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

  const canvas = useRef<CanvasApi>(null);
  const unitsRef = useRef<Unit[]>([]), indexRef = useRef(0), shellRef = useRef<Shell_ | null>(null);
  const savedRef = useRef(""), mtime = useRef(0);
  const past = useRef<Unit[][]>([]), future = useRef<Unit[][]>([]);
  const last = useRef<{ key: string; t: number } | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  unitsRef.current = units; indexRef.current = index; shellRef.current = shell;

  const folder = deck?.folder ?? "";
  const text = useMemo(() => (shell ? compose({ ...shell, units }) : ""), [shell, units]);
  const dirty = !!shell && text !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 불러오기
  const load = useCallback(async (folder: string, keepIndex = 0) => {
    const r = await fetch(`/api/decks/${folder}/source`).then((r) => r.json());
    const d = splitDeck(r.source);
    past.current = []; future.current = [];
    savedRef.current = r.source; mtime.current = r.mtime;
    setSaved(r.source); setChanged(false); setSel(null);
    const i = Math.min(keepIndex, d.units.length - 1);
    unitsRef.current = d.units;
    setShell({ prefix: d.prefix, suffix: d.suffix }); setUnitsState(d.units); setIndexState(i); indexRef.current = i;
    canvas.current?.apply(d.units);
  }, []);

  useEffect(() => {
    fetch("/api/decks").then((r) => r.json()).then((l: DeckEntry[]) => {
      const d = l.find((x) => x.id === id) ?? null;
      setDeck(d);
      if (d) {
        load(d.folder).catch((e) => setErr(String(e)));
        fetch(`/api/comments?deck=${d.folder}`).then((r) => (r.ok ? r.json() : [])).then(setComments).catch(() => {});
      }
    });
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
    on("deck-changed", async () => {
      const r = await fetch(`/api/decks/${folder}/source`).then((r) => r.json());
      if (r.source === savedRef.current) return; // 우리가 쓴 저장
      if (dirtyRef.current) setChanged(true);
      else load(folder, indexRef.current);
    });
    return () => es.close();
  }, [folder, load]);

  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, []);

  // 기록. 같은 coalesce 키가 0.8초 안에 이어지면 하나로 묶는다.
  const record = (coalesce?: string) => {
    const now = Date.now();
    if (!(coalesce && last.current?.key === coalesce && now - last.current.t < 800)) {
      past.current.push(unitsRef.current);
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
    last.current = null;
    setUnits(prev);
    canvas.current?.apply(prev);
    indexRef.current = Math.min(indexRef.current, prev.length - 1); setIndexState(indexRef.current); pickSel(null);
  };

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
  const dupSelected = () => {
    if (!sel) return dupSlide(indexRef.current);
    const c = sel.cloneNode(true) as Element;
    c.removeAttribute("id");
    sel.after(c); pickSel(c); commit();
  };

  const style = (prop: string, v: string) => { (sel as HTMLElement | null)?.style.setProperty(prop, v); commit("style:" + prop); };
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
  const save = async (force = false) => {
    if (!deck || !shellRef.current || (!dirtyRef.current && !force)) return true;
    const body = compose({ ...shellRef.current, units: unitsRef.current });
    setStatus("saving");
    const prev = savedRef.current;
    savedRef.current = body;
    try {
      const r = await fetch(`/api/decks/${deck.folder}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: body, base: mtime.current, force }),
      });
      if (r.status === 409) { savedRef.current = prev; setChanged(true); setStatus("idle"); return false; }
      if (!r.ok) throw new Error(String(r.status));
      mtime.current = (await r.json()).mtime;
      setSaved(body); setChanged(false); setStatus("idle");
      return true;
    } catch {
      savedRef.current = prev; setStatus("error");
      return false;
    }
  };

  const postComment = async (t: string) => {
    const s = canvas.current?.slide(indexRef.current);
    if (!deck || !s || !sel || !t) return;
    const body = { deck: deck.folder, slide: indexRef.current + 1, path: pathOf(s, sel), excerpt: (sel.textContent ?? "").trim().slice(0, 80), text: t };
    const r = await fetch("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return setErr("코멘트를 보내지 못했습니다");
    const { id } = await r.json();
    setComments((l) => (l.some((c) => c.id === id) ? l : [...l, { id, slide: body.slide, path: body.path, excerpt: body.excerpt, text: t, status: "open", createdAt: new Date().toISOString() }]));
    setTab("comments");
  };
  const jump = (c: Comment) => {
    setIndex(c.slide - 1);
    const s = canvas.current?.slide(c.slide - 1);
    pickSel((s && byPath(s, c.path)) ?? null);
  };

  keyRef.current = (e) => {
    const t = e.target as HTMLElement, mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (mod && k === "\\" && e.view !== window) {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", metaKey: e.metaKey, ctrlKey: e.ctrlKey, cancelable: true }));
    } else if (mod && k === "s") { e.preventDefault(); save(); }
    else if (mod && k === "/") { e.preventDefault(); setHelp((v) => !v); }
    else if (typing) return;
    else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? restore(future.current, past.current) : restore(past.current, future.current); }
    else if (mod && k === "d") { e.preventDefault(); dupSelected(); }
    else if (!mod && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); delSelected(); }
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

  const present = async () => {
    if (!(await save())) return;
    setErr(await startPresentation(deck.folder));
    go(`/present/${encodeURIComponent(deck.id)}`);
  };
  const back = async () => { if (await save()) go("/"); };
  const label = status === "saving" ? "저장 중" : status === "error" ? "저장 실패" : dirty ? "저장 안 됨" : "저장됨";

  return (
    <>
      <Shell
        toolbar={
          <>
            <Tooltip content="덱 목록" side="bottom"><Button variant="ghost" size="icon-compact" onClick={back}><ArrowLeft /></Button></Tooltip>
            <span className="truncate text-subtitle font-medium">{deck.title}</span>
            <span className="text-caption text-muted-foreground">{label}</span>
            {changed && (
              <>
                <span className="text-caption text-muted-foreground">파일이 밖에서 바뀌었습니다</span>
                <Button variant="ghost" size="compact" onClick={() => load(deck.folder, indexRef.current)}>불러오기</Button>
                <Button variant="ghost" size="compact" onClick={() => save(true)}>덮어쓰기</Button>
              </>
            )}
            {err && <span className="text-caption text-muted-foreground">{err}</span>}
            <span className="ml-auto" />
            {dirty && !changed && <Button variant="ghost" size="compact" onClick={() => save()}>저장</Button>}
            <Button variant="primary" size="compact" leadingIcon={MonitorPlay} onClick={present}>발표 시작</Button>
          </>
        }
        left={
          <Layers shell={shell} folder={folder} units={units} index={index}
            onSelect={setIndex} onMove={moveSlide} onDuplicate={dupSlide} onDelete={delSlide} onAdd={addSlide} />
        }
        right={
          <Inspector sel={sel} slide={canvas.current?.slide(index) ?? null} selId={selId} tab={tab} onTab={setTab}
            comments={comments} onJump={jump} onStyle={style} onAttr={attr} onNotes={notes} />
        }
      >
        <Canvas ref={canvas} shell={shell} folder={folder} units={units} index={index} sel={sel} comments={comments}
          onSel={pickSel} onCommit={commit} onKey={(e) => keyRef.current(e)} onDelete={delSelected}
          onComment={postComment} onMarker={(cid) => { setTab("comments"); const c = comments.find((x) => x.id === cid); if (c) jump(c); }} />
      </Shell>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent size="sm">
          <DialogTitle>단축키</DialogTitle>
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
