import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Frame, Image as ImageIcon, Shapes, Square, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { textual } from "./Canvas";

// 선택한 슬라이드의 요소 트리. 라이브 DOM을 읽기만 하고, 바꾸는 일은 모두 콜백으로 Editor에 맡긴다.
type Props = {
  slide: HTMLElement | null;
  sel: Element | null;
  slideName: string;
  onSelectSlide(): void;
  rev: unknown; // 슬라이드가 바뀔 때마다 달라져 트리를 다시 그린다
  onSelect(el: Element): void;
  onHover(el: Element | null): void;
  onToggleHidden(el: HTMLElement): void;
  onRename(el: Element, name: string): void;
  onMove(el: Element, target: Element, after: boolean): void;
};

const SKIP = /^(SCRIPT|STYLE|TEMPLATE)$/;
const kids = (el: Element) => (el instanceof SVGElement ? [] : [...el.children].filter((c) => !SKIP.test(c.tagName) && !c.matches("aside[data-notes]")));

// 이름 규칙: data-name, 글자 첫 줄, 태그별 기본 이름(Figma에 가까운 말)
const clip = (t: string) => (t.length > 24 ? t.slice(0, 24) + "…" : t);
const nameOf = (el: Element): string => {
  const n = el.getAttribute("data-name");
  if (n) return n;
  const tag = el.tagName.toLowerCase();
  if (el instanceof SVGElement) return "Vector";
  if (tag === "img") return "Image";
  if (tag === "button") return "Button";
  if (tag === "a") return "Link";
  if (tag === "ul" || tag === "ol") return "List";
  if (textual(el)) return clip((el.textContent ?? "").trim().split("\n")[0].trim());
  if (el.children.length) {
    const d = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? "";
    return d.includes("flex") || d.includes("grid") ? "Auto layout" : "Frame";
  }
  return tag.charAt(0).toUpperCase() + tag.slice(1);
};
const iconOf = (el: Element) => (el instanceof SVGElement ? Shapes : el.tagName === "IMG" ? ImageIcon : textual(el) ? Type : Square);

export function LayerTree(p: Props) {
  const [open, setOpen] = useState<Set<Element>>(new Set());
  const [rename, setRename] = useState<Element | null>(null);
  const [drag, setDrag] = useState<Element | null>(null);
  const [drop, setDrop] = useState<{ el: Element; after: boolean } | null>(null);
  const selRow = useRef<HTMLDivElement>(null);
  const [slideOpen, setSlideOpen] = useState(true);

  // 선택한 요소의 조상은 펼친다
  useEffect(() => {
    if (!p.sel || !p.slide) return;
    const up: Element[] = [];
    for (let e = p.sel.parentElement; e && e !== p.slide; e = e.parentElement) up.push(e);
    if (up.some((e) => !open.has(e))) setOpen((s) => new Set([...s, ...up]));
  }, [p.sel]); // eslint-disable-line
  useEffect(() => { selRow.current?.scrollIntoView({ block: "nearest" }); }, [p.sel]);

  if (!p.slide) return null;
  const row = (el: Element, depth: number): React.ReactNode => {
    const ch = kids(el), isOpen = open.has(el), I = iconOf(el);
    const hidden = (el as HTMLElement).style?.display === "none";
    const on = el === p.sel;
    return (
      <div key={[...(el.parentElement?.children ?? [])].indexOf(el)} role="treeitem" aria-selected={on} aria-expanded={ch.length ? isOpen : undefined}>
        <div
          ref={on ? selRow : undefined}
          draggable={rename !== el}
          onDragStart={(e) => { setDrag(el); e.dataTransfer.effectAllowed = "move"; e.stopPropagation(); }}
          onDragOver={(e) => {
            if (!drag || drag === el || drag.contains(el)) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setDrop({ el, after: e.clientY > r.top + r.height / 2 });
          }}
          onDrop={(e) => { e.preventDefault(); if (drag && drop) p.onMove(drag, drop.el, drop.after); setDrag(null); setDrop(null); }}
          onDragEnd={() => { setDrag(null); setDrop(null); }}
          onClick={() => p.onSelect(el)}
          onDoubleClick={() => setRename(el)}
          onMouseEnter={() => p.onHover(el)}
          onMouseLeave={() => p.onHover(null)}
          style={{ paddingLeft: 4 + depth * 12 }}
          className={`group relative flex h-7 cursor-default items-center gap-1 rounded-md pr-1 text-body ${on ? "bg-hover text-foreground" : "text-muted-foreground hover:bg-hover"} ${hidden ? "opacity-50" : ""}`}
        >
          {drop?.el === el && <div className={`absolute inset-x-1 h-0.5 rounded bg-focus-ring ${drop.after ? "-bottom-px" : "-top-px"}`} />}
          <span className="flex size-4 shrink-0 items-center justify-center">
            {ch.length > 0 && (
              <button aria-label={isOpen ? "Collapse" : "Expand"} className="flex size-4 items-center justify-center rounded hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); setOpen((s) => { const n = new Set(s); n.has(el) ? n.delete(el) : n.add(el); return n; }); }}>
                {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
            )}
          </span>
          <I className="size-3.5 shrink-0" />
          {rename === el ? (
            <input
              autoFocus aria-label="Layer name" defaultValue={el.getAttribute("data-name") ?? nameOf(el)}
              className="min-w-0 flex-1 rounded bg-surface-2 px-1 text-body text-foreground outline-none ring-1 ring-focus-ring"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === "Enter") { p.onRename(el, e.currentTarget.value.trim()); setRename(null); } else if (e.key === "Escape") setRename(null); e.stopPropagation(); }}
              onBlur={() => setRename(null)}
            />
          ) : <span className="min-w-0 flex-1 truncate">{nameOf(el)}</span>}
          <Tooltip content={hidden ? "Show (removes display: none)" : "Hide (sets display: none, saved with the deck)"} side="left">
            <Button aria-label={hidden ? "Show layer" : "Hide layer"} aria-pressed={hidden} variant="ghost" size="icon-compact"
              className={hidden ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"}
              onClick={(e) => { e.stopPropagation(); p.onToggleHidden(el as HTMLElement); }}>
              {hidden ? <EyeOff /> : <Eye />}
            </Button>
          </Tooltip>
        </div>
        {isOpen && ch.length > 0 && <div role="group">{ch.map((c) => row(c, depth + 1))}</div>}
      </div>
    );
  };

  const rootSel = p.sel === null;
  return (
    <div role="tree" aria-label="Layers" className="flex flex-col gap-px p-2" onMouseLeave={() => p.onHover(null)}>
      <div role="treeitem" aria-selected={rootSel} aria-expanded={slideOpen}>
        <div onClick={p.onSelectSlide} style={{ paddingLeft: 4 }}
          className={`flex h-7 cursor-default items-center gap-1 rounded-md pr-1 text-body ${rootSel ? "bg-hover text-foreground" : "text-muted-foreground hover:bg-hover"}`}>
          <span className="flex size-4 shrink-0 items-center justify-center">
            <button aria-label={slideOpen ? "Collapse slide" : "Expand slide"} className="flex size-4 items-center justify-center rounded hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setSlideOpen((v) => !v); }}>
              {slideOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          </span>
          <Frame className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{p.slideName}</span>
        </div>
        {slideOpen && <div role="group">{kids(p.slide).map((c) => row(c, 1))}</div>}
      </div>
    </div>
  );
}
