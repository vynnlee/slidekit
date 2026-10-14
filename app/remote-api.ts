// 휴대폰 리모컨 중계. 서버는 메모리 상태만 갖고 파일과 편집 API에는 닿지 않는다.
//   발표자 화면(host) <-> 서버 <-> 휴대폰(viewer): 명령은 viewer -> host, 상태는 host -> viewer.
// 코드는 발표자가 시작할 때 만들고 해시만 보관하며 1회용이다. 교환하면 세션 토큰을 받고, 시작과 종료와 2시간 만료에 폐기한다.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { deckFolder } from "./folder";

export const TTL_MS = 2 * 3600_000;
const JOIN_FAILS = 5, JOIN_WINDOW = 60_000; // 틀린 코드는 덱마다 분당 5번까지
const CMD_PER_SEC = 10;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type Cmd =
  | { type: "next" } | { type: "prev" }
  | { type: "goto"; n: number }
  | { type: "blank"; mode: "black" | "white" | "off" }
  | { type: "timer"; action: "toggle" | "reset" };
export type RemoteState = { slide: number; total: number; title: string; notes: string; elapsed: number; running: boolean; blank: "black" | "white" | null; target: number };
export type Sink = { send(event: string, data: unknown): void; close(): void };

/** 허용한 명령만 통과시킨다. 그 밖의 모양은 null. */
export function parseCmd(b: unknown): Cmd | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (o.type === "next" || o.type === "prev") return { type: o.type };
  if (o.type === "goto") return Number.isInteger(o.n) && (o.n as number) >= 1 && (o.n as number) <= 9999 ? { type: "goto", n: o.n as number } : null;
  if (o.type === "blank") return o.mode === "black" || o.mode === "white" || o.mode === "off" ? { type: "blank", mode: o.mode } : null;
  if (o.type === "timer") return o.action === "toggle" || o.action === "reset" ? { type: "timer", action: o.action } : null;
  return null;
}

const int = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : 0);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
export function parseState(b: unknown): RemoteState | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (!Number.isInteger(o.slide) || !Number.isInteger(o.total) || (o.slide as number) < 1 || (o.total as number) < 1) return null;
  return {
    slide: int(o.slide, 9999), total: int(o.total, 9999), title: text(o.title, 200), notes: text(o.notes, 8000),
    elapsed: int(o.elapsed, 86400 * 7), running: o.running === true, blank: o.blank === "black" || o.blank === "white" ? o.blank : null, target: int(o.target, 999),
  };
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const normCode = (c: unknown) => (typeof c === "string" ? c.toUpperCase().replace(/[^A-Z2-7]/g, "") : "");
const randCode = () => [...randomBytes(8)].map((n) => B32[n & 31]).join(""); // 40비트
const token = () => randomBytes(24).toString("base64url");

type Session = {
  code: Buffer | null; host: Buffer; expires: number;
  viewers: Map<string, number[]>; // 토큰 해시(hex) -> 최근 명령 시각
  state: RemoteState | null; hosts: Set<Sink>; sinks: Set<Sink>; fails: number[];
};

export function createHub(now: () => number = Date.now) {
  const sessions = new Map<string, Session>();
  const end = (id: string) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    for (const k of [...s.sinks, ...s.hosts]) { try { k.send("end", {}); k.close(); } catch {} }
  };
  const get = (id: string) => {
    const s = sessions.get(id);
    if (s && now() >= s.expires) { end(id); return undefined; }
    return s;
  };
  const presence = (s: Session) => { for (const v of s.sinks) v.send("presence", { online: s.hosts.size > 0 }); };

  return {
    start(id: string) {
      end(id);
      const code = randCode(), host = token();
      sessions.set(id, { code: sha(code), host: sha(host), expires: now() + TTL_MS, viewers: new Map(), state: null, hosts: new Set(), sinks: new Set(), fails: [] });
      return { code: `${code.slice(0, 4)}-${code.slice(4)}`, host, expires: now() + TTL_MS };
    },
    stop(id: string, hostKey: string) {
      const s = get(id);
      if (!s || !same(s.host, sha(hostKey))) return false;
      end(id);
      return true;
    },
    join(id: string, code: unknown): { token: string } | { error: "none" | "code" | "limit" } {
      const s = get(id);
      if (!s) return { error: "none" };
      const t = now();
      s.fails = s.fails.filter((x) => t - x < JOIN_WINDOW);
      if (s.fails.length >= JOIN_FAILS) return { error: "limit" };
      const c = normCode(code);
      if (!s.code || c.length !== 8 || !same(s.code, sha(c))) { s.fails.push(t); return { error: "code" }; }
      s.code = null; // 1회용
      const tk = token();
      s.viewers.set(sha(tk).toString("hex"), []);
      return { token: tk };
    },
    setState(id: string, hostKey: string, st: RemoteState) {
      const s = get(id);
      if (!s || !same(s.host, sha(hostKey))) return false;
      s.state = st;
      for (const v of s.sinks) v.send("state", st);
      return true;
    },
    command(id: string, tk: string, cmd: Cmd): "ok" | "auth" | "rate" | "offline" {
      const s = get(id), key = sha(tk).toString("hex");
      const hits = s?.viewers.get(key);
      if (!s || !hits) return "auth";
      const t = now(), recent = hits.filter((x) => t - x < 1000);
      if (recent.length >= CMD_PER_SEC) { s.viewers.set(key, recent); return "rate"; }
      recent.push(t); s.viewers.set(key, recent);
      if (!s.hosts.size) return "offline";
      for (const h of s.hosts) h.send("cmd", cmd);
      return "ok";
    },
    /** 발표자 화면이 명령을 받는 연결. 열고 닫을 때 휴대폰에 접속 상태를 알린다. */
    subscribeHost(id: string, hostKey: string, sink: Sink): (() => void) | null {
      const s = get(id);
      if (!s || !same(s.host, sha(hostKey))) return null;
      s.hosts.add(sink); presence(s);
      return () => { s.hosts.delete(sink); if (sessions.get(id) === s) presence(s); };
    },
    /** 휴대폰이 상태를 받는 연결. 붙자마자 마지막 상태와 발표자 접속 여부를 다시 보낸다(재연결 대비). */
    subscribeViewer(id: string, tk: string, sink: Sink): (() => void) | null {
      const s = get(id);
      if (!s || !s.viewers.has(sha(tk).toString("hex"))) return null;
      s.sinks.add(sink);
      sink.send("presence", { online: s.hosts.size > 0 });
      if (s.state) sink.send("state", s.state);
      return () => { s.sinks.delete(sink); };
    },
    sweep() { for (const id of [...sessions.keys()]) get(id); },
    size: () => sessions.size,
  };
}

const hub = createHub();
setInterval(() => hub.sweep(), 60_000).unref();

type Req = Request & { params: { id: string } };
type Srv = { timeout(r: Request, s: number): void };
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const deckOf = (req: Req) => (deckFolder(req.params.id) ? req.params.id : null);
const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
const q = (req: Request, k: string) => new URL(req.url).searchParams.get(k) ?? "";

function stream(req: Request, server: Srv, open: (sink: Sink) => (() => void) | null) {
  server.timeout(req, 0); // SSE가 유휴로 끊기지 않게 한다
  let off: (() => void) | null = null, ping: Timer;
  const body = new ReadableStream<string>({
    start(c) {
      const sink: Sink = { send: (ev, d) => { try { c.enqueue(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`); } catch {} }, close: () => { try { c.close(); } catch {} } };
      off = open(sink);
      if (!off) { sink.close(); return; }
      c.enqueue(": connected\n\n");
      ping = setInterval(() => { try { c.enqueue(": ping\n\n"); } catch {} }, 15000);
    },
    cancel() { clearInterval(ping); off?.(); },
  });
  if (!off) return bad("auth", 403); // EventSource는 200이 아니면 다시 붙지 않는다(만료나 폐기된 키로 무한 재시도하지 않게)
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

export const remoteRoutes = {
  "/api/remote/:id/start": { POST: (req: Req) => { const id = deckOf(req); return id ? Response.json(hub.start(id)) : bad("deck", 404); } },
  "/api/remote/:id/stop": { POST: (req: Req) => { const id = deckOf(req); return id && hub.stop(id, req.headers.get("x-remote-key") ?? "") ? Response.json({ ok: true }) : bad("auth", 403); } },
  "/api/remote/:id/join": {
    POST: async (req: Req) => {
      const id = deckOf(req);
      if (!id) return bad("deck", 404);
      const b = (await req.json().catch(() => null)) as { code?: unknown } | null;
      const r = hub.join(id, b?.code);
      if ("token" in r) return Response.json(r);
      return r.error === "limit" ? Response.json({ error: "limit" }, { status: 429, headers: { "Retry-After": "60" } }) : bad(r.error, r.error === "none" ? 404 : 403);
    },
  },
  "/api/remote/:id/state": {
    POST: async (req: Req) => {
      const id = deckOf(req), st = parseState(await req.json().catch(() => null));
      if (!id || !st) return bad("state");
      return hub.setState(id, req.headers.get("x-remote-key") ?? "", st) ? Response.json({ ok: true }) : bad("auth", 403);
    },
  },
  "/api/remote/:id/cmd": {
    POST: async (req: Req) => {
      const id = deckOf(req), cmd = parseCmd(await req.json().catch(() => null));
      if (!id) return bad("deck", 404);
      if (!cmd) return bad("cmd");
      const r = hub.command(id, bearer(req), cmd);
      return r === "ok" ? Response.json({ ok: true }) : r === "rate" ? bad("rate", 429) : r === "offline" ? bad("offline", 409) : bad("auth", 403);
    },
  },
  // EventSource는 헤더를 못 붙여 키를 query로 받는다. 키는 이 연결에만 쓰이고 세션 종료에 폐기된다.
  "/api/remote/:id/events": {
    GET: (req: Req, server: Srv) => {
      const id = deckOf(req);
      if (!id) return bad("deck", 404);
      const host = q(req, "role") === "host";
      const s = stream(req, server, (sink) => (host ? hub.subscribeHost(id, q(req, "t"), sink) : hub.subscribeViewer(id, q(req, "t"), sink)));
      return s;
    },
  },
};
