"use client";

import type { ReactNode } from "react";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

interface InspectorSectionProps {
  /** 시험과 추적에 쓰는 이름(data-section). */
  id: string;
  title: ReactNode;
  /** 헤더 오른쪽 슬롯(+, 눈 같은 아이콘 버튼). */
  action?: ReactNode;
  children?: ReactNode;
}

// Figma 디자인 패널처럼 접지 않는 섹션: 제목 한 줄과 우측 액션, 아래에 내용. 안쪽 여백은 상하좌우 16px로 같다.
export function InspectorSection({ id, title, action, children }: InspectorSectionProps) {
  const size = useSize();
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <section data-section={id} className="border-b border-border/60 p-4">
      <div className={cn("-my-1 flex items-center justify-between", size.control)}>
        <h3 className={cn("truncate font-semibold", size.type.caption)}>{title}</h3>
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </div>
      {hasBody && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </section>
  );
}
