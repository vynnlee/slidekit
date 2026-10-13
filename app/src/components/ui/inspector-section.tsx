"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useSize } from "@/lib/size-context";

const STORAGE_KEY = "slidekit.inspector.collapsed";

// 저장된 값은 접힌 id 배열. 저장소가 없거나 깨졌으면 null.
function readCollapsed(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function writeCollapsed(id: string, collapsed: boolean) {
  try {
    const set = new Set(readCollapsed() ?? []);
    if (collapsed) set.add(id); else set.delete(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // 저장 실패는 무시한다(접힘 상태만 기억 못 함)
  }
}

interface InspectorSectionProps {
  id: string;
  title: ReactNode;
  /** 헤더 오른쪽 슬롯. 호버 때만 보이게 하는 것은 호출 측이 정한다. */
  action?: ReactNode;
  /** 저장된 상태가 없을 때의 초기 상태. 기본 true. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function InspectorSection({ id, title, action, defaultOpen = true, children }: InspectorSectionProps) {
  const size = useSize();
  const [open, setOpen] = useState(() => {
    const stored = readCollapsed();
    return stored ? !stored.includes(id) :defaultOpen;
  });
  const panelId = `inspector-section-${id}`;

  const toggle = () => {
    writeCollapsed(id, open);
    setOpen(!open);
  };

  return (
    <section className="border-b border-border/60">
      <div className={cn("flex items-center", size.control)}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={cn(
            "flex h-full min-w-0 flex-1 cursor-pointer items-center px-3 text-left text-foreground outline-none",
            "focus-visible:ring-2 focus-visible:ring-focus-ring",
            size.gap
          )}
        >
          <span className={cn("truncate font-semibold", size.type.caption)}>{title}</span>
          <ChevronDown
            size={size.icon}
            aria-hidden
            className={cn("shrink-0 text-muted-foreground transition-transform duration-80", !open && "-rotate-90")}
          />
        </button>
        {action && <div className="flex shrink-0 items-center pr-3">{action}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: spring.moderate }}
            exit={{ height: 0, opacity: 0, transition: spring.moderate.exit }}
          >
            <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
