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
};

// SSE 구독자. 이벤트는 comment, reply, deck-changed.
const clients = new Set<ReadableStreamDefaultController<string>>();
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
    return list;
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
      Object.assign(comment, { status: "done", reply: b.reply, repliedAt: new Date().toISOString() });
      save(b.deck, list);
      emit("reply", { deck: b.deck, comment });
      return Response.json({ ok: true });
    },
  },
  "/api/events": (req: Request, server: { timeout(r: Request, s: number): void }) => {
    server.timeout(req, 0); // SSE 연결이 유휴로 끊기지 않게 한다
    let ctrl!: ReadableStreamDefaultController<string>;
    let ping: Timer;
    const stream = new ReadableStream<string>({
      start(c) {
        ctrl = c;
        clients.add(c);
        c.enqueue(": connected\n\n");
        ping = setInterval(() => { try { c.enqueue(": ping\n\n"); } catch {} }, 15000);
      },
      cancel() { clients.delete(ctrl); clearInterval(ping); },
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
    if (to === undefined) { c.slideDeleted = true; changed = true; }
    else if (to !== c.slide) { c.slide = to; changed = true; }
  }
  if (!changed) return;
  save(deck, list);
  emit("comments", { deck, comments: list });
}
