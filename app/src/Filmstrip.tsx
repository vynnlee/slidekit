import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { previewHtml, type Unit } from "@/lib/deck-source";
import { CURSOR_CLASS } from "@/lib/cursors";
import { acquireThumb } from "@/lib/thumb-queue";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItems } from "@/components/ui/context-menu";
import type { MenuItem as MenuItemModel } from "@/lib/menu-model";
import { LAYOUTS } from "../../engine/layouts";

// 스크립트 없는 정적 사본을 줄여 보여 준다. 화면 근처(좌우 120px)에서 대기열(동시 3개)을 거쳐 올리고,
// 220px 넘게 멀어지면 내려 53장을 넘겨도 iframe이 쌓이지 않게 한다. 첫 6장(eager)과 활성 슬라이드(keep)는 큐 없이 바로 올리고 내리지 않는다.
const Thumb = memo(function Thumb({ shell, unit, folder, eager, keep }: { shell: { prefix: string; suffix: string }; unit: Unit; folder: string; eager: boolean; keep: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(128);
  const [seen, setSeen] = useState(eager);
  const keepRef = useRef(keep);
  keepRef.current = keep;
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => { if (keep) setSeen(true); }, [keep]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined, guard: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | null = null;
    const root = ref.current!.closest("[data-radix-scroll-area-viewport],[data-slot=scroll-area-viewport]");
    const start = () => {
      if (cancel || keepRef.current) return;
      cancel = acquireThumb((release) => {
        releaseRef.current = release;
        setSeen(true);
        guard = setTimeout(release, 5000); // 로드 이벤트가 안 와도 슬롯은 돌려준다
      });
    };
    const stop = () => {
      clearTimeout(t); clearTimeout(guard);
      if (keepRef.current) return;
      cancel?.(); cancel = null; releaseRef.current = null; setSeen(false);
    };
    const near = new IntersectionObserver(([e]) => { clearTimeout(t); if (e.isIntersecting) t = setTimeout(start, 60); }, { root, rootMargin: "0px 120px 0px 120px" });
    const far = new IntersectionObserver(([e]) => { if (!e.isIntersecting) stop(); }, { root, rootMargin: "0px 220px 0px 220px" });
    near.observe(ref.current!); far.observe(ref.current!);
    return () => { near.disconnect(); far.disconnect(); stop(); };
  }, []);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  const doc = useMemo(
    () => (seen ? previewHtml({ ...shell, units: [unit] }, [unit], folder, { thumb: true }) : ""),
    [seen, shell, unit.html, folder], // eslint-disable-line
  );
  return (
    <div ref={ref} className="relative size-full overflow-hidden rounded-md bg-hover">
      {doc && (
        <iframe
          sandbox="" srcDoc={doc} tabIndex={-1} title=""
          onLoad={() => releaseRef.current?.()}
          className="pointer-events-none absolute left-0 top-0 border-0"
          style={{ width: 1920, height: 1080, transform: `scale(${w / 1920})`, transformOrigin: "0 0" }}
        />
      )}
    </div>
  );
});

// + 타일: 레이아웃 다섯 가지를 고른다. 메뉴가 열려 있을 때 1부터 5 키로도 고른다. 기본(Add slide를 그냥 누를 때)은 직전 슬라이드와 같은 레이아웃이다.
function AddSlideMenu({ height, onAdd }: { height: number; onAdd(layoutId?: string): void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { const n = Number(e.key); if (n >= 1 && n <= LAYOUTS.length && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); setOpen(false); onAdd(LAYOUTS[n - 1].id); } };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [open, onAdd]);
  const items: MenuItemModel[] = LAYOUTS.map((l, i) => ({ type: "item", id: l.id, label: l.label, shortcut: String(i + 1), onSelect: () => onAdd(l.id) }));
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} size="compact">
      <Tooltip content="Add slide" side="bottom">
        <DropdownTrigger render={<Button aria-label="Add slide" variant="ghost" size="icon-compact" className="shrink-0" style={{ height }}><Plus /></Button>} />
      </Tooltip>
      <DropdownContent align="start" side="bottom">
        <MenuItems items={items} />
      </DropdownContent>
    </DropdownMenu>
  );
}

type Props = {
  shell: { prefix: string; suffix: string };
  folder: string;
  units: Unit[];
  index: number;
  marked: Set<number>; // 열린 코멘트가 있는 슬라이드 번호(저장 기준)
  origin: Map<string, number>;
  collapsed: boolean;
  onToggle(): void;
  found?: Map<number, number>; // 찾기 결과: 슬라이드별 일치 수
  warn?: Set<number>; // 내용이 슬라이드 밖으로 넘치는 슬라이드(열어 본 것만 안다)
  updated?: Set<number>; // 밖에서 바뀐 슬라이드(잠시 표시)
  onSelect(i: number): void;
  onMenu(i: number, at: { x: number; y: number }): void; // 우클릭이나 메뉴 키(선택은 호출 쪽이 먼저 한다)
  onMove(from: number, to: number): void;
  onDuplicate(i: number): void;
  onDelete(i: number): void;
  onAdd(after: number, layoutId?: string): void;
};

// 캔버스 위 가로 슬라이드 목록. 순서 변경은 가로 드래그, 키보드는 listbox 규칙(좌우, Home, End)이다.
export function Filmstrip(p: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null); // 삽입 위치(0..n)
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1100px)").matches);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const H = narrow ? 56 : 72, W = Math.round((H * 16) / 9);

  useEffect(() => {
    const mq = matchMedia("(max-width: 1100px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => { items.current[p.index]?.scrollIntoView({ block: "nearest", inline: "center" }); }, [p.index, p.collapsed]);

  const pos = (e: React.DragEvent, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? i : i + 1;
  };
  const end = () => { setDrag(null); setDrop(null); };
  const go = (j: number) => {
    const k = Math.max(0, Math.min(p.units.length - 1, j));
    p.onSelect(k);
    requestAnimationFrame(() => items.current[k]?.focus());
  };

  return (
    <section data-testid="filmstrip" aria-label="Slide filmstrip" className="shrink-0 border-b border-border">
      <div className="flex h-7 items-center gap-1 px-2">
        <Tooltip content={p.collapsed ? "Show filmstrip" : "Hide filmstrip"} side="bottom">
          <Button aria-label={p.collapsed ? "Show filmstrip" : "Hide filmstrip"} aria-expanded={!p.collapsed} variant="ghost" size="icon-compact" onClick={p.onToggle}>
            {p.collapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
        </Tooltip>
        <span className="text-caption tabular-nums text-muted-foreground">Slide {p.index + 1} / {p.units.length}</span>
      </div>
      {!p.collapsed && (
        <ScrollArea orientation="horizontal" className="[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
          <div
            role="listbox" aria-label="Slides" aria-orientation="horizontal" className="flex items-center gap-2 p-2" /* 링(ring-2)이 스크롤 영역 안쪽에서 잘리지 않게 여유를 둔다 */
            onDragEnd={end}
            onKeyDown={(e) => {
              if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); e.stopPropagation(); const r = (e.target as HTMLElement).getBoundingClientRect(); p.onMenu(p.index, { x: r.left, y: r.bottom }); return; }
              const move = e.key === "ArrowLeft" ? p.index - 1 : e.key === "ArrowRight" ? p.index + 1 : e.key === "Home" ? 0 : e.key === "End" ? p.units.length - 1 : null;
              if (move === null) return;
              e.preventDefault(); e.stopPropagation(); // 편집기 전체 방향키 이동과 겹치지 않게 한다
              go(move);
            }}
          >
            {p.units.map((u, i) => (
              <div
                key={u.key}
                ref={(el) => { items.current[i] = el; }}
                role="option" aria-selected={i === p.index} aria-label={`Slide ${i + 1}`}
                tabIndex={i === p.index ? 0 : -1}
                draggable
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setDrop(pos(e, i)); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag !== null && drop !== null) p.onMove(drag, drop > drag ? drop - 1 : drop);
                  end();
                }}
                onClick={() => p.onSelect(i)}
                onContextMenu={(e) => { e.preventDefault(); p.onMenu(i, { x: e.clientX, y: e.clientY }); }}
                className={`relative shrink-0 ${CURSOR_CLASS.grab} rounded-md outline-none ring-2 focus-visible:ring-focus-ring ${i === p.index ? "ring-focus-ring" : "ring-transparent"}`}
                style={{ width: W, height: H }}
              >
                {drop === i && drag !== null && <div className="absolute -left-1.5 inset-y-0 w-0.5 rounded bg-focus-ring" />}
                {drop === i + 1 && i === p.units.length - 1 && drag !== null && <div className="absolute -right-1.5 inset-y-0 w-0.5 rounded bg-focus-ring" />}
                {p.found?.get(i) ? <span aria-label={`${p.found.get(i)} matches`} className="pointer-events-none absolute left-6 top-1 z-10 rounded bg-focus-ring px-1 py-0.5 text-micro leading-none tabular-nums text-white">{p.found.get(i)}</span> : null}
                {p.warn?.has(i) && <span role="img" aria-label="Content overflows" title="Content overflows the slide" className="pointer-events-none absolute bottom-1 right-1 z-10 rounded bg-destructive px-0.5 py-0.5 text-white"><TriangleAlert className="size-3" /></span>}
                {p.updated?.has(i) && <span aria-label="Updated" className="pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-focus-ring px-1 py-0.5 text-micro leading-none text-white">Updated</span>}
                <Thumb shell={p.shell} unit={u} folder={p.folder} eager={i < 6} keep={i === p.index} />
                <span aria-hidden="true" className={`pointer-events-none absolute left-1 top-1 rounded px-1 py-0.5 text-micro leading-none tabular-nums text-white ${i === p.index ? "bg-focus-ring" : "bg-black/75"}`}>{i + 1}</span>
                {p.marked.has(p.origin.get(u.key) ?? -1) && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-focus-ring ring-2 ring-black" />}
              </div>
            ))}
            <AddSlideMenu height={H} onAdd={(id) => p.onAdd(p.units.length - 1, id)} />
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
