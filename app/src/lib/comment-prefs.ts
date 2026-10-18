import { useSyncExternalStore } from "react";

// 해결한 코멘트의 핀을 캔버스에 보일지(기본은 숨김). 이 기기의 브라우저에 저장하고, 패널과 캔버스가 같은 값을 본다.
const KEY = "slidekit.comments.showResolved";
const subs = new Set<() => void>();
let on = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export function setShowResolved(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* 저장 불가: 이 창에서만 */ }
  subs.forEach((f) => f());
}
export const useShowResolved = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => on, () => false);
