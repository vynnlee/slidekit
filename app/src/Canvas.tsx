import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { byPath, previewHtml, serializeSlide, type Unit } from "@/lib/deck-source";
import { childToward, isLeaf, isLockedDeep, pick as pickEl, siblings } from "@/lib/selection";
import { canMove, localScale, moveBy, readTranslate, writeTranslate } from "@/lib/move";
import { lockAxis, snapMove, toSlide, type Gap, type Guide, type Rect } from "@/lib/guides";
import { CommentPin } from "./CommentPin";
import { CommentComposer } from "./CommentComposer";
import { nameOf } from "./LayerTree";
import type { Comment } from "@/lib/deck";

export type CanvasApi = {
  apply(units: Unit[]): void; // 순서가 같으면 바뀐 슬라이드만 제자리 교체, 다르면 다시 만든다
  mark(key: string, html: string): void;
  serialize(i: number): string | null;
  slide(i: number): HTMLElement | null;
  edit(el: Element): void;
  select(el: Element | null): void;
  zoom(dir: 1 | -1 | 0): void; // 0은 맞춤
  compose(): void; // 선택한 요소에 코멘트 작성창을 연다
  nudge(dx: number, dy: number): void; // 선택한 요소를 슬라이드 px만큼 옮긴다(방향키)
  reload(): void; // 덱 head(prefix)가 바뀐 뒤 현재 모델로 캔버스를 다시 만든다
  document(): Document | null;
  hover(el: Element | null): void; // 레이어 목록에서 가리킨 요소를 캔버스에 외곽선으로 보인다
  format(tag: "strong" | "em"): boolean; // 텍스트 편집 중 선택 영역을 굵게나 기울임으로 감싸거나 푼다
};

type Props = {
  shell: { prefix: string; suffix: string };
  folder: string;
  units: Unit[];
  index: number;
  sel: Element | null;
  comments: Comment[];
  numbers: Map<string, number>; // 목록과 같은 코멘트 번호
  hoverId: string | null;
  onHover(id: string | null): void;
  channel: boolean | null;
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
  // 확대와 축소. at(스크롤 영역 안의 좌표)을 주면 그 지점이 제자리에 있도록 스크롤을 보정한다.
  const anchor = useRef<{ x: number; y: number; ratio: number; sl: number; st: number } | null>(null);
  const zoomBy = useCallback((dir: 1 | -1 | 0, f = 1.15, at?: { x: number; y: number }) => setZoom((z) => {
    const nz = dir === 0 ? 1 : Math.max(0.25, Math.min(4, z * (dir > 0 ? f : 1 / f)));
    if (at && box.current && nz !== z) anchor.current = { ...at, ratio: nz / z, sl: box.current.scrollLeft, st: box.current.scrollTop };
    return nz;
  }), []);
  useLayoutEffect(() => {
    const a = anchor.current, b = box.current;
    if (!a || !b) return;
    anchor.current = null;
    b.scrollLeft = (a.sl + a.x) * a.ratio - a.x;
    b.scrollTop = (a.st + a.y) * a.ratio - a.y;
  }, [zoom]);
  // Space를 누르고 있는 동안은 캔버스 위에 덮개를 씌워 끌어서 이동(팬)한다.
  const [panning, setPanning] = useState(false);
  const [url, setUrl] = useState("");
  const urlRef = useRef("");
  const [composing, setComposing] = useState(false);
  const shown = useRef<{ keys: string[]; html: Map<string, string> }>({ keys: [], html: new Map() });
  const editing = useRef<HTMLElement | null>(null);
  const hover = useRef<Element | null>(null);
  const sizeTag = useRef<HTMLDivElement>(null);
  const guideSvg = useRef<SVGSVGElement>(null);
  // 끌어서 이동: 시작 상태. moved는 3px 넘게 움직인 뒤에만 참이다.
  const drag = useRef<{ el: HTMLElement; x0: number; y0: number; t0: [number, number]; ks: number; moved: boolean; start: Rect; cands: Rect[]; orig: string } | null>(null);
  const swallowClick = useRef(false);
  const hoverBox = useRef<HTMLDivElement>(null), selBox = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const P = useRef(p);
  P.current = p;

  const doc = () => frame.current?.contentDocument ?? null;
  const slides = () => [...(doc()?.querySelectorAll<HTMLElement>("#sk-stage > [data-slide]") ?? [])];
  const cur = () => slides()[P.current.index] ?? null;

  const buildTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const build = useCallback((units: Unit[]) => {
    shown.current = { keys: units.map((u) => u.key), html: new Map(units.map((u) => [u.key, u.html])) };
    const go = () => {
      const html = previewHtml({ ...P.current.shell, units }, units, P.current.folder, { embed: true, showSteps: true }); // 편집 중에는 모든 단계의 요소를 보인다(저장 글자에는 슬라이드만 쓰여 새지 않는다)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      setUrl(urlRef.current);
    };
    // 처음 한 번은 잠깐 미뤄 레이어 썸네일이 먼저 그려지게 한다
    clearTimeout(buildTimer.current);
    if (urlRef.current) go(); else buildTimer.current = setTimeout(go, 250);
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
    compose: () => setComposing(true),
    nudge(dx, dy) {
      const el = P.current.sel as HTMLElement | null;
      if (!el || isLockedDeep(el) || !canMove(el)) return;
      moveBy(el, dx, dy);
      P.current.onCommit("nudge");
    },
    reload: () => build(P.current.units),
    document: () => doc(),
    hover: (el) => { hover.current = el; },
    format(tag) {
      const ed = editing.current, d = doc(), sel = d?.getSelection();
      if (!ed || !d || !sel) return false;
      if (sel.rangeCount === 0 || sel.isCollapsed) return true;
      const r = sel.getRangeAt(0);
      const base = r.commonAncestorContainer;
      const anc = (base.nodeType === 1 ? (base as Element) : base.parentElement)?.closest(tag);
      if (anc && ed.contains(anc) && anc !== ed) {
        while (anc.firstChild) anc.before(anc.firstChild);
        anc.remove(); ed.normalize();
      } else {
        const w = d.createElement(tag);
        w.appendChild(r.extractContents()); r.insertNode(w);
        sel.removeAllRanges(); const nr = d.createRange(); nr.selectNodeContents(w); sel.addRange(nr);
      }
      return true;
    },
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
    const br = box.current!.getBoundingClientRect();
    const fr = e.view !== window ? frame.current?.getBoundingClientRect() : null; // iframe 안의 좌표는 바깥 화면 기준으로 바꾼다
    zoomBy(e.deltaY < 0 ? 1 : -1, 1 + Math.min(Math.abs(e.deltaY), 40) / 200, { x: e.clientX + (fr?.left ?? 0) - br.left, y: e.clientY + (fr?.top ?? 0) - br.top });
  }, [zoomBy]);
  useEffect(() => {
    const el = box.current!;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  useEffect(() => {
    const typing = (t: EventTarget | null) => { const e = t as HTMLElement | null; return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)); };
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !typing(e.target) && !editing.current) { e.preventDefault(); setPanning(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setPanning(false); };
    const off = () => setPanning(false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", off);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", off); };
  }, []);

  const goto = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ source: "slidekit", v: 1, type: "goto", slide: P.current.index + 1 }, location.origin);
  }, []);
  useEffect(() => { goto(); hover.current = null; }, [p.index, goto]);

  // 요소 하나를 고른다. SVG 안쪽은 가장 바깥 svg로 올린다.
  // 클릭으로 선택될 요소(SPEC 9.4). 호버 외곽선도 같은 규칙으로 "지금 누르면 선택될 요소"를 보인다.
  const selRef = useRef<Element | null>(null);
  useEffect(() => { selRef.current = p.sel; }, [p.sel]);
  const pick = (e: Event): Element | null => {
    const s = cur();
    let t = e.target as Element | null;
    // 잠긴 요소 위를 눌러도 그 아래 잠기지 않은 요소를 고른다(잠긴 덮개 아래 요소)
    if (s && t && isLockedDeep(t)) {
      const m = e as MouseEvent;
      t = (doc()?.elementsFromPoint(m.clientX, m.clientY) ?? []).find((n) => s.contains(n) && n !== s && !isLockedDeep(n)) ?? null;
    }
    return s ? pickEl<Element>(s, t, selRef.current, !!(e as MouseEvent).metaKey || !!(e as MouseEvent).ctrlKey) : null;
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
    const clearGuides = () => { if (guideSvg.current) guideSvg.current.replaceChildren(); };
    const draw = (sr: DOMRect, ks: number, guides: Guide[], gaps: Gap[]) => {
      const svg = guideSvg.current;
      if (!svg) return;
      const X = (v: number) => sr.left + v * ks, Y = (v: number) => sr.top + v * ks;
      let h = "";
      for (const g of guides) h += g.axis === "x"
        ? `<line data-testid="guide-line" x1="${X(g.pos)}" x2="${X(g.pos)}" y1="${Y(g.from)}" y2="${Y(g.to)}" stroke="#ff3ea5" stroke-width="1"/>`
        : `<line data-testid="guide-line" y1="${Y(g.pos)}" y2="${Y(g.pos)}" x1="${X(g.from)}" x2="${X(g.to)}" stroke="#ff3ea5" stroke-width="1"/>`;
      for (const g of gaps) {
        const a = g.axis === "x" ? [X(g.from), Y(g.at), X(g.to), Y(g.at)] : [X(g.at), Y(g.from), X(g.at), Y(g.to)];
        const mx = (a[0] + a[2]) / 2, my = (a[1] + a[3]) / 2, t = String(Math.round(g.value));
        h += `<line x1="${a[0]}" y1="${a[1]}" x2="${a[2]}" y2="${a[3]}" stroke="#f24822" stroke-width="1"/><rect data-testid="gap-label" x="${mx - 12}" y="${my - 8}" width="24" height="16" rx="4" fill="#f24822"/><text x="${mx}" y="${my + 4}" font-size="11" fill="#fff" text-anchor="middle" font-family="system-ui">${t}</text>`;
      }
      svg.innerHTML = h;
    };
    d.addEventListener("pointerdown", (e) => {
      const sl = cur();
      if (e.button !== 0 || editing.current || !sl) return;
      const el = pick(e) as HTMLElement | null;
      if (!el || isLockedDeep(el) || !canMove(el)) return;
      const sr = sl.getBoundingClientRect(), ks = sr.width / 1920 || 1;
      const cands = siblings<Element>(sl, el).filter((n) => n !== el && n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== "none").map((n) => toSlide(n.getBoundingClientRect(), sr, ks));
      drag.current = { el, x0: e.clientX, y0: e.clientY, t0: readTranslate(el), ks, moved: false, start: toSlide(el.getBoundingClientRect(), sr, ks), cands, orig: el.style.translate };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }, true);
    d.addEventListener("pointermove", (e) => {
      const g = drag.current;
      if (!g) return;
      let dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < 3) return;
        g.moved = true;
        if (selRef.current !== g.el) { selRef.current = g.el; P.current.onSel(g.el); }
        hover.current = null;
      }
      const lock = e.shiftKey ? lockAxis(dx, dy) : null;
      if (lock) { dx = lock.dx; dy = lock.dy; }
      const sl = cur()!, sr = sl.getBoundingClientRect();
      const mv: Rect = { ...g.start, x: g.start.x + dx / g.ks, y: g.start.y + dy / g.ks };
      const snap = snapMove(mv, g.cands, 6 / g.ks, { lock: lock?.axis, frame: { x: 0, y: 0, w: 1920, h: 1080 } });
      const ls = localScale(g.el) / g.ks || 1; // 화면 배율과 로컬 배율의 비(보통 1)
      writeTranslate(g.el, g.t0[0] + (dx / g.ks + snap.dx) / ls, g.t0[1] + (dy / g.ks + snap.dy) / ls);
      draw(sr, g.ks, snap.guides, snap.gaps);
      e.preventDefault();
    }, true);
    const endDrag = (cancel: boolean) => {
      const g = drag.current;
      drag.current = null;
      clearGuides();
      if (!g || !g.moved) return;
      swallowClick.current = true; // 끌고 난 뒤의 click이 선택을 바꾸지 않게 한다
      setTimeout(() => { swallowClick.current = false; }, 0);
      if (cancel) { if (g.orig) g.el.style.translate = g.orig; else g.el.style.removeProperty("translate"); return; }
      P.current.onCommit(); // 한 번 끌기 = 실행 취소 한 건
    };
    d.addEventListener("pointerup", () => endDrag(false), true);
    d.addEventListener("pointercancel", () => endDrag(true), true);
    d.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag.current?.moved) { e.preventDefault(); e.stopPropagation(); endDrag(true); } }, true);
    const inEdit = (e: Event) => !!editing.current && editing.current.contains(e.target as Node);
    d.addEventListener("mouseover", (e) => { if (!editing.current) hover.current = pick(e); }, true);
    d.addEventListener("mouseleave", () => { hover.current = null; });
    d.addEventListener("click", (e) => {
      if (inEdit(e)) return;
      e.preventDefault(); e.stopPropagation();
      if (swallowClick.current) { swallowClick.current = false; return; }
      const t = pick(e);
      selRef.current = t;
      P.current.onSel(t);
      setComposing(false);
    }, true);
    d.addEventListener("dblclick", (e) => {
      // 선택된 요소를 더블클릭: 글자 블록이면 편집, 컨테이너이면 한 단계 안쪽 요소를 선택한다.
      const sl = cur(), c = selRef.current;
      if (editing.current || !sl || !c || isLockedDeep(c) || !c.contains(e.target as Node)) return;
      if (isLeaf(c)) { if (textual(c)) startEdit(c as HTMLElement); return; }
      const child = childToward<Element>(sl, c, e.target as Element);
      if (child) { selRef.current = child; P.current.onSel(child); }
    }, true);
    d.addEventListener("keydown", (e) => {
      const ed = editing.current;
      if (ed && (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))) { e.preventDefault(); e.stopPropagation(); ed.blur(); return; }
      P.current.onKey(e);
    }, true);
    d.addEventListener("wheel", onWheel, { passive: false });
    d.addEventListener("keydown", (e) => { if (e.code === "Space" && !editing.current) { e.preventDefault(); e.stopPropagation(); setPanning(true); } }, true);
    d.addEventListener("keyup", (e) => { if (e.code === "Space") setPanning(false); }, true);
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
    // 선택 요소의 크기 칩(슬라이드 1920 기준 px)
    const tag = sizeTag.current;
    if (tag) {
      if (!r || !s || editing.current || composing) tag.style.display = "none";
      else {
        const k = (size.w * zoom) / 1920 || 1;
        const t = `${Math.round(r.width / k)} × ${Math.round(r.height / k)}`;
        if (tag.textContent !== t) tag.textContent = t;
        tag.style.display = "block";
        tag.style.transform = `translate(${r.left + r.width / 2}px,${r.bottom + 6}px) translateX(-50%)`;
      }
    }
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
      if (mr) m.style.transform = `translate(${mr.right - 6 + Number(m.dataset.off ?? 0) * 22}px,${mr.top - 6}px)`;
    });
  }, [size.w, size.h, zoom, composing]);
  useEffect(() => { place(); const t = setInterval(place, 60); return () => clearInterval(t); });

  const here = p.comments;

  const pct = Math.round(((size.w * zoom) / 1920) * 100);
  return (
    <div className="relative h-full w-full">
    <div ref={box} className="flex h-full w-full overflow-auto">
      <div className="relative m-auto shrink-0 overflow-hidden rounded-lg bg-black shadow-surface-3 ring-1 ring-white/[0.06]" style={{ width: size.w * zoom, height: size.h * zoom }}>
        {url && <iframe ref={frame} src={url} onLoad={attach} title="Canvas" className="absolute inset-0 h-full w-full border-0" />}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div ref={hoverBox} className="absolute left-0 top-0 hidden border border-focus-ring/60" />
          <div ref={selBox} className="absolute left-0 top-0 hidden border-2 border-focus-ring" />
          <svg ref={guideSvg} aria-hidden="true" className="absolute inset-0 size-full overflow-visible" />
          <div ref={sizeTag} aria-hidden="true" className="absolute left-0 top-0 hidden whitespace-nowrap rounded bg-focus-ring px-1.5 py-0.5 text-micro tabular-nums text-white" />
          <div ref={markers}>
            {here.map((c, ci) => (
              <div key={c.id} data-path={c.path} data-off={here.slice(0, ci).filter((o) => o.path === c.path).length} className="pointer-events-auto absolute left-0 top-0 hidden">
                <CommentPin comment={c} number={p.numbers.get(c.id) ?? ci + 1} highlighted={p.hoverId === c.id}
                  onClick={() => p.onMarker(c.id)} onHover={(on) => p.onHover(on ? c.id : null)} />
              </div>
            ))}
          </div>
          <div ref={bar} className="pointer-events-auto absolute left-0 top-0 hidden gap-0.5 rounded-lg bg-surface-3 p-0.5 shadow-surface-3">
            {p.sel && textual(p.sel) && (
              <Tooltip content="Edit" side="top"><Button aria-label="Edit" variant="ghost" size="icon-compact" onClick={() => startEdit(p.sel as HTMLElement)}><Pencil /></Button></Tooltip>
            )}
            <Tooltip content="Comment" side="top"><Button aria-label="Comment" variant="ghost" size="icon-compact" onClick={() => setComposing((v) => !v)}><MessageSquare /></Button></Tooltip>
            <Tooltip content="Delete" side="top"><Button aria-label="Delete" variant="ghost" size="icon-compact" onClick={p.onDelete}><Trash2 /></Button></Tooltip>
          </div>
          {composing && p.sel && (
            <div ref={pop} className="pointer-events-auto absolute left-0 top-0 w-64">
              <CommentComposer channel={p.channel} target={nameOf(p.sel)} onCancel={() => setComposing(false)}
                onSend={async (t) => { await p.onComment(t); setComposing(false); }} />
            </div>
          )}
        </div>
      </div>
    </div>
    {panning && (
      <div
        data-testid="pan-overlay" className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          const b = box.current!, x0 = e.clientX, y0 = e.clientY, sl = b.scrollLeft, st = b.scrollTop;
          e.currentTarget.setPointerCapture(e.pointerId);
          const move = (m: PointerEvent) => { b.scrollLeft = sl - (m.clientX - x0); b.scrollTop = st - (m.clientY - y0); };
          const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
          window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
        }}
      />
    )}
    <div role="group" aria-label="Zoom" className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5 shadow-surface-3">
      <Tooltip content="Zoom out (Cmd+-)" side="top"><Button aria-label="Zoom out" variant="ghost" size="icon-compact" onClick={() => zoomBy(-1)}><Minus /></Button></Tooltip>
      <Tooltip content="Zoom to fit (Cmd+0, Shift+1)" side="top"><Button aria-label="Zoom to fit" variant="ghost" size="compact" className="min-w-12 tabular-nums" onClick={() => zoomBy(0)}>{pct}%</Button></Tooltip>
      <Tooltip content="Zoom in (Cmd+=)" side="top"><Button aria-label="Zoom in" variant="ghost" size="icon-compact" onClick={() => zoomBy(1)}><Plus /></Button></Tooltip>
    </div>
    </div>
  );

});
