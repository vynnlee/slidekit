import type { ReactNode } from "react";

// 빈 화면, 오류, 없는 덱 같은 상태를 가운데에 짧게 보여 주고 다음 동작을 붙인다.
export function StatusPage({ title, children, actions, role }: { title: string; children?: ReactNode; actions?: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-subtitle font-medium">{title}</h1>
      {children && <p className="max-w-sm text-body text-muted-foreground">{children}</p>}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
