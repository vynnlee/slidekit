import { useSyncExternalStore } from "react";
import { toast, TOAST } from "@/Toaster";

// 코멘트 자동 처리 상태(멈춤과 시간당 상한, spec/COMMENT-FLOOD.md). 서버의 flow 이벤트를 한 연결로 모두가 나눠 쓴다(패널과 작성창).
export type Flow = { paused: boolean; limit: number; used: number; remaining: number | null; resetAt: string | null; reason: "user" | "limit" | null };

let state: Flow | null = null, es: EventSource | null = null, toasted = false;
const subs = new Set<() => void>();
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
/** 한 줄 안내(패널 머리와 작성창이 같은 문구를 쓴다). 멈춤도 상한도 아니면 null. */
export const flowNote = (f: Flow | null) => (f?.reason === "user" ? "Paused. New comments wait until you resume." : f?.reason === "limit" ? `Limit reached (${f.limit} per hour). Resumes at ${hhmm(f.resetAt)}.` : null);

function set(next: Flow) {
  if (next.reason === "limit" && !toasted) { toasted = true; toast(`Comment limit reached: ${next.limit} per hour. New comments wait until ${hhmm(next.resetAt)}.`, { ms: TOAST.error }); }
  if (next.reason !== "limit") toasted = false;
  state = next;
  subs.forEach((f) => f());
}
function subscribe(fn: () => void) {
  subs.add(fn);
  if (!es) {
    es = new EventSource("/api/events");
    es.addEventListener("flow", (e) => { try { set(JSON.parse((e as MessageEvent).data)); } catch { /* 깨진 이벤트는 무시 */ } });
  }
  return () => { subs.delete(fn); if (!subs.size) { es?.close(); es = null; } };
}

/** 지금 자동 처리 상태. 아직 모르면 null. */
export const useFlow = () => useSyncExternalStore(subscribe, () => state);

/** 사용자의 Pause와 Resume. 실패하면 false. */
export async function setPaused(paused: boolean): Promise<boolean> {
  try {
    const r = await fetch("/api/comments/flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused }) });
    if (!r.ok) throw new Error(String(r.status));
    set((await r.json()) as Flow);
    return true;
  } catch { toast("Could not change the pause state", { ms: TOAST.error }); return false; }
}
