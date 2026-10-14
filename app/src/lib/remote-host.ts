import { useCallback, useEffect, useRef, useState } from "react";

// 발표자 화면 쪽 휴대폰 리모컨: 세션을 만들고, 휴대폰의 명령을 받아 넘기고, 상태를 서버로 올린다. 서버는 app/remote-api.ts.
export type Cmd =
  | { type: "next" } | { type: "prev" }
  | { type: "goto"; n: number }
  | { type: "blank"; mode: "black" | "white" | "off" }
  | { type: "timer"; action: "toggle" | "reset" };
export type RemoteState = { slide: number; total: number; title: string; notes: string; elapsed: number; running: boolean; blank: "black" | "white" | null; target: number };
export type RemoteSession = { code: string; host: string; expires: number };

const JSON_HEADERS = { "Content-Type": "application/json" };

/** 휴대폰이 열 주소. 코드는 해시(#)에 둬서 서버 로그와 Referer에 남지 않는다. */
export const remoteUrl = (folder: string, code: string, origin = location.origin) => `${origin}/remote/${encodeURIComponent(folder)}#code=${code.replace("-", "")}`;
export const isLocalOrigin = (origin = location.origin) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(origin);

export function useRemoteHost(folder: string | undefined, state: RemoteState | null, onCmd: (c: Cmd) => void) {
  const [session, setSession] = useState<RemoteSession | null>(null);
  const cmd = useRef(onCmd), latest = useRef(state), sess = useRef<RemoteSession | null>(null), es = useRef<EventSource | null>(null);
  cmd.current = onCmd; latest.current = state; sess.current = session;

  const push = useCallback(() => {
    const s = sess.current, st = latest.current;
    if (!folder || !s || !st) return;
    fetch(`/api/remote/${encodeURIComponent(folder)}/state`, { method: "POST", headers: { ...JSON_HEADERS, "X-Remote-Key": s.host }, body: JSON.stringify(st) }).catch(() => {});
  }, [folder]);

  const close = useCallback(() => { es.current?.close(); es.current = null; }, []);

  const start = useCallback(async () => {
    if (!folder) return;
    const r = await fetch(`/api/remote/${encodeURIComponent(folder)}/start`, { method: "POST", headers: JSON_HEADERS, body: "{}" });
    if (!r.ok) throw new Error(String(r.status));
    const s = (await r.json()) as RemoteSession;
    close();
    sess.current = s; setSession(s);
    const src = new EventSource(`/api/remote/${encodeURIComponent(folder)}/events?role=host&t=${encodeURIComponent(s.host)}`);
    es.current = src;
    src.onopen = () => push(); // 재연결 때도 마지막 상태를 다시 올린다
    src.onerror = () => { if (src.readyState === EventSource.CLOSED) { setSession(null); sess.current = null; } };
    src.addEventListener("cmd", (e) => { try { cmd.current(JSON.parse((e as MessageEvent).data)); } catch {} });
    src.addEventListener("end", () => { src.close(); setSession(null); sess.current = null; });
  }, [folder, close, push]);

  const stop = useCallback(async () => {
    const s = sess.current;
    close(); setSession(null); sess.current = null;
    if (folder && s) await fetch(`/api/remote/${encodeURIComponent(folder)}/stop`, { method: "POST", headers: { ...JSON_HEADERS, "X-Remote-Key": s.host }, body: "{}" }).catch(() => {});
  }, [folder, close]);

  // 상태가 바뀔 때마다 올린다(타이머가 돌면 초마다).
  useEffect(() => { push(); }, [state, push, session]);
  // 발표자 화면을 닫거나 떠나면 세션을 폐기한다(헤더가 필요해 keepalive fetch를 쓴다).
  useEffect(() => {
    const bye = () => { const s = sess.current; if (folder && s) fetch(`/api/remote/${encodeURIComponent(folder)}/stop`, { method: "POST", headers: { ...JSON_HEADERS, "X-Remote-Key": s.host }, body: "{}", keepalive: true }).catch(() => {}); };
    window.addEventListener("pagehide", bye);
    return () => { window.removeEventListener("pagehide", bye); bye(); es.current?.close(); };
  }, [folder]);

  return { session, start, stop };
}
