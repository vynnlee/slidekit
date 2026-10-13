import { useEffect, useState, type ReactNode } from "react";

type Props = {
  toolbar: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** 전체화면 발표자 화면처럼 툴바와 패널을 숨긴다(언마운트하지 않아 iframe 위치가 유지된다). */
  bare?: boolean;
  /** 스크린리더용 h1(화면에는 보이지 않는다)과 양쪽 패널의 landmark 이름 */
  heading?: string;
  leftLabel?: string;
  rightLabel?: string;
};

// 패널 폭은 끌어서 조절하고 localStorage에 기억한다.
const useWidth = (key: string, def: number, min: number, max: number) => {
  const [w, setW] = useState(() => Math.min(max, Math.max(min, Number(localStorage.getItem(key)) || def)));
  const set = (v: number) => { const n = Math.min(max, Math.max(min, Math.round(v))); setW(n); localStorage.setItem(key, String(n)); };
  return [w, set] as const;
};

function Handle({ side, width, onChange }: { side: "left" | "right"; width: number; onChange(w: number): void }) {
  return (
    <div
      role="separator" aria-orientation="vertical" title="Drag to resize, double-click to reset"
      className={`absolute top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-focus-ring/30 active:bg-focus-ring/50 ${side === "left" ? "-right-[3px]" : "-left-[3px]"}`}
      onDoubleClick={() => onChange(-1)}
      onPointerDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX, w0 = width, el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => onChange(w0 + (side === "left" ? m.clientX - x0 : x0 - m.clientX));
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
      }}
    />
  );
}

// 얇은 상단 툴바, 좌측 패널, 중앙 캔버스, 우측 속성 패널. Cmd+\로 패널을 함께 접고 편다.
export function Shell({ toolbar, left, right, children, bare, heading = "slidekit", leftLabel = "Sidebar", rightLabel = "Details" }: Props) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [lw, setLw] = useWidth("sk-left-w", 216, 200, 400);
  const [rw, setRw] = useWidth("sk-right-w", 256, 220, 420);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "\\") return;
      e.preventDefault();
      const open = !(leftOpen || rightOpen);
      setLeftOpen(open && !!left);
      setRightOpen(open && !!right);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftOpen, rightOpen, left, right]);

  return (
    <div className="flex h-full flex-col">
      <header hidden={bare} className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">{toolbar}</header>
      <div className="flex min-h-0 flex-1">
        {left && leftOpen && !bare && (
          <aside aria-label={leftLabel} style={{ width: lw }} className="relative h-full shrink-0 overflow-auto border-r border-border">
            {left}
            <Handle side="left" width={lw} onChange={(w) => setLw(w < 0 ? 216 : w)} />
          </aside>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <h1 className="sr-only">{heading}</h1>
          {children}
        </main>
        {right && rightOpen && !bare && (
          <aside aria-label={rightLabel} style={{ width: rw }} className="relative h-full shrink-0 overflow-auto border-l border-border p-3">
            {right}
            <Handle side="right" width={rw} onChange={(w) => setRw(w < 0 ? 256 : w)} />
          </aside>
        )}
      </div>
    </div>
  );
}
