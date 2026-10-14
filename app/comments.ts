import { join } from "node:path";
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, watch, writeFileSync } from "node:fs";

const decksDir = process.env.SLIDEKIT_DECKS ?? join(import.meta.dir, "..", "decks");

export type Comment = {
  id: string;
  slide: number;
  path: string;
  excerpt: string;
  text: string;
  status: "open" | "done";
  reply?: string;
  createdAt: string;
  repliedAt?: string;
  slideDeleted?: boolean; // 저장 때 슬라이드가 지워진 코멘트. 지우지 않고 표시만 한다
  deliveredAt?: string; // 채널이 Claude 세션에 전달한 시각
  resolved?: boolean; // 사용자가 해결로 표시
  resolvedAt?: string;
};

// SSE 구독자. 이벤트는 comment(새 코멘트), reply(코멘트가 갱신됨: 답, 전달됨, 해결), deck-changed, channel({connected}).
// 채널 MCP 서버는 /api/events?client=channel 로 연결하므로 그 연결이 있으면 Claude 세션이 열려 있는 것이다.
const clients = new Set<ReadableStreamDefaultController<string>>();
const channelClients = new Set<ReadableStreamDefaultController<string>>();
function emit(event: string, data: unknown) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.enqueue(chunk); } catch { clients.delete(c); }
  }
}

// 덱 폴더 이름만 허용한다(경로 이탈 방지).
const validDeck = (d: unknown): d is string =>
  typeof d === "string" && /^[\w.-]+$/.test(d) && d !== "." && d !== ".." && existsSync(join(decksDir, d));
const file = (deck: string) => join(decksDir, deck, "comments.json");
// 파일을 믿지 않는다(남에게 받은 덱의 comments.json은 사용자가 쓴 것이 아니다). 형식이 틀린 항목은 버리고 길이를 자른다.
const ID = /^[\w][\w.-]{0,63}$/;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
export function sanitize(list: unknown[]): Comment[] {
  const out: Comment[] = [];
  for (const x of list) {
    const c = x as Record<string, unknown> | null;
    if (!c || typeof c !== "object") continue;
    if (typeof c.id !== "string" || !ID.test(c.id)) continue;
    if (!Number.isInteger(c.slide) || (c.slide as number) < 1) continue;
    if (typeof c.text !== "string" || !c.text.trim()) continue;
    if (c.status !== "open" && c.status !== "done") continue;
    if (typeof c.createdAt !== "string" || Number.isNaN(Date.parse(c.createdAt))) continue;
    const s: Comment = {
      id: c.id, slide: c.slide as number, path: clip(c.path, 200), excerpt: clip(c.excerpt, 200),
      text: c.text.slice(0, 2000), status: c.status, createdAt: c.createdAt,
    };
    const reply = str(c.reply, 2000); if (reply !== undefined) s.reply = reply;
    for (const k of ["repliedAt", "deliveredAt", "resolvedAt"] as const) { const v = str(c[k], 40); if (v && !Number.isNaN(Date.parse(v))) s[k] = v; }
    if (c.resolved === true) s.resolved = true;
    if (c.slideDeleted === true) s.slideDeleted = true;
    out.push(s);
  }
  return out;
}

// 파일이 없으면 빈 목록이다. 깨진 파일은 복사해 보존하고 오류로 올린다(빈 목록으로 다음 저장이 덮어쓰면 코멘트가 사라진다).
export const load = (deck: string): Comment[] => {
  let text: string;
  try { text = readFileSync(file(deck), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error("not an array");
    return sanitize(list);
  } catch {
    const keep = join(decksDir, deck, `.comments.json.corrupt-${Math.floor(statSync(file(deck)).mtimeMs)}`);
    copyFileSync(file(deck), keep);
    throw new Error(`comments.json이 손상됨. 사본: ${keep}`);
  }
};
// 임시 파일에 쓴 뒤 rename한다. 쓰다 끊겨도 기존 파일은 온전하다.
export const save = (deck: string, list: Comment[]) => {
  const tmp = join(decksDir, deck, `.comments.json.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
  renameSync(tmp, file(deck));
};

// 제어문자(줄바꿈 포함)를 공백으로 바꾸고 길이를 자른다. 채널로 가는 값이라 틀을 위조하지 못하게 한다.
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n);
const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });
const body = async (req: Request) => (await req.json().catch(() => null)) as Record<string, unknown> | null;

// decks/ 변경 감지. comments.json 변경은 무시하고 덱별로 디바운스한다.
const timers = new Map<string, Timer>();
try {
  watch(decksDir, { recursive: true }, (_e, name) => {
    if (!name) return;
    const [deck, ...rest] = name.split(/[\\/]/);
    if (!rest.length || rest.at(-1) === "comments.json" || rest.at(-1)!.startsWith(".")) return;
    clearTimeout(timers.get(deck));
    timers.set(deck, setTimeout(() => { timers.delete(deck); emit("deck-changed", { deck }); }, 250));
  });
} catch {}

export const routes = {
  "/api/comments": {
    GET: (req: Request) => {
      const deck = new URL(req.url).searchParams.get("deck");
      return validDeck(deck) ? Response.json(load(deck)) : bad("deck");
    },
    POST: async (req: Request) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      const slide = Number(b.slide);
      if (!Number.isInteger(slide) || slide < 1) return bad("slide");
      if (typeof b.text !== "string" || !b.text.trim() || b.text.length > 2000) return bad("text");
      const comment: Comment = {
        id: crypto.randomUUID().slice(0, 8),
        slide,
        path: clip(b.path, 200),
        excerpt: clip(b.excerpt, 80),
        text: b.text,
        status: "open",
        createdAt: new Date().toISOString(),
      };
      save(b.deck, [...load(b.deck), comment]);
      emit("comment", { deck: b.deck, comment });
      return Response.json({ id: comment.id });
    },
  },
  "/api/comments/:id/reply": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      if (typeof b.reply !== "string" || b.reply.length > 2000) return bad("reply");
      const list = load(b.deck);
      const comment = list.find((c) => c.id === req.params.id);
      if (!comment) return bad("not found", 404);
      if (comment.status !== "open") return bad("already replied", 409); // 이미 답한 코멘트를 덮어쓰지 못하게 한다
      Object.assign(comment, { status: "done", reply: b.reply, repliedAt: new Date().toISOString() });
      save(b.deck, list);
      emit("reply", { deck: b.deck, comment });
      return Response.json({ ok: true });
    },
  },
  "/api/channel": { GET: () => Response.json({ connected: channelClients.size > 0 }) },
  // 채널이 세션에 코멘트를 전달했다고 표시한다(전달 전에는 "대기", 후에는 "Claude에게 전달됨").
  "/api/comments/:id/delivered": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      const list = load(b.deck);
      const comment = list.find((c) => c.id === req.params.id);
      if (!comment) return bad("not found", 404);
      if (!comment.deliveredAt) {
        comment.deliveredAt = new Date().toISOString();
        save(b.deck, list);
        emit("reply", { deck: b.deck, comment });
      }
      return Response.json({ ok: true });
    },
  },
  // 사용자가 코멘트를 해결로 표시하거나 되돌린다. body {deck, resolved:boolean}.
  "/api/comments/:id/resolve": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      if (typeof b.resolved !== "boolean") return bad("resolved");
      const list = load(b.deck);
      const comment = list.find((c) => c.id === req.params.id);
      if (!comment) return bad("not found", 404);
      if (b.resolved) Object.assign(comment, { resolved: true, resolvedAt: new Date().toISOString() });
      else { delete comment.resolved; delete comment.resolvedAt; }
      save(b.deck, list);
      emit("reply", { deck: b.deck, comment });
      return Response.json({ ok: true });
    },
  },
  "/api/events": (req: Request, server: { timeout(r: Request, s: number): void }) => {
    server.timeout(req, 0); // SSE 연결이 유휴로 끊기지 않게 한다
    const isChannel = new URL(req.url).searchParams.get("client") === "channel";
    // 구독자 수 상한. 채널 연결 표시를 흉내 내는 연결도 몇 개로 제한한다.
    if (clients.size >= 20 || (isChannel && channelClients.size >= 3)) return new Response("too many connections", { status: 503 });
    let ctrl!: ReadableStreamDefaultController<string>;
    let ping: Timer;
    const stream = new ReadableStream<string>({
      start(c) {
        ctrl = c;
        clients.add(c);
        c.enqueue(": connected\n\n");
        if (isChannel) {
          const was = channelClients.size;
          channelClients.add(c);
          if (!was) emit("channel", { connected: true });
        }
        c.enqueue(`event: channel\ndata: ${JSON.stringify({ connected: channelClients.size > 0 })}\n\n`); // 새 연결에 현재 상태를 알린다
        ping = setInterval(() => { try { c.enqueue(": ping\n\n"); } catch {} }, 15000);
      },
      cancel() {
        clients.delete(ctrl); clearInterval(ping);
        if (channelClients.delete(ctrl) && !channelClients.size) emit("channel", { connected: false });
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  },
};

// 저장 때 슬라이드 번호가 바뀐 것을 코멘트에 반영한다. map은 옛 번호 -> 새 번호이고, 없는 번호는 삭제된 슬라이드다.
export function remap(deck: string, map: Record<string, number>) {
  if (!validDeck(deck)) return;
  const list = load(deck);
  let changed = false;
  for (const c of list) {
    if (c.slideDeleted) continue;
    const to = map[c.slide];
    // 없는 번호나 정수가 아닌 값(슬라이드 번호로 들어오면 안 된다)은 삭제된 슬라이드로 본다.
    if (to === undefined || !Number.isInteger(to) || to < 1) { c.slideDeleted = true; changed = true; }
    else if (to !== c.slide) { c.slide = to; changed = true; }
  }
  if (!changed) return;
  save(deck, list);
  emit("comments", { deck, comments: list });
}
