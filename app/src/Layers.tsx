import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { previewHtml, type Unit } from "@/lib/deck-source";

const W = 196, S = W / 1920;

// 스크립트 없는 정적 사본을 줄여 보여 준다. 화면에 보일 때만 만든다.
const Thumb = memo(function Thumb({ shell, unit, folder, eager }: { shell: { prefix: string; suffix: string }; unit: Unit; folder: string; eager: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(eager); // 첫 몇 장은 관찰을 기다리지 않고 바로 만든다
  // 화면에 들어오면 잠깐 뒤에 한 번만 만든다. 빨리 지나가는 스크롤에는 만들지 않고, 만든 뒤에는 유지해 깜박임이 없다.
  useEffect(() => {
    if (eager) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e.isIntersecting) t = setTimeout(() => { setSeen(true); io.disconnect(); }, 60);
    }, { rootMargin: "120px" });
    io.observe(ref.current!);
    return () => { clearTimeout(t); io.disconnect(); };
  }, []);
  const doc = useMemo(
    () => (seen ? previewHtml({ ...shell, units: [unit] }, [unit], folder, { thumb: true }) : ""),
    [seen, shell, unit.html, folder], // eslint-disable-line
  );
  return (
    <div ref={ref} className="relative overflow-hidden rounded-md bg-hover" style={{ width: W, height: W * 0.5625 }}>
      {doc && (
        <iframe
          sandbox="" srcDoc={doc} tabIndex={-1} title=""
          className="pointer-events-none absolute left-0 top-0 border-0"
          style={{ width: 1920, height: 1080, transform: `scale(${S})`, transformOrigin: "0 0" }}
        />
      )}
    </div>
  );
});

type Props = {
  shell: { prefix: string; suffix: string };
  folder: string;
  units: Unit[];
  index: number;
  marked: Set<number>; // 열린 코멘트가 있는 슬라이드 번호(저장 기준)
  origin: Map<string, number>;
  onSelect(i: number): void;
  onMove(from: number, to: number): void;
  onDuplicate(i: number): void;
  onDelete(i: number): void;
  onAdd(after: number): void;
};

export function Layers(p: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null); // 삽입 위치(0..n)
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => { rows.current[p.index]?.scrollIntoView({ block: "nearest" }); }, [p.index]);

  const pos = (e: React.DragEvent, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? i : i + 1;
  };
  const end = () => { setDrag(null); setDrop(null); };

  return (
    <div className="flex flex-col gap-1 p-2" onDragEnd={end}>
      {p.units.map((u, i) => (
        <div
          key={u.key}
          ref={(el) => { rows.current[i] = el; }}
          draggable
          onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setDrop(pos(e, i)); }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag !== null && drop !== null) p.onMove(drag, drop > drag ? drop - 1 : drop);
            end();
          }}
          onClick={() => p.onSelect(i)}
          onContextMenu={(e) => { e.preventDefault(); p.onSelect(i); setMenu({ x: e.clientX, y: e.clientY, i }); }}
          className="relative flex items-start gap-2 rounded-lg p-1"
        >
          {drop === i && drag !== null && <div className="absolute inset-x-0 -top-1 h-0.5 rounded bg-focus-ring" />}
          {drop === i + 1 && i === p.units.length - 1 && drag !== null && <div className="absolute inset-x-0 -bottom-1 h-0.5 rounded bg-focus-ring" />}
          <span className={`w-5 shrink-0 pt-1 text-right text-caption tabular-nums ${i === p.index ? "text-foreground" : "text-muted-foreground"}`}>{i + 1}</span>
          <div className={`relative rounded-md ring-2 ${i === p.index ? "ring-focus-ring" : "ring-transparent"}`}>
            <Thumb shell={p.shell} unit={u} folder={p.folder} eager={i < 4} />
            {p.marked.has(p.origin.get(u.key) ?? -1) && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-focus-ring ring-2 ring-black" />}
          </div>
        </div>
      ))}
      <DropdownMenu open={!!menu} onOpenChange={(o) => !o && setMenu(null)} size="compact">
        <DropdownTrigger render={<span className="fixed h-0 w-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />} />
        <DropdownContent align="start" side="bottom" sideOffset={0}>
          <MenuItem index={0} icon={Copy} label="복제" onSelect={() => menu && p.onDuplicate(menu.i)} />
          <MenuItem index={1} icon={Plus} label="뒤에 추가" onSelect={() => menu && p.onAdd(menu.i)} />
          <MenuItem index={2} icon={Trash2} label="삭제" disabled={p.units.length < 2} onSelect={() => menu && p.onDelete(menu.i)} />
        </DropdownContent>
      </DropdownMenu>
    </div>
  );
}
