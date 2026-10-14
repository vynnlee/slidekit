import { useSyncExternalStore } from "react";

// 서버 연결 상태의 단일 출처. ConnectionStatus가 /api/ping 결과로 바꾸고, 다른 화면은 읽기만 한다.
// 끊김에서 복구되면 window에 "slidekit:reconnected"를 보내 목록 같은 화면이 다시 불러오게 한다.
let down = false;
const subs = new Set<() => void>();

export const isDown = () => down;
export function setDown(v: boolean) {
  if (v === down) return;
  down = v;
  subs.forEach((f) => f());
  if (!v) window.dispatchEvent(new Event("slidekit:reconnected"));
}
export const useServerDown = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, isDown, () => false);
export const onReconnect = (fn: () => void) => { window.addEventListener("slidekit:reconnected", fn); return () => window.removeEventListener("slidekit:reconnected", fn); };
export const UNREACHABLE = "Server unreachable. Try again when reconnected.";
