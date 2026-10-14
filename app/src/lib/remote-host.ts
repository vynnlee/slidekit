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
// 발표자 키는 이 탭의 sessionStorage에만 둔다(새로고침해도 같은 세션을 이어 가고, 다른 탭이나 사람은 세션을 가로채지 못한다).
const keyName = (folder: string) => `slidekit:remote-host:${folder}`;
const storedKey = (folder: string) => { try { return sessionStorage.getItem(keyName(folder)) ?? undefined; } catch { return undefined; } };

/** 휴대폰이 열 주소. 코드는 해시(#)에 둬서 서버 로그와 Referer에 남지 않는다. */
export const remoteUrl = (folder: string, code: string, origin = location.origin) => `${origin}/remote/${encodeURIComponent(folder)}#code=${code.replace("-", "")}`;
export const isLocalOrigin = (origin = location.origin) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(origin);

import { openRemoteStream, type RemoteStream } from "@/lib/remote-stream";

export function useRemoteHost(folder: string | undefined, state: RemoteState | null, onCmd: (c: Cmd) => void) {
  const [session, setSession] = useState<RemoteSession | null>(null);
  const cmd = useRef(onCmd), latest = useRef(state), sess = useRef<RemoteSession | null>(null), es = useRef<RemoteStream | null>(null);
  cmd.current = onCmd; latest.current = state; sess.current = session;

  const push = useCallback(() => {
    const s = sess.current, st = latest.current;
    if (!folder || !s || !st) return;
    fetch(`/api/remote/${encodeURIComponent(folder)}/state`, { method: "POST", headers: { ...JSON_HEADERS, "X-Remote-Key": s.host }, body: JSON.stringify(st) }).catch(() => {});
  }, [folder]);

  const close = useCallback(() => { es.current?.close(); es.current = null; }, []);

  const start = useCallback(async () => {
    if (!folder) return;
    const key = storedKey(folder);
    const r = await fetch(`/api/remote/${encodeURIComponent(folder)}/start`, { method: "POST", headers: key ? { ...JSON_HEADERS, "X-Remote-Key": key } : JSON_HEADERS, body: "{}" });
    if (r.status === 409) throw new Error("active");
    if (!r.ok) throw new Error(String(r.status));
    const s = (await r.json()) as RemoteSession;
    try { sessionStorage.setItem(keyName(folder), s.host); } catch {}
    // 같은 발표자 키로 코드만 새로 받은 경우(틀린 코드 한도, 새로고침)에는 열려 있는 연결을 그대로 둔다.
    const refreshed = !!es.current && sess.current?.host === s.host;
    sess.current = s; setSession(s);
    if (refreshed) return;
    close();
    es.current = openRemoteStream({
      api: `/api/remote/${encodeURIComponent(folder)}`,
      role: "host",
      headers: () => ({ "X-Remote-Key": s.host }),
      onOpen: () => push(), // 재연결 때도 마지막 상태를 다시 올린다
      onDead: () => { es.current = null; setSession(null); sess.current = null; },
      on: {
        cmd: (c) => cmd.current(c),
        // 틀린 코드가 한도에 이르러 서버가 코드를 폐기하면 새 코드를 받아 대화상자를 갱신한다(휴대폰 연결은 유지된다).
        locked: () => { void start().catch(() => {}); },
      },
    });
  }, [folder, close, push]);

  const stop = useCallback(async () => {
    const s = sess.current;
    close(); setSession(null); sess.current = null;
    try { if (folder) sessionStorage.removeItem(keyName(folder)); } catch {}
    if (folder && s) await fetch(`/api/remote/${encodeURIComponent(folder)}/stop`, { method: "POST", headers: { ...JSON_HEADERS, "X-Remote-Key": s.host }, body: "{}" }).catch(() => {});
  }, [folder, close]);

  // 상태가 바뀔 때마다 올린다(타이머가 돌면 초마다).
  useEffect(() => { push(); }, [state, push, session]);
  // 발표자 화면을 닫거나 떠나면 세션을 폐기한다(헤더가 필요해 keepalive fetch를 쓴다).
  useEffect(() => {
    const bye = () => { const s = sess.current; try { if (folder && s) sessionStorage.removeItem(keyName(folder)); } catch {} if (folder && s) fetch(`/api/remote/${encodeURIComponent(folder)}/stop`, { method: "POST", headers: { ...JSON_HEADERS, "X-Remote-Key": s.host }, body: "{}", keepalive: true }).catch(() => {}); };
    window.addEventListener("pagehide", bye);
    return () => { window.removeEventListener("pagehide", bye); bye(); es.current?.close(); };
  }, [folder]);

  return { session, start, stop };
}
