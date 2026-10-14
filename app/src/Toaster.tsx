import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// 의존성 없는 작은 토스트. toast("문구", { action: { label, onClick } })로 어디서든 띄운다.
type T = { id: number; text: string; action?: { label: string; onClick: () => void }; ms: number };
let list: T[] = [];
let next = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

// 지속 시간 규칙: 복사 확인 2초, 알림 3초, 긴 안내 4초, 오류 5초, 실행 취소가 붙은 것 8초. 기본은 알림이다.
export const TOAST = { copy: 2000, info: 3000, long: 4000, error: 5000, undo: 8000 } as const;

export function toast(text: string, opts: { action?: T["action"]; ms?: number } = {}) {
  const t = { id: next++, text, action: opts.action, ms: opts.ms ?? (opts.action ? TOAST.undo : TOAST.info) };
  list = [...list, t].slice(-3);
  emit();
  return t.id;
}
const dismiss = (id: number) => { list = list.filter((t) => t.id !== id); emit(); };

export function Toaster() {
  const [items, setItems] = useState<T[]>(list);
  useEffect(() => {
    const f = () => setItems(list);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  useEffect(() => {
    const timers = items.map((t) => setTimeout(() => dismiss(t.id), t.ms));
    return () => timers.forEach(clearTimeout);
  }, [items]);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface-3 py-1.5 pl-3 pr-1.5 text-body shadow-surface-3">
          <span>{t.text}</span>
          {t.action && <Button variant="ghost" size="compact" className="font-medium text-foreground" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</Button>}
        </div>
      ))}
    </div>
  );
}
