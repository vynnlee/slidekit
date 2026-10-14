import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusPage } from "./StatusPage";
import { markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import type { Cmd, RemoteState } from "@/lib/remote-host";

// 휴대폰 리모컨 페이지(발표자 화면이 만든 주소로 연다). 이 페이지만 터치 목표를 44px 이상으로 둔다.
// 명령은 버튼 탭으로만 보낸다(스와이프나 화면 탭 이동은 없다).
const NOTES_KEY = "slidekit:remote-notes-size", MIN = 14, MAX = 36;
const hms = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const tokenKey = (id: string) => `slidekit:remote:${id}`;

type Phase = "joining" | "code" | "live" | "ended";
const JOIN_ERRORS: Record<string, string> = {
  code: "That code is not valid or was already used. Ask the presenter for a new one.",
  limit: "Too many tries. Wait a minute and try again.",
  none: "No remote is running for this deck. Start it from the presenter screen.",
};

export function Remote({ id }: { id: string }) {
  const api = `/api/remote/${encodeURIComponent(id)}`;
  const [phase, setPhase] = useState<Phase>("joining");
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(tokenKey(id)));
  const [state, setState] = useState<RemoteState | null>(null);
  const [online, setOnline] = useState(false);
  const [err, setErr] = useState("");
  const [typed, setTyped] = useState("");
  const [armed, setArmed] = useState(false); // 리셋은 두 번 눌러야 한다(실수 방지)
  const [size, setSize] = useState(() => Math.min(MAX, Math.max(MIN, Number(localStorage.getItem(NOTES_KEY)) || 20)));

  const join = useCallback(async (code: string) => {
    setErr("");
    const r = await fetch(`${api}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => null);
    if (!r) { setErr("Could not reach the server."); setPhase("code"); return; }
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.token) { sessionStorage.setItem(tokenKey(id), j.token); setToken(j.token); }
    else { setErr(JOIN_ERRORS[j.error] ?? "Could not join."); setPhase("code"); }
  }, [api, id]);

  // 주소의 #code를 한 번 교환하고 바로 지운다.
  useEffect(() => {
    const m = /^#code=([A-Za-z0-9-]+)$/.exec(location.hash);
    if (m) { history.replaceState(null, "", location.pathname); void join(m[1]); }
    else if (!token) setPhase("code");
  }, []);

  // 상태 구독. 끊기면 브라우저가 다시 붙고, 서버가 마지막 상태를 다시 보낸다. 만료나 폐기(403)는 다시 붙지 않는다.
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${api}/events?t=${encodeURIComponent(token)}`);
    es.onopen = () => setPhase("live");
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) { sessionStorage.removeItem(tokenKey(id)); setToken(null); setPhase("ended"); } };
    es.addEventListener("state", (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("presence", (e) => setOnline(JSON.parse((e as MessageEvent).data).online === true));
    es.addEventListener("end", () => { es.close(); sessionStorage.removeItem(tokenKey(id)); setToken(null); setPhase("ended"); });
    return () => es.close();
  }, [token, api, id]);

  // 화면 꺼짐 방지(지원하는 브라우저만). 탭이 다시 보일 때 다시 잡는다.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const get = () => { (navigator as unknown as { wakeLock?: { request(t: string): Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }, () => {}); };
    const vis = () => { if (document.visibilityState === "visible") get(); };
    get(); document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); lock?.release().catch(() => {}); };
  }, []);

  useEffect(() => { localStorage.setItem(NOTES_KEY, String(size)); }, [size]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = async (c: Cmd) => {
    if (!token) return;
    const r = await fetch(`${api}/cmd`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(c) }).catch(() => null);
    if (r?.status === 409) setErr("The presenter screen is offline.");
    else if (r?.status === 403) { sessionStorage.removeItem(tokenKey(id)); setToken(null); setPhase("ended"); }
    else if (r && r.ok) setErr("");
  };
  const reset = () => {
    if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 2500); return; }
    setArmed(false); void send({ type: "timer", action: "reset" });
  };

  if (phase === "joining") return <StatusPage role="status" title="Connecting" />;
  if (phase === "ended") return <StatusPage role="alert" title="Remote ended" actions={<Button variant="primary" onClick={() => setPhase("code")}>Enter a new code</Button>}>The presenter stopped the remote or the session expired.</StatusPage>;
  if (phase === "code" || !state) {
    return phase === "code" ? (
      <form className="mx-auto flex h-full max-w-sm flex-col justify-center gap-3 p-6" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { setPhase("joining"); void join(typed); } }}>
        <h1 className="text-subtitle font-medium">Phone remote</h1>
        <p className="text-body text-muted-foreground">Enter the code shown on the presenter screen.</p>
        <Field autoFocus aria-label="Pairing code" autoCapitalize="characters" autoComplete="off" inputMode="text" placeholder="XXXX-XXXX" className="h-12 text-center text-lg uppercase tracking-widest" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <p role={err ? "alert" : undefined} className="min-h-4 text-caption text-destructive">{err}</p>
        <Button type="submit" variant="primary" className="h-12 text-body" disabled={!typed.trim()}>Join</Button>
      </form>
    ) : <StatusPage role="status" title="Waiting for the presenter" />;
  }

  const big = "h-14 min-w-0 flex-1 text-body";
  const blankOn = state.blank;
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] touch-manipulation">
      <header className="flex items-baseline gap-3">
        <h1 className="text-subtitle font-medium tabular-nums" aria-label="Current slide">{state.slide} / {state.total}</h1>
        <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{state.title}</span>
        <span className="text-body tabular-nums" role="timer" aria-label="Elapsed time">{hms(state.elapsed)}</span>
      </header>
      {(!online || err) && <p role="status" className="rounded bg-hover px-2 py-1 text-caption text-foreground">{!online ? "The presenter screen is offline." : err}</p>}
      <section aria-label="Speaker notes" className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-hover p-3" style={{ fontSize: size }}>
        {state.notes ? <div className="space-y-2" dangerouslySetInnerHTML={{ __html: markdown(state.notes) }} /> : <p className="text-muted-foreground">No notes</p>}
      </section>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="h-11 w-11 min-w-0 px-0" aria-label="Smaller notes" onClick={() => setSize((n) => Math.max(MIN, n - 2))}><Minus /></Button>
        <Button variant="secondary" className="h-11 w-11 min-w-0 px-0" aria-label="Larger notes" onClick={() => setSize((n) => Math.min(MAX, n + 2))}><Plus /></Button>
        <Button variant="secondary" className="h-11 flex-1" aria-label={state.running ? "Pause timer" : "Start timer"} leadingIcon={state.running ? Pause : Play} onClick={() => send({ type: "timer", action: "toggle" })}>{state.running ? "Pause" : "Start"}</Button>
        <Button variant="secondary" className="h-11 flex-1" leadingIcon={RotateCcw} onClick={reset}>{armed ? "Tap to reset" : "Reset"}</Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="h-11 flex-1" aria-pressed={blankOn === "black"} active={blankOn === "black"} onClick={() => send({ type: "blank", mode: blankOn === "black" ? "off" : "black" })}>Black</Button>
        <Button variant="secondary" className="h-11 flex-1" aria-pressed={blankOn === "white"} active={blankOn === "white"} onClick={() => send({ type: "blank", mode: blankOn === "white" ? "off" : "white" })}>White</Button>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className={cn(big)} leadingIcon={ChevronLeft} aria-label="Previous slide" disabled={!online} onClick={() => send({ type: "prev" })}>Prev</Button>
        <Button variant="primary" className={cn(big)} trailingIcon={ChevronRight} aria-label="Next slide" disabled={!online} onClick={() => send({ type: "next" })}>Next</Button>
      </div>
    </div>
  );
}
