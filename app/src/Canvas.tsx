import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { byPath, previewHtml, serializeSlide, type Unit } from "@/lib/deck-source";
import type { Comment } from "@/lib/deck";

export type CanvasApi = {
  apply(units: Unit[]): void; // 순서가 같으면 바뀐 슬라이드만 제자리 교체, 다르면 다시 만든다
  mark(key: string, html: string): void;
  serialize(i: number): string | null;
  slide(i: number): HTMLElement | null;
  edit(el: Element): void;
  select(el: Element | null): void;
  zoom(dir: 1 | -1 | 0): void; // 0은 맞춤
};

type Props = {
  shell: { prefix: string; suffix: string };
  folder: string;
  units: Unit[];
  index: number;
  sel: Element | null;
  comments: Comment[];
  onSel(el: Element | null): void;
  onCommit(coalesce?: string): void;
  onKey(e: KeyboardEvent): void;
  onDelete(): void;
  onComment(text: string): Promise<void>;
  onMarker(id: string): void;
  onReady(): void;
};

const INLINE = /^(B|I|EM|STRONG|SPAN|CODE|A|BR|SMALL|MARK|U|S|SUB|SUP|KBD)$/;
export const textual = (el: Element) =>
  !(el instanceof SVGElement) && !!el.textContent?.trim() && [...el.children].every((c) => INLINE.test(c.tagName));

// 이 CSS는 편집용 iframe 문서의 head에만 들어간다. 저장 글자에는 슬라이드만 쓰이므로 새지 않는다.
const EDIT_CSS = `*{user-select:none;-webkit-user-select:none}[contenteditable]{user-select:text;-webkit-user-select:text;outline:none}`;

export const Canvas = forwardRef<CanvasApi, Props>(function Canvas(p, ref) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomBy = useCallback((dir: 1 | -1 | 0, f = 1.15) => setZoom((z) => (dir === 0 ? 1 : Math.max(0.25, Math.min(4, z * (dir > 0 ? f : 1 / f))))), []);
  const [url, setUrl] = useState("");
  const urlRef = useRef("");
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const shown = useRef<{ keys: string[]; html: Map<string, string> }>({ keys: [], html: new Map() });
  const editing = useRef<HTMLElement | null>(null);
  const hover = useRef<Element | null>(null);
  const hoverBox = useRef<HTMLDivElement>(null), selBox = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const P = useRef(p);
  P.current = p;

  const doc = () => frame.current?.contentDocument ?? null;
  const slides = () => [...(doc()?.querySelectorAll<HTMLElement>("#sk-stage > [data-slide]") ?? [])];
  const cur = () => slides()[P.current.index] ?? null;

  const build = useCallback((units: Unit[]) => {
    shown.current = { keys: units.map((u) => u.key), html: new Map(units.map((u) => [u.key, u.html])) };
    const html = previewHtml({ ...P.current.shell, units }, units, P.current.folder, { embed: true });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setUrl(urlRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    apply(units) {
      const s = shown.current;
      if (units.length !== s.keys.length || units.some((u, i) => u.key !== s.keys[i])) return build(units);
      const els = slides();
      units.forEach((u, i) => {
        if (s.html.get(u.key) === u.html || !els[i]) return;
        const t = document.createElement("template");
        t.innerHTML = u.html;
        const n = t.content.firstElementChild!;
        for (const a of [...els[i].attributes]) if (a.name !== "data-active") els[i].removeAttribute(a.name);
        for (const a of [...n.attributes]) if (a.name !== "data-active") els[i].setAttribute(a.name, a.value);
        els[i].replaceChildren(...n.childNodes);
        s.html.set(u.key, u.html);
      });
    },
    mark: (key, html) => shown.current.html.set(key, html),
    serialize: (i) => { const el = slides()[i]; return el ? serializeSlide(el) : null; },
    slide: (i) => slides()[i] ?? null,
    edit: (el) => startEdit(el as HTMLElement),
    select: (el) => P.current.onSel(el),
    zoom: (d) => zoomBy(d),
  }));

  useEffect(() => { build(p.units); /* 처음 한 번 */ }, []); // eslint-disable-line
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // 캔버스 크기: 가용 영역 안에서 16:9
  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => {
      const w = Math.max(0, Math.min(el.clientWidth - 48, ((el.clientHeight - 48) * 16) / 9));
      setSize({ w: Math.floor(w), h: Math.floor((w * 9) / 16) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cmd+휠(트랙패드 핀치 포함)로 확대와 축소
  const onWheel = useCallback((e: WheelEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1, 1 + Math.min(Math.abs(e.deltaY), 40) / 200);
  }, [zoomBy]);
  useEffect(() => {
    const el = box.current!;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const goto = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ source: "slidekit", v: 1, type: "goto", slide: P.current.index + 1 }, location.origin);
  }, []);
  useEffect(() => { goto(); hover.current = null; }, [p.index, goto]);

  // 요소 하나를 고른다. SVG 안쪽은 가장 바깥 svg로 올린다.
  const pick = (e: Event): Element | null => {
    const s = cur();
    let t = e.target as Element | null;
    if (!s || !t || !s.contains(t)) return null;
    for (let o = t.closest("svg"); o; o = o.parentElement?.closest("svg") ?? null) t = o;
    return t.closest("aside[data-notes]") ? null : t;
  };

  function endEdit() {
    const el = editing.current;
    if (!el) return;
    editing.current = null;
    el.removeAttribute("contenteditable");
    const s = cur();
    if (s && el.tagName === "H1" && s.getAttribute("data-slide") === "chapter") s.setAttribute("data-title", el.textContent?.trim() ?? "");
    P.current.onCommit();
  }
  function startEdit(el: HTMLElement) {
    if (!textual(el)) return;
    editing.current = el;
    el.setAttribute("contenteditable", "plaintext-only");
    el.focus();
    el.addEventListener("blur", endEdit, { once: true });
  }

  const attach = () => {
    const d = doc();
    if (!d) return;
    const st = d.createElement("style");
    st.textContent = EDIT_CSS;
    d.head.appendChild(st);
    const inEdit = (e: Event) => !!editing.current && editing.current.contains(e.target as Node);
    d.addEventListener("mouseover", (e) => { if (!editing.current) hover.current = pick(e); }, true);
    d.addEventListener("mouseleave", () => { hover.current = null; });
    d.addEventListener("click", (e) => {
      if (inEdit(e)) return;
      e.preventDefault(); e.stopPropagation();
      const t = pick(e);
      P.current.onSel(t === cur() ? null : t);
      setComposing(false);
    }, true);
    d.addEventListener("dblclick", (e) => { const t = pick(e); if (t && !editing.current) startEdit(t as HTMLElement); }, true);
    d.addEventListener("keydown", (e) => {
      const ed = editing.current;
      if (ed && (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))) { e.preventDefault(); e.stopPropagation(); ed.blur(); return; }
      P.current.onKey(e);
    }, true);
    d.addEventListener("wheel", onWheel, { passive: false });
    goto();
    P.current.onReady();
  };

  // 오버레이: 선택 상자, 호버 상자, 선택 컨트롤, 코멘트 표시. iframe 안 좌표가 곧 이 영역의 좌표다.
  const place = useCallback(() => {
    const put = (div: HTMLElement | null, el: Element | null, dy = 0) => {
      if (!div) return null;
      if (!el || !el.isConnected) { div.style.display = "none"; return null; }
      const r = el.getBoundingClientRect();
      div.style.display = "block";
      div.style.transform = `translate(${r.left}px,${r.top + dy}px)`;
      return r;
    };
    const s = P.current.sel;
    const r = put(selBox.current, s);
    if (r && selBox.current) { selBox.current.style.width = r.width + "px"; selBox.current.style.height = r.height + "px"; }
    const h = hover.current && hover.current !== s && hover.current !== cur() ? hover.current : null;
    const hr = put(hoverBox.current, h);
    if (hr && hoverBox.current) { hoverBox.current.style.width = hr.width + "px"; hoverBox.current.style.height = hr.height + "px"; }
    if (bar.current) {
      const show = s && !editing.current;
      if (!show || !r) bar.current.style.display = "none";
      else { bar.current.style.display = "flex"; bar.current.style.transform = `translate(${Math.max(0, r.left)}px,${r.top > 36 ? r.top - 34 : r.bottom + 6}px)`; }
    }
    if (pop.current && r) pop.current.style.transform = `translate(${Math.max(0, Math.min(r.left, size.w * zoom - 260))}px,${Math.min(r.bottom + 6, size.h * zoom - 130)}px)`;
    const sl = cur();
    markers.current?.querySelectorAll<HTMLElement>("[data-path]").forEach((m) => {
      const t = sl ? byPath(sl, m.dataset.path!) : null;
      const mr = put(m, t);
      if (mr) m.style.transform = `translate(${mr.right - 6}px,${mr.top - 6}px)`;
    });
  }, [size.w, size.h, zoom]);
  useEffect(() => { place(); const t = setInterval(place, 60); return () => clearInterval(t); });

  const here = p.comments;

  return (
    <div ref={box} className="flex h-full w-full overflow-auto">
      <div className="relative m-auto shrink-0 overflow-hidden rounded-lg bg-black shadow-surface-3" style={{ width: size.w * zoom, height: size.h * zoom }}>
        {url && <iframe ref={frame} src={url} onLoad={attach} title="캔버스" className="absolute inset-0 h-full w-full border-0" />}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div ref={hoverBox} className="absolute left-0 top-0 hidden border border-focus-ring/60" />
          <div ref={selBox} className="absolute left-0 top-0 hidden border-2 border-focus-ring" />
          <div ref={markers}>
            {here.map((c) => (
              <div key={c.id} data-path={c.path} className="pointer-events-auto absolute left-0 top-0 hidden">
                <button
                  aria-label="코멘트"
                  onClick={() => p.onMarker(c.id)}
                  className={`block h-3 w-3 rounded-full ring-2 ring-black ${c.status === "done" ? "bg-muted-foreground" : "bg-focus-ring"}`}
                />
              </div>
            ))}
          </div>
          <div ref={bar} className="pointer-events-auto absolute left-0 top-0 hidden gap-0.5 rounded-lg bg-surface-3 p-0.5 shadow-surface-3">
            {p.sel && textual(p.sel) && (
              <Tooltip content="편집" side="top"><Button aria-label="편집" variant="ghost" size="icon-compact" onClick={() => startEdit(p.sel as HTMLElement)}><Pencil /></Button></Tooltip>
            )}
            <Tooltip content="코멘트" side="top"><Button aria-label="코멘트" variant="ghost" size="icon-compact" onClick={() => setComposing((v) => !v)}><MessageSquare /></Button></Tooltip>
            <Tooltip content="삭제" side="top"><Button aria-label="삭제" variant="ghost" size="icon-compact" onClick={p.onDelete}><Trash2 /></Button></Tooltip>
          </div>
          {composing && p.sel && (
            <div ref={pop} className="pointer-events-auto absolute left-0 top-0 flex w-64 flex-col gap-1 rounded-lg bg-surface-3 p-1.5 shadow-surface-3">
              <TextArea autoFocus rows={3} value={text} placeholder="코멘트" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setComposing(false);
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send();
                }} />
              <Button variant="primary" size="compact" disabled={!text.trim()} onClick={send}>보내기</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  async function send() {
    await p.onComment(text.trim());
    setText("");
    setComposing(false);
  }
});
