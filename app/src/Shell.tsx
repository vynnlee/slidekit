import { useEffect, useState, type ReactNode } from "react";
import { SidebarProvider, Sidebar, SidebarContent, SidebarInset } from "@/components/ui/sidebar";

type Props = {
  toolbar: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** 전체화면 발표자 화면처럼 툴바와 패널을 숨긴다(언마운트하지 않아 iframe 위치가 유지된다). */
  bare?: boolean;
};

// 얇은 상단 툴바, 좌측 패널, 중앙 캔버스, 우측 속성 패널. Cmd+\로 패널을 함께 접고 편다.
export function Shell({ toolbar, left, right, children, bare }: Props) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

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
      <SidebarProvider open={leftOpen} onOpenChange={setLeftOpen} persist={false} className="min-h-0 flex-1">
        {left && !bare && (
          <Sidebar className="!h-full">
            <SidebarContent>{left}</SidebarContent>
          </Sidebar>
        )}
        <SidebarInset className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</SidebarInset>
        {right && rightOpen && !bare && (
          <aside className="h-full w-64 shrink-0 overflow-auto border-l border-border p-3">{right}</aside>
        )}
      </SidebarProvider>
    </div>
  );
}
