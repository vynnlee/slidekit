// 휴대폰 리모컨 중계. 서버는 메모리 상태만 갖고 파일과 편집 API에는 닿지 않는다.
//   발표자 화면(host) <-> 서버 <-> 휴대폰(viewer): 명령은 viewer -> host, 상태는 host -> viewer.
// 코드는 발표자가 시작할 때 만들고 해시만 보관하며 1회용이다. 교환하면 세션 토큰을 받고, 시작과 종료와 2시간 만료에 폐기한다.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { deckFolder } from "./folder";

export const TTL_MS = 2 * 3600_000;
const JOIN_FAILS = 5, JOIN_WINDOW = 60_000; // 틀린 코드는 덱마다 분당 5번까지
const CMD_PER_SEC = 10;
const HOST_GRACE = 30_000; // 발표자 연결이 끊긴 뒤 이 시간 안에는 다른 사람이 세션을 가로채지 못한다
const MAX_VIEWER_SINKS = 4, MAX_HOST_SINKS = 2; // 세션당 열린 SSE 연결 상한
const BODY_MAX = 4096, STATE_MAX = 65536;
const TICKET_TTL = 15_000, MAX_TICKETS = 20; // SSE 연결용 1회용 티켓(세션 토큰은 URL에 싣지 않는다)
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
  if (!Number.isInteger(o.slide) || !Number.isInteger(o.total) || (o.slide as number) < 1 || (o.total as number) < 1 || (o.total as number) > 9999 || (o.slide as number) > (o.total as number)) return null;
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
  hostGone: number; // 발표자 연결이 마지막으로 없어진(또는 세션을 만든) 시각
};

export function createHub(now: () => number = Date.now) {
  const sessions = new Map<string, Session>();
  const tickets = new Map<string, { id: string; role: "host" | "viewer"; session: Session; exp: number }>(); // 키: 티켓의 sha256(hex)
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

  const openHost = (s: Session, id: string, sink: Sink): (() => void) | null => {
    if (s.hosts.size >= MAX_HOST_SINKS) return null;
    s.hosts.add(sink); presence(s);
    return () => { s.hosts.delete(sink); if (sessions.get(id) === s) { if (!s.hosts.size) s.hostGone = now(); presence(s); } };
  };
  const openViewer = (s: Session, sink: Sink): (() => void) | null => {
    if (s.sinks.size >= MAX_VIEWER_SINKS) return null;
    s.sinks.add(sink);
    sink.send("presence", { online: s.hosts.size > 0 });
    if (s.state) sink.send("state", s.state);
    return () => { s.sinks.delete(sink); };
  };

  return {
    /** 세션을 만든다. 이미 있으면 기존 발표자 키(hostKey)가 맞을 때만 코드를 새로 받아 이어 가고(휴대폰 연결은 유지), 아니면 발표자가 붙어 있는 동안 null(거절). */
    start(id: string, hostKey?: string): { code: string; host: string; expires: number } | null {
      const old = get(id);
      const fmt = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
      if (old) {
        const mine = !!hostKey && same(old.host, sha(hostKey));
        if (mine) {
          const code = randCode();
          old.code = sha(code); old.fails = [];
          return { code: fmt(code), host: hostKey!, expires: old.expires };
        }
        if (old.hosts.size > 0 || now() - old.hostGone < HOST_GRACE) return null;
        end(id);
      }
      const code = randCode(), host = token();
      sessions.set(id, { code: sha(code), host: sha(host), expires: now() + TTL_MS, viewers: new Map(), state: null, hosts: new Set(), sinks: new Set(), fails: [], hostGone: now() });
      return { code: fmt(code), host, expires: now() + TTL_MS };
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
      if (!s.code || c.length !== 8 || !same(s.code, sha(c))) {
        s.fails.push(t);
        // 틀린 시도가 한도에 이르면 지금 코드를 폐기하고 발표자에게 알린다(발표자 화면이 새 코드를 받아 보여 준다).
        if (s.fails.length >= JOIN_FAILS) { s.code = null; for (const h of s.hosts) h.send("locked", {}); }
        return { error: "code" };
      }
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
    /** SSE 연결용 1회용 티켓. 발표자 키 또는 휴대폰 토큰을 확인해 15초짜리 티켓을 준다(세션당 미사용 20개까지). 틀리면 null. */
    issueTicket(id: string, role: "host" | "viewer", credential: string): string | null {
      const s = get(id);
      if (!s) return null;
      if (role === "host" ? !same(s.host, sha(credential)) : !s.viewers.has(sha(credential).toString("hex"))) return null;
      const t = now();
      let open = 0;
      for (const [k, v] of tickets) { if (v.exp <= t) tickets.delete(k); else if (v.session === s) open++; }
      if (open >= MAX_TICKETS) return null;
      const ticket = randomBytes(18).toString("base64url");
      tickets.set(sha(ticket).toString("hex"), { id, role, session: s, exp: t + TICKET_TTL });
      return ticket;
    },
    /** 티켓을 한 번 쓰고 그 역할로 연결을 연다. 없거나 만료됐거나 다른 덱(세션)의 것이면 null. */
    attach(id: string, ticket: string, sink: Sink): (() => void) | null {
      const k = sha(ticket).toString("hex"), tk = tickets.get(k);
      tickets.delete(k); // 성공해도 실패해도 한 번뿐
      const s = get(id);
      if (!tk || !s || tk.id !== id || tk.session !== s || tk.exp <= now()) return null;
      return tk.role === "host" ? openHost(s, id, sink) : openViewer(s, sink);
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
// 작은 본문만 받는다: Content-Length가 없거나 한도를 넘으면 읽기 전에 거절한다(인증 전에 큰 본문을 파싱하지 않게).
const tooBig = (req: Request, max: number) => { const n = Number(req.headers.get("content-length") ?? NaN); return !Number.isFinite(n) ? bad("length", 411) : n > max ? bad("too-large", 413) : null; };
const q = (req: Request, k: string) => new URL(req.url).searchParams.get(k) ?? "";

function stream(req: Request, server: Srv, open: (sink: Sink) => (() => void) | null) {
  server.timeout(req, 0); // SSE가 유휴로 끊기지 않게 한다
  let off: (() => void) | null = null, ping: Timer;
  const body = new ReadableStream<string>({
    start(c) {
      const sink: Sink = { send: (ev, d) => { try { c.enqueue(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`); } catch {} }, close: () => { clearInterval(ping); try { c.close(); } catch {} } };
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
  "/api/remote/:id/start": {
    POST: (req: Req) => {
      const id = deckOf(req);
      if (!id) return bad("deck", 404);
      const r = hub.start(id, req.headers.get("x-remote-key") ?? undefined);
      return r ? Response.json(r) : bad("active", 409); // 다른 화면이 발표 중이면 가로채지 못한다
    },
  },
  "/api/remote/:id/stop": { POST: (req: Req) => { const id = deckOf(req); return id && hub.stop(id, req.headers.get("x-remote-key") ?? "") ? Response.json({ ok: true }) : bad("auth", 403); } },
  "/api/remote/:id/join": {
    POST: async (req: Req) => {
      const id = deckOf(req);
      if (!id) return bad("deck", 404);
      const big = tooBig(req, BODY_MAX);
      if (big) return big;
      const b = (await req.json().catch(() => null)) as { code?: unknown } | null;
      const r = hub.join(id, b?.code);
      if ("token" in r) return Response.json(r);
      return r.error === "limit" ? Response.json({ error: "limit" }, { status: 429, headers: { "Retry-After": "60" } }) : bad(r.error, r.error === "none" ? 404 : 403);
    },
  },
  "/api/remote/:id/state": {
    POST: async (req: Req) => {
      const big = tooBig(req, STATE_MAX);
      if (big) return big;
      const id = deckOf(req), st = parseState(await req.json().catch(() => null));
      if (!id || !st) return bad("state");
      return hub.setState(id, req.headers.get("x-remote-key") ?? "", st) ? Response.json({ ok: true }) : bad("auth", 403);
    },
  },
  "/api/remote/:id/cmd": {
    POST: async (req: Req) => {
      const big = tooBig(req, BODY_MAX);
      if (big) return big;
      const id = deckOf(req), cmd = parseCmd(await req.json().catch(() => null));
      if (!id) return bad("deck", 404);
      if (!cmd) return bad("cmd");
      const r = hub.command(id, bearer(req), cmd);
      return r === "ok" ? Response.json({ ok: true }) : r === "rate" ? bad("rate", 429) : r === "offline" ? bad("offline", 409) : bad("auth", 403);
    },
  },
  // SSE 연결용 티켓: 자격(발표자 키는 X-Remote-Key, 휴대폰 토큰은 Authorization)은 헤더로만 받고 URL에는 티켓만 실린다.
  "/api/remote/:id/ticket": {
    POST: async (req: Req) => {
      const id = deckOf(req);
      if (!id) return bad("deck", 404);
      const big = tooBig(req, BODY_MAX);
      if (big) return big;
      const b = (await req.json().catch(() => null)) as { role?: unknown } | null;
      if (b?.role !== "host" && b?.role !== "viewer") return bad("role");
      const cred = b.role === "host" ? (req.headers.get("x-remote-key") ?? "") : bearer(req);
      const t = hub.issueTicket(id, b.role, cred);
      return t ? Response.json({ ticket: t, ttl: TICKET_TTL }) : bad("auth", 403);
    },
  },
  "/api/remote/:id/events": {
    GET: (req: Req, server: Srv) => {
      const id = deckOf(req);
      if (!id) return bad("deck", 404);
      return stream(req, server, (sink) => hub.attach(id, q(req, "ticket"), sink));
    },
  },
};
