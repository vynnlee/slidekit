import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { leafOf, isLeaf, selectable } from "@/lib/selection";
import { pathOf } from "@/lib/deck-source";
import { AREA_KEYS, MODE_ON, boxOf, describeRegion, fromRegion, intersect, isArrow, isDrag, nudgeRegion, selectOverlaps, toRegion, type Box, type Cand, type CommentTarget } from "@/lib/comment-mode";
import type { Region } from "@/lib/deck";
import { nameOf } from "./LayerTree";

// 코멘트 모드(spec/COMMENT-MODE.md 2절): 캔버스 위의 투명한 층. 요소를 가리키고(호버 윤곽), 클릭으로 그 요소에, 8px 이상 끌어 영역에 코멘트를 고르고,
// 키보드로는 Tab으로 요소를, A로 조절 상자를 만들어 방향키로 영역을 정한다. 층이 포인터를 받으므로 모드 동안 요소 편집 조작은 iframe에 닿지 않는다.
// 좌표는 iframe 문서의 화면 좌표이고 캔버스 오버레이의 좌표와 같다. 호버와 드래그는 React 상태를 거치지 않고 DOM 속성만 바꾼다.
interface Props {
  doc: () => Document | null;
  slide: () => HTMLElement | null;
  slideNumber: number;
  /** 요소나 영역을 골랐다. at은 작성창을 놓을 화면 상자(iframe 좌표) */
  onPick(target: CommentTarget, at: Box): void;
  /** 슬라이드 전체에 코멘트(S 키, 알약의 단추) */
  onSlide(): void;
  onExit(): void;
  /** 새 선택을 시작하면 열려 있던 작성창을 닫는다 */
  onCancelCompose(): void;
}

const boxFromRect = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const place = (el: HTMLElement | null, b: Box | null) => {
  if (!el) return;
  if (!b) { el.style.display = "none"; return; }
  el.style.display = "block"; el.style.width = b.w + "px"; el.style.height = b.h + "px"; el.style.transform = `translate(${b.x}px,${b.y}px)`;
};

export function CommentModeLayer({ doc, slide, slideNumber, onPick, onSlide, onExit, onCancelCompose }: Props) {
  const layer = useRef<HTMLDivElement>(null), hoverBox = useRef<HTMLDivElement>(null), chip = useRef<HTMLSpanElement>(null), dragBox = useRef<HTMLDivElement>(null), areaBox = useRef<HTMLDivElement>(null);
  const [say, setSay] = useState(MODE_ON);
  const drag = useRef<{ p0: { x: number; y: number }; dragging: boolean } | null>(null);
  const hovered = useRef<Element | null>(null); // 지금 가리킨 요소(마우스나 Tab)
  const kbd = useRef<Region | null>(null); // 키보드 조절 상자
  const raf = useRef(0);
  const announce = (m: string) => setSay((prev) => (prev === m ? m + "​" : m)); // 같은 문구도 다시 읽히게 한다

  useEffect(() => { layer.current?.focus({ preventScroll: true }); return () => cancelAnimationFrame(raf.current); }, []);

  const local = (e: { clientX: number; clientY: number }) => { const r = layer.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const slideBox = (): Box | null => { const s = slide(); return s ? boxFromRect(s.getBoundingClientRect()) : null; };
  /** 포인터 아래의 선택 단위(글자 블록, 이미지, svg). 배경이면 슬라이드 자신. 단계로 숨겨진 요소는 건너뛴다. */
  const elementAt = (pt: { x: number; y: number }): Element | null => {
    const s = slide(), d = doc();
    if (!s || !d) return null;
    for (const el of d.elementsFromPoint(pt.x, pt.y)) {
      if (!s.contains(el) || el.closest("[data-away]")) continue;
      if (el === s) return s;
      const leaf = leafOf(s as never, el as never) as Element | null;
      if (leaf) return leaf;
    }
    return s;
  };
  const show = (el: Element | null) => {
    hovered.current = el;
    const s = slide();
    if (!el) { place(hoverBox.current, null); return; }
    place(hoverBox.current, boxFromRect(el.getBoundingClientRect()));
    if (chip.current) chip.current.textContent = el === s ? `Slide ${slideNumber}` : nameOf(el);
  };
  /** 영역과 겹치는 요소의 path 목록(단계로 숨겨진 요소, 노트, 크기 없는 요소는 뺀다) */
  const overlapOf = (region: Box): string[] => {
    const s = slide();
    if (!s) return [];
    const cands: Cand[] = [];
    for (const el of Array.from(s.querySelectorAll("*")) as Element[]) {
      const ok = selectable(el as unknown as Parameters<typeof selectable>[0]);
      if (!ok || el.closest("[data-away]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || !intersect(boxFromRect(r), region)) continue;
      cands.push({ path: pathOf(s, el), box: boxFromRect(r), leaf: isLeaf(el as never) });
    }
    return selectOverlaps(cands, region);
  };
  const pickRegion = (box: Box) => {
    const sb = slideBox();
    const region = sb ? toRegion(box, sb) : null;
    if (!sb || !region) return false;
    const rb = fromRegion(region, sb);
    onPick({ region, overlap: overlapOf(rb) }, rb);
    return true;
  };
  const tabbable = (): Element[] => {
    const s = slide();
    if (!s) return [];
    return (Array.from(s.querySelectorAll("*")) as Element[]).filter((el) => {
      if (!selectable(el as unknown as Parameters<typeof selectable>[0]) || el.closest("[data-away]")) return false;
      return (leafOf(s as never, el as never) as Element | null) === el && el.getBoundingClientRect().width > 0;
    });
  };
  const showKbd = (r: Region | null) => {
    kbd.current = r;
    const sb = slideBox();
    place(areaBox.current, r && sb ? fromRegion(r, sb) : null);
    if (r) announce(`${describeRegion(r)} ${AREA_KEYS}`);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCancelCompose();
    showKbd(null);
    layer.current!.setPointerCapture(e.pointerId);
    drag.current = { p0: local(e), dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const pt = local(e), d = drag.current;
    if (d) {
      if (!d.dragging && isDrag(d.p0, pt)) { d.dragging = true; show(null); }
      if (d.dragging) { const sb = slideBox(); const b = boxOf(d.p0, pt); place(dragBox.current, sb ? intersect(b, sb) : b); }
      return;
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => show(elementAt(pt))); // 한 프레임에 한 번만 계산한다
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current, pt = local(e);
    drag.current = null;
    place(dragBox.current, null);
    if (!d) return;
    if (layer.current!.hasPointerCapture(e.pointerId)) layer.current!.releasePointerCapture(e.pointerId);
    if (d.dragging) { pickRegion(boxOf(d.p0, pt)); return; }
    const el = elementAt(pt);
    if (el) onPick({ el }, boxFromRect(el.getBoundingClientRect()));
  };
  const cancelDrag = () => { drag.current = null; place(dragBox.current, null); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (drag.current) { cancelDrag(); announce("Drag canceled."); }
      else if (kbd.current) { showKbd(null); announce("Area canceled."); }
      else onExit();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey && !kbd.current) return; // 편집기 전역 단축키(Cmd+Z 등)는 그대로 둔다
    const sb = slideBox();
    if (kbd.current) { // 조절 상자: 방향키 이동, Shift+방향키 크기, Alt 미세, Enter 확정
      if (isArrow(k)) { e.preventDefault(); e.stopPropagation(); showKbd(nudgeRegion(kbd.current, k, e.shiftKey, e.altKey)); return; }
      if (k === "Enter") { e.preventDefault(); e.stopPropagation(); const r = kbd.current; if (sb) { const rb = fromRegion(r, sb); showKbd(null); onPick({ region: r, overlap: overlapOf(rb) }, rb); } return; }
      return;
    }
    if (k === "Tab" || isArrow(k)) { // 요소를 순서대로 가리킨다(Tab과 아래, 오른쪽은 다음, Shift+Tab과 위, 왼쪽은 이전)
      e.preventDefault(); e.stopPropagation();
      const list = tabbable();
      if (!list.length) return;
      const back = (k === "Tab" && e.shiftKey) || k === "ArrowUp" || k === "ArrowLeft";
      const i = hovered.current ? list.indexOf(hovered.current) : -1;
      const next = list[(i < 0 ? (back ? list.length - 1 : 0) : (i + (back ? -1 : 1) + list.length) % list.length)];
      show(next);
      announce(`${nameOf(next)}. Enter to comment on it, A to set an area, S to comment on the slide, Escape to exit.`);
      return;
    }
    if (k === "Enter") { e.preventDefault(); e.stopPropagation(); const el = hovered.current; if (el && el !== slide()) onPick({ el }, boxFromRect(el.getBoundingClientRect())); else onSlide(); return; }
    if (k.toLowerCase() === "a" && !e.shiftKey) { // 가리킨 요소(없으면 슬라이드 전체)의 사각형에서 조절 시작
      e.preventDefault(); e.stopPropagation();
      const el = hovered.current;
      const start = sb && el && el !== slide() ? toRegion(boxFromRect(el.getBoundingClientRect()), sb) : null;
      show(null);
      showKbd(start ?? { x: 0, y: 0, w: 1, h: 1 });
      return;
    }
    if (k.toLowerCase() === "s" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onSlide(); return; }
    if (k.toLowerCase() === "c" && e.shiftKey) { e.preventDefault(); e.stopPropagation(); onExit(); }
  };

  return (
    <div
      ref={layer} data-testid="comment-mode-layer" tabIndex={0} role="group" aria-label="Comment mode"
      className="pointer-events-auto absolute inset-0 outline-none" style={{ cursor: "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={cancelDrag}
      onPointerLeave={() => { if (!drag.current) show(null); }} onKeyDown={onKeyDown}
    >
      <div ref={hoverBox} data-testid="comment-hover" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 hidden border border-focus-ring bg-focus-ring/10">
        <span ref={chip} className="absolute -top-5 left-0 whitespace-nowrap rounded bg-foreground px-1 text-micro text-background" />
      </div>
      <div ref={dragBox} data-testid="comment-drag" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 hidden border border-dashed border-focus-ring bg-focus-ring/10" />
      <div ref={areaBox} data-testid="comment-area" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 hidden border-2 border-dashed border-focus-ring bg-focus-ring/10" />
      <div role="status" aria-live="polite" className="sr-only" data-testid="comment-mode-status">{say}</div>
      <div
        className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-surface-3 px-2 py-1 shadow-surface-3"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="text-micro text-muted-foreground">Comment mode. Click an element or drag an area. Esc to exit.</span>
        <Button size="compact" variant="ghost" onClick={onSlide}>Comment on this slide</Button>
        <Button size="compact" variant="secondary" onClick={onExit}>Done</Button>
      </div>
    </div>
  );
}
