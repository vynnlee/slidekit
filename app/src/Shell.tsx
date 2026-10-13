import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spring } from "@/lib/springs";

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

// 폭이 이 값 이하이면 패널은 기본 접힘이고, 열면 콘텐츠 위에 오버레이로 뜬다.
const NARROW = "(max-width: 1100px)";
const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
};

// 얇은 상단 툴바, 좌측 패널, 중앙 캔버스, 우측 속성 패널. Cmd+\로 패널을 함께 접고 편다.
// 좁은 화면(1100px 이하)에서는 패널이 오버레이다: 바깥 클릭이나 Esc로 닫고, 폭은 화면의 85%를 넘지 않는다.
export function Shell({ toolbar, left, right, children, bare, heading = "slidekit", leftLabel = "Sidebar", rightLabel = "Details" }: Props) {
  const narrow = useNarrow();
  const [leftOpen, setLeftOpen] = useState(!narrow);
  const [rightOpen, setRightOpen] = useState(!narrow);
  const [lw, setLw] = useWidth("sk-left-w", 240, 200, 400);
  const [rw, setRw] = useWidth("sk-right-w", 256, 220, 420);

  // 폭 구간을 넘나들면 그 구간의 기본값(넓으면 펼침, 좁으면 접힘)으로 돌린다.
  useEffect(() => { setLeftOpen(!narrow); setRightOpen(!narrow); }, [narrow]);

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

  // Esc는 캡처 단계에서 받는다(화면 안쪽 컴포넌트가 버블 단계에서 삼켜도 닫히게). 열린 메뉴나 목록 팝업이 있으면 그쪽이 먼저 닫힌다.
  const st = useRef({ narrow, leftOpen, rightOpen });
  st.current = { narrow, leftOpen, rightOpen };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      const { narrow, leftOpen, rightOpen } = st.current;
      if (e.key !== "Escape" || !narrow || !(leftOpen || rightOpen)) return;
      if (document.querySelector("[role=menu],[role=listbox],[role=alertdialog]")) return;
      setLeftOpen(false); setRightOpen(false);
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);

  // 오버레이가 열리면 포커스를 패널로 옮기고, 닫히면 연 요소로 되돌린다.
  const opener = useRef<HTMLElement | null>(null), wasOpen = useRef(false);
  const open = narrow && !bare && !!((left && leftOpen) || (right && rightOpen));
  useEffect(() => {
    if (open && !wasOpen.current) {
      opener.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-shell-panel]")?.focus({ preventScroll: true }));
    } else if (!open && wasOpen.current && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  const overlay = narrow && !bare && ((left && leftOpen) || (right && rightOpen));
  const slide = (side: "left" | "right") => ({
    initial: { x: side === "left" ? -24 : 24, opacity: 0 }, animate: { x: 0, opacity: 1 },
    exit: { x: side === "left" ? -24 : 24, opacity: 0, transition: spring.moderate.exit }, transition: spring.moderate,
  });
  const ov = "absolute bottom-0 top-0 z-20 overflow-auto bg-background shadow-surface-3 outline-none";
  const dlg = { role: "dialog", tabIndex: -1, "data-shell-panel": "" } as const;

  return (
    <div className="flex h-full flex-col">
      <header hidden={bare} className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        {narrow && left && <Button variant="ghost" size="icon-compact" aria-label="Toggle sidebar" aria-pressed={leftOpen} onClick={() => setLeftOpen((o) => !o)}><PanelLeft /></Button>}
        {toolbar}
        {narrow && right && <Button variant="ghost" size="icon-compact" aria-label="Toggle details" aria-pressed={rightOpen} onClick={() => setRightOpen((o) => !o)}><PanelRight /></Button>}
      </header>
      <div className="relative flex min-h-0 flex-1">
        {!narrow && left && leftOpen && !bare && (
          <aside aria-label={leftLabel} style={{ width: lw }} className="relative h-full shrink-0 overflow-auto border-r border-border">
            {left}
            <Handle side="left" width={lw} onChange={(w) => setLw(w < 0 ? 240 : w)} />
          </aside>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <h1 className="sr-only">{heading}</h1>
          {children}
        </main>
        {!narrow && right && rightOpen && !bare && (
          <aside aria-label={rightLabel} style={{ width: rw }} className="relative h-full shrink-0 overflow-auto border-l border-border p-3">
            {right}
            <Handle side="right" width={rw} onChange={(w) => setRw(w < 0 ? 256 : w)} />
          </aside>
        )}
        {narrow && !bare && (
          <>
            {overlay && <div data-testid="shell-scrim" className="absolute inset-0 z-10 bg-black/20" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
            <AnimatePresence>
              {left && leftOpen && (
                <motion.aside key="l" {...slide("left")} {...dlg} aria-label={leftLabel} style={{ width: lw, maxWidth: "85%" }} className={`${ov} left-0 border-r border-border`}>{left}</motion.aside>
              )}
              {right && rightOpen && (
                <motion.aside key="r" {...slide("right")} {...dlg} aria-label={rightLabel} style={{ width: rw, maxWidth: "85%" }} className={`${ov} right-0 border-l border-border p-3`}>{right}</motion.aside>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
