import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ScanLine, TriangleAlert, AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, Bold, MessageSquare, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { ColorField } from "@/components/ui/color-field";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { byPath, previewHtml, serializeSlide, type Unit } from "@/lib/deck-source";
import { applyPlayhead, readSlide, slideStepCount } from "@/lib/animation-dom";
import { childToward, isLeaf, isLockedDeep, pick as pickEl, siblings } from "@/lib/selection";
import { canMove, canResize, fixSize, moveBy, readTranslate, toLocal, writeTranslate } from "@/lib/move";
import { lockAxis, snapMove, snapResize, toSlide, unionRect, type Gap, type Guide, type Rect } from "@/lib/guides";
import { cursorOf, HANDLE_CURSOR, type CursorName } from "@/lib/cursors";
import { findOverflow, type Overflow } from "@/lib/overflow";
import { CommentPin } from "./CommentPin";
import { CommentComposer } from "./CommentComposer";
import { nameOf } from "./LayerTree";
import type { Comment } from "@/lib/deck";
import type { CommentActions } from "@/lib/comment-actions";

export type CanvasApi = {
  apply(units: Unit[]): void; // 순서가 같으면 바뀐 슬라이드만 제자리 교체, 다르면 다시 만든다
  mark(key: string, html: string): void;
  serialize(i: number): string | null;
  slide(i: number): HTMLElement | null;
  edit(el: Element): void;
  select(el: Element | null): void;
  zoom(dir: 1 | -1 | 0): void; // 0은 맞춤
  zoom100(): void; // 슬라이드가 1920px 폭으로 보이는 배율
  anchor(el: Element | null): { x: number; y: number }; // 메뉴를 키보드로 열 때의 화면 좌표(요소 왼쪽 아래, 없으면 캔버스 중앙)
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
  more: Element[]; // 다중 선택의 나머지(같은 부모, sel과 함께 한 묶음)
  comments: Comment[];
  numbers: Map<string, number>; // 목록과 같은 코멘트 번호
  channel: boolean | null;
  onStyle(prop: string, value: string): void; // 선택한 글자 요소의 서식 도구줄
  onImage(file: File, over: Element | null): void; // 붙여넣거나 끌어 놓은 이미지(img 위면 교체)
  overflowOn: boolean; // 넘친 요소를 점선 빨강 외곽선으로 보임
  safeArea: boolean; // 바깥 여백 80px 안전 영역 가이드
  onToggleGuide(kind: "overflow" | "safe"): void;
  onOverflow(list: Overflow[]): void; // 현재 슬라이드에서 넘친 요소가 바뀔 때
  onSel(el: Element | null): void;
  onContext(info: { el: Element | null; x: number; y: number }): void; // 우클릭: 대상 요소(없으면 빈 곳)와 화면 좌표
  onGroup(list: Element[]): void; // 마퀴로 고른 묶음(첫 요소가 대표)
  onMulti(el: Element | null): void; // Shift+클릭: 선택에 더하거나 뺀다
  onCommit(coalesce?: string): void;
  onKey(e: KeyboardEvent): void;
  onDelete(): void;
  onComment(text: string): Promise<void>;
  onMarker(id: string): void;
  stepBadges?: boolean; // Animation 탭이 열려 있을 때 요소 모서리에 등장 번호와 out 번호를 단다
  step?: { k: number | null; animate: boolean }; // 재생 헤드: 단계 k의 상태를 그린다(null이면 마지막 단계). animate면 전환을 보인다
  commentActions: CommentActions;
  onReady(): void;
};

const INLINE = /^(B|I|EM|STRONG|SPAN|CODE|A|BR|SMALL|MARK|U|S|SUB|SUP|KBD)$/;
export const textual = (el: Element) =>
  !(el instanceof SVGElement) && !!el.textContent?.trim() && [...el.children].every((c) => INLINE.test(c.tagName));

// 이 CSS는 편집용 iframe 문서의 head에만 들어간다. 저장 글자에는 슬라이드만 쓰이므로 새지 않는다.
const EDIT_CSS = `html{cursor:default}*:not(html){cursor:inherit!important}*{user-select:none;-webkit-user-select:none}[contenteditable]{user-select:text;-webkit-user-select:text;outline:none}`;

// 8방향 리사이즈 핸들: id의 n, s, e, w가 움직이는 변이다.
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

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
  const handles = useRef<HTMLDivElement>(null);
  const extraBoxes = useRef<HTMLDivElement>(null);
  const badgeLayer = useRef<HTMLDivElement>(null), badgeList = useRef<{ el: Element; text: string; right?: boolean }[]>([]); // 단계 번호 배지(편집 표시일 뿐 저장되지 않는다)
  const overflowBoxes = useRef<HTMLDivElement>(null), safeBox = useRef<HTMLDivElement>(null);
  const overflowList = useRef<Overflow[]>([]);
  // 끌어서 이동: 시작 상태. moved는 3px 넘게 움직인 뒤에만 참이다.
  const drag = useRef<{ els: HTMLElement[]; x0: number; y0: number; t0: [number, number][]; ks: number; moved: boolean; start: Rect; cands: Rect[]; orig: string[]; primary: HTMLElement } | null>(null);
  const swallowClick = useRef(false);
  // 끌기 중 커서를 고정하는 투명 방패(iframe 위에서 커서가 바뀌지 않게). 포인터 캡처가 이벤트를 계속 받는다.
  const [shield, setShield] = useState<CursorName | null>(null);
  const marquee = useRef<{ x0: number; y0: number; moved: boolean; add: Element[] } | null>(null);
  const marqueeBox = useRef<HTMLDivElement>(null);
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
      const html = previewHtml({ ...P.current.shell, units }, units, P.current.folder, { embed: true }); // 단계 요소는 재생 헤드가 가리키는 단계의 상태로 그린다(applyStep, data-shown과 data-away만 토글하고 저장 글자에는 새지 않는다)
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
    zoom100: () => setZoom(size.w ? 1920 / size.w : 1),
    anchor(el) {
      const fr = frame.current?.getBoundingClientRect();
      if (!fr) return { x: 0, y: 0 };
      if (!el) return { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
      const r = el.getBoundingClientRect();
      return { x: fr.left + r.left, y: fr.top + r.bottom };
    },
    compose: () => setComposing(true),
    nudge(dx, dy) {
      const els = ([P.current.sel, ...P.current.more].filter(Boolean) as HTMLElement[]).filter((el) => !isLockedDeep(el) && canMove(el));
      if (!els.length) return;
      for (const el of els) moveBy(el, dx, dy);
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

  // 끌기 방패는 포인터를 누른 동안에만 있어야 한다. 어떤 경로로든(창 밖에서 놓기, 포커스 이동, 예외) 끝이 놓치면 문서 전체가 막히므로 안전망으로 지운다.
  useEffect(() => {
    const clear = () => setShield(null);
    window.addEventListener("pointerup", clear, true); window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", clear);
    return () => { window.removeEventListener("pointerup", clear, true); window.removeEventListener("pointercancel", clear, true); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, []);

  // 넘친 요소 검사: 0.6초마다 현재 슬라이드를 훑고, 결과가 달라졌을 때만 알린다(상자 위치는 place가 매 프레임 따라간다).
  useEffect(() => {
    let sig = "", t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t0 = performance.now();
      const sl = cur();
      const list = sl && !drag.current && !editing.current ? findOverflow(sl) : overflowList.current;
      overflowList.current = list;
      const s = list.map((o) => o.kind + (o.el.id || o.el.tagName) + Math.round(o.el.getBoundingClientRect().width)).join("|") + ":" + P.current.index;
      if (s !== sig) { sig = s; P.current.onOverflow(list); }
      t = setTimeout(tick, Math.max(600, (performance.now() - t0) * 10)); // 훑는 데 오래 걸리는 큰 슬라이드에서는 간격을 늘려 CPU를 10% 안쪽으로 둔다
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, []);

  const goto = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ source: "slidekit", v: 1, type: "goto", slide: P.current.index + 1 }, location.origin);
  }, []);
  useEffect(() => { goto(); hover.current = null; }, [p.index, goto]);

  // 요소 하나를 고른다. SVG 안쪽은 가장 바깥 svg로 올린다.
  // 클릭으로 선택될 요소(SPEC 9.5). 호버 외곽선도 같은 규칙으로 "지금 누르면 선택될 요소"를 보인다.
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

  const clearGuides = () => { if (guideSvg.current) guideSvg.current.replaceChildren(); };
  const drawGuides = (sr: DOMRect, ks: number, guides: Guide[], gaps: Gap[]) => {
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

  // 핸들을 끌어 크기를 바꾼다(SPEC 9.2): 인라인 width, height만 바꾸고 고정한 모서리는 translate로 맞춘다.
  // Shift는 모서리에서 비율 유지, Alt는 중심 기준. 스냅 가이드는 이동과 같다. 한 번 끌기 = 실행 취소 한 건.
  const startResize = (id: string, e: React.PointerEvent) => {
    const el = P.current.sel as HTMLElement | null, sl = cur();
    if (!el || !sl || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    setShield(HANDLE_CURSOR[id]);
    e.currentTarget.setPointerCapture(e.pointerId); // 포인터가 iframe 위로 나가도 이벤트를 계속 받는다
    const sr = sl.getBoundingClientRect(), ks = sr.width / 1920 || 1;
    const edges = { l: id.includes("w"), r: id.includes("e"), t: id.includes("n"), b: id.includes("s") };
    const textOnly = textual(el);
    const w0 = el.offsetWidth, h0 = el.offsetHeight, t0 = readTranslate(el), orig = el.getAttribute("style");
    const start = toSlide(el.getBoundingClientRect(), sr, ks);
    const cands = siblings<Element>(sl, el).filter((n) => n !== el && n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== "none").map((n) => toSlide(n.getBoundingClientRect(), sr, ks));
    const x0 = e.clientX, y0 = e.clientY;
    const [k] = toLocal(el, 1, 0); // 슬라이드 1px당 로컬 px(조상 배율)
    fixSize(el);
    let moved = false;
    const move = (m: PointerEvent) => {
      moved = true;
      let dW = ((edges.r ? m.clientX - x0 : edges.l ? x0 - m.clientX : 0)) / ks;
      let dH = textOnly ? 0 : ((edges.b ? m.clientY - y0 : edges.t ? y0 - m.clientY : 0)) / ks;
      const corner = (edges.l || edges.r) && (edges.t || edges.b);
      const ratio = m.shiftKey && corner && !textOnly ? start.w / start.h : undefined;
      if (m.altKey) { dW *= 2; dH *= 2; }
      if (ratio) { // 더 크게 바뀐 축을 따르고 다른 축은 비율로 맞춘다
        if (Math.abs(dW / start.w) >= Math.abs(dH / start.h)) dH = (start.w + dW) / ratio - start.h; else dW = (start.h + dH) * ratio - start.w;
      }
      const nw = Math.max(1, start.w + dW), nh = Math.max(1, start.h + dH);
      const rect: Rect = { x: edges.l ? start.x + start.w - nw : m.altKey ? start.x + (start.w - nw) / 2 : start.x, y: edges.t ? start.y + start.h - nh : m.altKey ? start.y + (start.h - nh) / 2 : start.y, w: nw, h: nh };
      const snap = snapResize(rect, edges, cands, 6 / ks, { ratio });
      const fw = snap.rect.w, fh = snap.rect.h;
      if (edges.l || edges.r) el.style.width = `${Math.max(1, w0 + (fw - start.w) * k)}px`;
      if (!textOnly && (edges.t || edges.b)) el.style.height = `${Math.max(1, h0 + (fh - start.h) * k)}px`;
      // 고정할 변이 움직이지 않도록 측정해서 translate를 보정한다
      writeTranslate(el, t0[0], t0[1]);
      const now = toSlide(el.getBoundingClientRect(), sr, ks);
      const wantX = edges.l ? start.x + start.w - now.w : m.altKey ? start.x + start.w / 2 - now.w / 2 : start.x;
      const wantY = edges.t ? start.y + start.h - now.h : m.altKey ? start.y + start.h / 2 - now.h / 2 : start.y;
      writeTranslate(el, t0[0] + (wantX - now.x) * k, t0[1] + (wantY - now.y) * k);
      drawGuides(sr, ks, snap.guides, snap.gaps);
    };
    const finish = (cancel: boolean) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key, true);
      clearGuides(); setShield(null);
      if (cancel || !moved) { if (orig === null) el.removeAttribute("style"); else el.setAttribute("style", orig); return; }
      P.current.onCommit();
    };
    const up = () => finish(false);
    const key = (k: KeyboardEvent) => { if (k.key === "Escape") { k.preventDefault(); k.stopPropagation(); finish(true); } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("keydown", key, true);
  };

  // 재생 헤드(단계 k)를 현재 슬라이드에 그린다. 속성만 토글하므로 가볍다(막대 끌기와 재생 중에 iframe을 다시 만들지 않는다).
  const applyStep = (instant: boolean) => {
    const sl = cur();
    if (!sl) return;
    const rows = readSlide(sl);
    badgeList.current = P.current.stepBadges ? rows.flatMap((r) => [...(r.spec.in !== null ? [{ el: r.el, text: String(r.spec.in) }] : []), ...(r.spec.out !== null ? [{ el: r.el, text: `out ${r.spec.out}`, right: true }] : [])]) : [];
    if (!rows.length) return;
    const S = slideStepCount(sl, rows), k = P.current.step?.k ?? S;
    applyPlayhead(sl, Math.min(Math.max(1, k), S), rows, instant);
  };
  useEffect(() => { applyStep(!p.step?.animate); }, [p.step?.k, p.step?.animate, p.index, p.units, url, p.stepBadges]); // eslint-disable-line
  const attach = () => {
    const d = doc();
    if (!d) return;
    const st = d.createElement("style");
    st.textContent = EDIT_CSS;
    d.head.appendChild(st);
    applyStep(true); // 새로 그린 문서의 단계 요소를 재생 헤드 상태로
    d.addEventListener("pointerdown", (e) => {
      const sl = cur();
      if (e.button !== 0 || editing.current || !sl) return;
      if (e.shiftKey) return; // Shift+클릭은 선택 토글이라 끌기를 시작하지 않는다
      const el = pick(e) as HTMLElement | null;
      if (!el) { marquee.current = { x0: e.clientX, y0: e.clientY, moved: false, add: [] }; (e.target as Element).setPointerCapture?.(e.pointerId); return; } // 빈 곳을 끌면 마퀴 선택
      if (isLockedDeep(el) || !canMove(el)) return;
      const multi = [P.current.sel, ...P.current.more].filter(Boolean) as HTMLElement[];
      const els = P.current.more.length && multi.includes(el) ? multi.filter((n) => !isLockedDeep(n) && canMove(n)) : [el];
      const sr = sl.getBoundingClientRect(), ks = sr.width / 1920 || 1;
      const cands = siblings<Element>(sl, el).filter((n) => !els.includes(n as HTMLElement) && n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== "none").map((n) => toSlide(n.getBoundingClientRect(), sr, ks));
      drag.current = { els, primary: el, x0: e.clientX, y0: e.clientY, t0: els.map(readTranslate), ks, moved: false, start: unionRect(els.map((n) => toSlide(n.getBoundingClientRect(), sr, ks))), cands, orig: els.map((n) => n.style.translate) };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }, true);
    d.addEventListener("pointermove", (e) => {
      if (!drag.current && !marquee.current) { // 커서: 편집 중인 글자 안은 text, 선택된 요소 몸통 위는 move, 그 밖은 default
        const t = e.target as Node, ed = editing.current;
        const group = [selRef.current, ...P.current.more].filter(Boolean) as HTMLElement[];
        const onSel = group.some((n) => n.contains(t) && !isLockedDeep(n) && canMove(n));
        d.documentElement.style.cursor = cursorOf(ed && ed.contains(t) ? "text" : onSel ? "move" : "default");
      }
      const m = marquee.current;
      if (m) {
        if (!m.moved && Math.hypot(e.clientX - m.x0, e.clientY - m.y0) < 4) return;
        m.moved = true;
        const b = marqueeBox.current;
        if (b) { b.style.display = "block"; b.style.transform = `translate(${Math.min(m.x0, e.clientX)}px,${Math.min(m.y0, e.clientY)}px)`; b.style.width = Math.abs(e.clientX - m.x0) + "px"; b.style.height = Math.abs(e.clientY - m.y0) + "px"; }
        e.preventDefault();
        return;
      }
      const g = drag.current;
      if (!g) return;
      let dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < 3) return;
        g.moved = true; setShield("move"); d.documentElement.style.cursor = cursorOf("move");
        if (g.els.length === 1 && selRef.current !== g.primary) { selRef.current = g.primary; P.current.onSel(g.primary); }
        hover.current = null;
      }
      const lock = e.shiftKey ? lockAxis(dx, dy) : null;
      if (lock) { dx = lock.dx; dy = lock.dy; }
      const sl = cur()!, sr = sl.getBoundingClientRect();
      const mv: Rect = { ...g.start, x: g.start.x + dx / g.ks, y: g.start.y + dy / g.ks };
      const snap = snapMove(mv, g.cands, 6 / g.ks, { lock: lock?.axis, frame: { x: 0, y: 0, w: 1920, h: 1080 } });
      g.els.forEach((el, i) => {
        const [lx, ly] = toLocal(el, dx / g.ks + snap.dx, dy / g.ks + snap.dy); // 회전한 조상도 거꾸로 돌려 준다
        writeTranslate(el, g.t0[i][0] + lx, g.t0[i][1] + ly);
      });
      drawGuides(sr, g.ks, snap.guides, snap.gaps);
      e.preventDefault();
    }, true);
    const endDrag = (cancel: boolean) => {
      const g = drag.current;
      drag.current = null;
      clearGuides(); setShield(null);
      if (!g || !g.moved) return;
      swallowClick.current = true; // 끌고 난 뒤의 click이 선택을 바꾸지 않게 한다
      setTimeout(() => { swallowClick.current = false; }, 0);
      if (cancel) { g.els.forEach((el, i) => { if (g.orig[i]) el.style.translate = g.orig[i]; else el.style.removeProperty("translate"); }); return; }
      P.current.onCommit(); // 한 번 끌기 = 실행 취소 한 건
    };
    const endMarquee = (e: PointerEvent | null) => {
      const m = marquee.current;
      marquee.current = null;
      if (marqueeBox.current) marqueeBox.current.style.display = "none";
      const sl = cur();
      if (!m || !m.moved || !e || !sl) return;
      swallowClick.current = true; setTimeout(() => { swallowClick.current = false; }, 0);
      const l = Math.min(m.x0, e.clientX), t = Math.min(m.y0, e.clientY), r = Math.max(m.x0, e.clientX), b = Math.max(m.y0, e.clientY);
      const hit = siblings<Element>(sl, null).filter((n) => {
        if (isLockedDeep(n) || getComputedStyle(n).display === "none") return false;
        const q = n.getBoundingClientRect();
        return q.width > 0 && q.left < r && q.right > l && q.top < b && q.bottom > t;
      });
      selRef.current = hit[0] ?? null;
      P.current.onGroup(hit);
    };
    d.addEventListener("pointerup", (e) => { endMarquee(e); endDrag(false); setShield(null); }, true);
    d.addEventListener("lostpointercapture", () => { if (!drag.current) setShield(null); }, true);
    d.addEventListener("pointercancel", () => { endMarquee(null); endDrag(true); }, true);
    d.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag.current?.moved) { e.preventDefault(); e.stopPropagation(); endDrag(true); } }, true);
    const inEdit = (e: Event) => !!editing.current && editing.current.contains(e.target as Node);
    d.addEventListener("mouseover", (e) => { if (!editing.current) hover.current = pick(e); }, true);
    d.addEventListener("mouseleave", () => { hover.current = null; });
    d.addEventListener("click", (e) => {
      if (inEdit(e)) return;
      e.preventDefault(); e.stopPropagation();
      if (swallowClick.current) { swallowClick.current = false; return; }
      const t = pick(e);
      if (e.shiftKey && !e.metaKey && !e.ctrlKey) { P.current.onMulti(t); setComposing(false); return; }
      selRef.current = t;
      P.current.onSel(t);
      setComposing(false);
    }, true);
    d.addEventListener("contextmenu", (e) => {
      if (editing.current) return; // 글자 편집 중에는 브라우저 기본 메뉴(복사, 붙여넣기, 맞춤법)
      e.preventDefault(); e.stopPropagation();
      const fr = frame.current?.getBoundingClientRect();
      let el = cur() ? pick(e) : null;
      const s = P.current.sel;
      if (!el && s && isLockedDeep(s)) { const r = s.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) el = s; } // 잠긴 선택 위
      P.current.onContext({ el, x: e.clientX + (fr?.left ?? 0), y: e.clientY + (fr?.top ?? 0) });
    }, true);
    const imageOf = (dt: DataTransfer | null) => [...(dt?.files ?? [])].find((f) => f.type.startsWith("image/")) ?? null;
    d.addEventListener("paste", (e) => { if (editing.current) return; const f = imageOf(e.clipboardData); if (f) { e.preventDefault(); P.current.onImage(f, null); } }, true);
    d.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) e.preventDefault(); }, true);
    d.addEventListener("drop", (e) => {
      const f = imageOf(e.dataTransfer);
      if (!f) return;
      e.preventDefault(); e.stopPropagation();
      const img = (e.target as Element | null)?.closest?.("img") ?? null; // 이미지 위에 놓으면 그 이미지를 바꾼다
      P.current.onImage(f, img && cur()?.contains(img) ? img : null);
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
      // Shift+Enter: plaintext-only 편집은 개행 글자(\n)를 넣는다. 보통 줄바꿈으로는 한 줄로 합쳐 보이므로 이 요소에 white-space: pre-line을 달아 저장 글자와 발표 화면에서도 줄이 바뀌게 한다.
      if (ed && e.key === "Enter" && e.shiftKey && !e.isComposing) { if (!ed.style.whiteSpace) ed.style.whiteSpace = "pre-line"; return; }
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
  // 배지 위치(읽기를 모은 뒤 쓴다)
  const placeBadges = () => {
    const bl = badgeLayer.current;
    if (!bl) return;
    const list = badgeList.current.filter((b) => b.el.isConnected && !editing.current);
    while (bl.children.length < list.length) { const d = document.createElement("div"); d.className = "absolute left-0 top-0 rounded bg-foreground px-1 text-micro leading-4 tabular-nums text-background"; bl.appendChild(d); }
    const rects = list.map((b) => b.el.getBoundingClientRect());
    [...bl.children].forEach((c, i) => {
      const d = c as HTMLElement, b = list[i], q = rects[i];
      if (!b || !q) { d.style.display = "none"; return; }
      if (d.textContent !== b.text) d.textContent = b.text;
      d.style.display = "block";
      d.style.transform = b.right ? `translate(${q.right}px,${q.top}px) translate(-100%,-4px)` : `translate(${q.left}px,${q.top}px) translateY(-4px)`;
    });
  };
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
    const group = [s, ...P.current.more].filter((n): n is Element => !!n && n.isConnected);
    const multi = group.length > 1;
    let r = put(selBox.current, s);
    if (multi && selBox.current) { // 묶음: 모두를 감싸는 상자 하나와 구성 요소마다 얇은 외곽선
      const rs = group.map((n) => n.getBoundingClientRect());
      const l = Math.min(...rs.map((q) => q.left)), t = Math.min(...rs.map((q) => q.top)), rr = Math.max(...rs.map((q) => q.right)), b = Math.max(...rs.map((q) => q.bottom));
      r = new DOMRect(l, t, rr - l, b - t);
      selBox.current.style.transform = `translate(${l}px,${t}px)`;
      const ex = extraBoxes.current;
      if (ex) {
        while (ex.children.length < group.length) { const d = document.createElement("div"); d.className = "absolute left-0 top-0 border border-focus-ring/70"; ex.appendChild(d); }
        [...ex.children].forEach((c, i) => {
          const d = c as HTMLElement, q = rs[i];
          if (!q) { d.style.display = "none"; return; }
          d.style.display = "block"; d.style.width = q.width + "px"; d.style.height = q.height + "px"; d.style.transform = `translate(${q.left}px,${q.top}px)`;
        });
      }
    } else if (extraBoxes.current) [...extraBoxes.current.children].forEach((c) => { (c as HTMLElement).style.display = "none"; });
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
    // 리사이즈 핸들: 이동할 수 있는 선택 요소에만 보인다(글자 블록은 가로 변과 모서리만, 높이는 내용이 정한다)
    const hs = handles.current;
    if (hs) {
      const ok = !!(r && s && !multi && !editing.current && !composing && !isLockedDeep(s) && canResize(s as HTMLElement));
      const textOnly = !!s && textual(s);
      hs.querySelectorAll<HTMLElement>("[data-handle]").forEach((h) => {
        const id = h.dataset.handle!;
        if (!ok || !r || (textOnly && (id === "n" || id === "s"))) { h.style.display = "none"; return; }
        const x = id.includes("w") ? r.left : id.includes("e") ? r.right : r.left + r.width / 2;
        const y = id.includes("n") ? r.top : id.includes("s") ? r.bottom : r.top + r.height / 2;
        h.style.display = "block";
        h.style.transform = `translate(${x - 4}px,${y - 4}px)`;
      });
    }
    placeBadges();
    const ob = overflowBoxes.current;
    if (ob) {
      const list = P.current.overflowOn ? overflowList.current.filter((o) => o.el.isConnected) : [];
      while (ob.children.length < list.length) { const d = document.createElement("div"); d.dataset.testid = "overflow-box"; d.className = "absolute left-0 top-0 border border-dashed border-destructive"; ob.appendChild(d); }
      [...ob.children].forEach((c, i) => {
        const d = c as HTMLElement, o = list[i];
        if (!o) { d.style.display = "none"; return; }
        const q = o.el.getBoundingClientRect();
        d.style.display = "block"; d.style.width = q.width + "px"; d.style.height = q.height + "px"; d.style.transform = `translate(${q.left}px,${q.top}px)`;
      });
    }
    const sb = safeBox.current, slr = cur()?.getBoundingClientRect();
    if (sb) {
      if (!P.current.safeArea || !slr) sb.style.display = "none";
      else { const k = slr.width / 1920, m = 80 * k; sb.style.display = "block"; sb.style.width = slr.width - 2 * m + "px"; sb.style.height = slr.height - 2 * m + "px"; sb.style.transform = `translate(${slr.left + m}px,${slr.top + m}px)`; }
    }
    const h = hover.current && hover.current !== s && hover.current !== cur() ? hover.current : null;
    const hr = put(hoverBox.current, h);
    if (hr && hoverBox.current) { hoverBox.current.style.width = hr.width + "px"; hoverBox.current.style.height = hr.height + "px"; }
    if (bar.current) {
      const show = s && !multi && !editing.current;
      if (!show || !r) bar.current.style.display = "none";
      else { bar.current.style.display = "flex"; bar.current.style.transform = `translate(${Math.max(0, r.left)}px,${r.top > 36 ? r.top - 34 : r.bottom + 6}px)`; }
    }
    if (pop.current && !r) pop.current.style.transform = "translate(16px,16px)"; // 선택이 없으면 슬라이드 전체에 거는 코멘트
    else if (pop.current && r) pop.current.style.transform = `translate(${Math.max(0, Math.min(r.left, size.w * zoom - 260))}px,${Math.min(r.bottom + 6, size.h * zoom - 130)}px)`;
    const sl = cur();
    // 코멘트 핀: 위치를 모두 읽은 뒤에 한꺼번에 쓴다. 읽기(getBoundingClientRect)와 쓰기(transform)를 번갈아 하면 핀마다 레이아웃이 다시 계산되어
    // 핀 100개에서 60ms마다 수백 ms가 걸린다. 같은 요소의 핀 개수와 요소 찾기도 경로마다 한 번만 한다.
    const pins = markers.current ? [...markers.current.querySelectorAll<HTMLElement>("[data-path]")] : [];
    const same = new Map<string, number>(), rectOf = new Map<string, DOMRect | null>();
    for (const m of pins) same.set(m.dataset.path!, (same.get(m.dataset.path!) ?? 0) + 1);
    for (const path of same.keys()) { const t = sl ? byPath(sl, path) : null; rectOf.set(path, t && t.isConnected ? t.getBoundingClientRect() : null); }
    for (const m of pins) {
      const mr = rectOf.get(m.dataset.path!);
      if (!mr) { m.style.display = "none"; continue; }
      m.style.display = "block";
      // 요소가 슬라이드 오른쪽 끝까지 닿거나 위쪽 끝에 붙어도 핀이 잘리지 않게 캔버스 안으로 밀어 넣는다.
      // 같은 요소의 핀 개수만큼 줄 전체를 왼쪽으로 당겨 순서를 지킨 채 들어가게 한다.
      const maxX = size.w * zoom - 24 - (same.get(m.dataset.path!)! - 1) * 22;
      const x = Math.max(0, Math.min(mr.right - 6, maxX)) + Number(m.dataset.off ?? 0) * 22;
      m.style.transform = `translate(${x}px,${Math.max(0, mr.top - 6)}px)`;
    }
  }, [size.w, size.h, zoom, composing]);
  useEffect(() => { place(); const t = setInterval(place, 60); return () => clearInterval(t); });

  const here = p.comments;
  const fmt = p.sel && !p.more.length && !composing && textual(p.sel) && !isLockedDeep(p.sel) ? p.sel.ownerDocument.defaultView!.getComputedStyle(p.sel) : null;

  const pct = Math.round(((size.w * zoom) / 1920) * 100);
  return (
    <div className="relative h-full w-full">
    <div ref={box} className="flex h-full w-full overflow-auto">
      <div className="relative m-auto shrink-0 overflow-hidden rounded-lg bg-black shadow-surface-3 ring-1 ring-white/[0.06]" style={{ width: size.w * zoom, height: size.h * zoom }}>
        {url && <iframe ref={frame} src={url} onLoad={attach} title="Canvas" className="absolute inset-0 h-full w-full border-0" />}
        {shield && <div data-testid="cursor-shield" aria-hidden="true" className="fixed inset-0 z-[100]" style={{ cursor: cursorOf(shield) }} />}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div ref={hoverBox} className="absolute left-0 top-0 hidden border border-focus-ring/60" />
          <div ref={selBox} className="absolute left-0 top-0 hidden border-2 border-focus-ring" />
          <div ref={safeBox} data-testid="safe-area" className="absolute left-0 top-0 hidden border border-dashed border-white/30" />
          <div ref={overflowBoxes} />
          <div ref={badgeLayer} aria-hidden="true" data-testid="step-badges" />
          <div ref={marqueeBox} className="absolute left-0 top-0 hidden border border-focus-ring bg-focus-ring/10" />
          <div ref={extraBoxes} />
          <div ref={handles}>
            {HANDLES.map((id) => (
              <div key={id} data-handle={id} aria-hidden="true" style={{ cursor: cursorOf(HANDLE_CURSOR[id]) }} onPointerDown={(e) => startResize(id, e)}
                className="pointer-events-auto absolute left-0 top-0 hidden size-2 rounded-[2px] border border-focus-ring bg-white" />
            ))}
          </div>
          <svg ref={guideSvg} aria-hidden="true" className="absolute inset-0 size-full overflow-visible" />
          <div ref={sizeTag} aria-hidden="true" className="absolute left-0 top-0 hidden whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-micro tabular-nums text-background" />
          <div ref={markers}>
            {here.map((c, ci) => (
              <div key={c.id} data-path={c.path} data-off={here.slice(0, ci).filter((o) => o.path === c.path).length} className="pointer-events-auto absolute left-0 top-0 hidden">
                <CommentPin comment={c} number={p.numbers.get(c.id) ?? ci + 1}
                  onClick={() => p.onMarker(c.id)} actions={p.commentActions} />
              </div>
            ))}
          </div>
          <div ref={bar} className="pointer-events-auto absolute left-0 top-0 hidden gap-0.5 rounded-lg bg-surface-3 p-0.5 shadow-surface-3">
            {p.sel && textual(p.sel) && (
              <Tooltip content="Edit" side="top"><Button aria-label="Edit" variant="ghost" size="icon-compact" onClick={() => startEdit(p.sel as HTMLElement)}><Pencil /></Button></Tooltip>
            )}
            {fmt && (
              <div role="group" aria-label="Text format" className="flex items-center gap-0.5 border-x border-border px-0.5">
                <Tooltip content="Bold" side="top"><Button aria-label="Bold" aria-pressed={+fmt.fontWeight >= 600} variant="ghost" size="icon-compact" onClick={() => p.onStyle("font-weight", +fmt.fontWeight >= 600 ? "400" : "700")}><Bold /></Button></Tooltip>
                <Tooltip content="Smaller" side="top"><Button aria-label="Smaller text" variant="ghost" size="icon-compact" onClick={() => p.onStyle("font-size", `${Math.max(8, Math.round(parseFloat(fmt.fontSize) - (parseFloat(fmt.fontSize) < 40 ? 2 : 4)))}px`)}><AArrowDown /></Button></Tooltip>
                <Tooltip content="Larger" side="top"><Button aria-label="Larger text" variant="ghost" size="icon-compact" onClick={() => p.onStyle("font-size", `${Math.round(parseFloat(fmt.fontSize) + (parseFloat(fmt.fontSize) < 40 ? 2 : 4))}px`)}><AArrowUp /></Button></Tooltip>
                {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([v, I]) => (
                  <Tooltip key={v} content={`Align ${v}`} side="top"><Button aria-label={`Text align ${v}`} aria-pressed={fmt.textAlign === v || (v === "left" && fmt.textAlign === "start")} variant="ghost" size="icon-compact" onClick={() => p.onStyle("text-align", v)}><I /></Button></Tooltip>
                ))}
                <ColorField aria-label="Quick color" swatchOnly value={p.sel!.ownerDocument.defaultView!.getComputedStyle(p.sel!).color} onChange={(v) => p.onStyle("color", v)} className="px-0.5" />
              </div>
            )}
            <Tooltip content="Comment" side="top"><Button aria-label="Comment" variant="ghost" size="icon-compact" onClick={() => setComposing((v) => !v)}><MessageSquare /></Button></Tooltip>
            <Tooltip content="Delete" side="top"><Button aria-label="Delete" variant="ghost" size="icon-compact" onClick={p.onDelete}><Trash2 /></Button></Tooltip>
          </div>
          {composing && (
            <div ref={pop} className="pointer-events-auto absolute left-0 top-0 w-64">
              <CommentComposer channel={p.channel} target={p.sel ? nameOf(p.sel) : `Slide ${p.index + 1}`} onCancel={() => setComposing(false)}
                onSend={async (t) => { await p.onComment(t); setComposing(false); }} />
            </div>
          )}
        </div>
      </div>
    </div>
    {panning && (
      <div
        data-testid="pan-overlay" className="absolute inset-0 z-20" style={{ cursor: cursorOf(shield === "grabbing" ? "grabbing" : "grab") }}
        onPointerDown={(e) => {
          const b = box.current!, x0 = e.clientX, y0 = e.clientY, sl = b.scrollLeft, st = b.scrollTop;
          e.currentTarget.setPointerCapture(e.pointerId);
          setShield("grabbing");
          const move = (m: PointerEvent) => { b.scrollLeft = sl - (m.clientX - x0); b.scrollTop = st - (m.clientY - y0); };
          const up = () => { setShield(null); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
          window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
        }}
      />
    )}
    <div role="group" aria-label="Zoom" className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5 shadow-surface-3">
      <Tooltip content="Zoom out (Cmd+-)" side="top"><Button aria-label="Zoom out" variant="ghost" size="icon-compact" onClick={() => zoomBy(-1)}><Minus /></Button></Tooltip>
      <Tooltip content="Zoom to fit (Cmd+0, Shift+1)" side="top"><Button aria-label={`Zoom to fit, ${pct}%`} variant="ghost" size="compact" className="min-w-12 tabular-nums" onClick={() => zoomBy(0)}>{pct}%</Button></Tooltip>
      <Tooltip content="Safe area (80px margin)" side="top"><Button aria-label="Safe area" aria-pressed={p.safeArea} variant="ghost" size="icon-compact" onClick={() => p.onToggleGuide("safe")}><ScanLine /></Button></Tooltip>
      <Tooltip content="Show overflow" side="top"><Button aria-label="Show overflow" aria-pressed={p.overflowOn} variant="ghost" size="icon-compact" onClick={() => p.onToggleGuide("overflow")}><TriangleAlert /></Button></Tooltip>
      <Tooltip content="Zoom in (Cmd+=)" side="top"><Button aria-label="Zoom in" variant="ghost" size="icon-compact" onClick={() => zoomBy(1)}><Plus /></Button></Tooltip>
    </div>
    </div>
  );

});
