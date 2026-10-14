import { deckFolder } from "./folder";
import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { editsBetween, hash, noteFileChanged, restore } from "./versions";

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
  recheck?: boolean; // 버전 복원 뒤 그 슬라이드에서 발췌문을 찾지 못한 코멘트. 위치 확인이 필요하다고 표시만 한다
  slideDeleted?: boolean; // 저장 때 슬라이드가 지워진 코멘트. 지우지 않고 표시만 한다
  deliveredAt?: string; // 채널이 Claude 세션에 전달한 시각
  ackAt?: string; // Claude가 작업을 시작했다고 알린 시각
  editBase?: string; // 답이 달릴 때 찾은, Claude 수정 직전 버전 id(되돌릴 지점)
  editHash?: string; // Claude 수정 뒤 덱 내용의 해시. 덱이 그 뒤로 바뀌었는지 보는 데 쓴다
  revertedAt?: string;
  revertUndo?: string; // 되돌리기 직전 상태의 버전 id(되돌리기 취소용)
  sig?: string; // 이 기기의 키로 만든 서명(작성 때 채워진다). 없거나 틀리면 검증 안 됨
  trusted?: boolean; // 읽을 때 계산한다(저장하지 않는다)
  resolved?: boolean; // 사용자가 해결로 표시
  resolvedAt?: string;
};

// 코멘트 서명: comments.json은 덱과 함께 남에게서 올 수 있어서, 이 기기의 키로 서명된 코멘트만 Claude에 보낸다.
// 키는 저장소 밖(~/.config/slidekit/comments.key, 0600)에 둔다. 서명 대상은 작성 때 정해지는 값(덱, id, 슬라이드, 경로, 요소 글자, 본문, 작성 시각)이다.
const keyFile = process.env.SLIDEKIT_KEY_FILE ?? join(homedir(), ".config", "slidekit", "comments.key");
let keyCache: Buffer | null = null;
function key(): Buffer {
  if (keyCache) return keyCache;
  try {
    const k = Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex");
    if (k.length >= 32) return (keyCache = k);
  } catch { /* 없으면 만든다 */ }
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
  keyCache = randomBytes(32);
  writeFileSync(keyFile, keyCache.toString("hex") + "\n", { mode: 0o600 });
  return keyCache;
}
const canon = (deck: string, c: Comment) => JSON.stringify([deck, c.id, c.slide, c.path, c.excerpt, c.text, c.createdAt]);
export const sign = (deck: string, c: Comment) => createHmac("sha256", key()).update(canon(deck, c)).digest("hex");
export function verify(deck: string, c: Comment): boolean {
  if (typeof c.sig !== "string" || !/^[0-9a-f]{64}$/.test(c.sig)) return false;
  return timingSafeEqual(Buffer.from(c.sig, "hex"), Buffer.from(sign(deck, c), "hex"));
}

// SSE 구독자. 이벤트는 comment(새 코멘트), reply(코멘트가 갱신됨: 답, 전달됨, 해결), deck-changed, channel({connected}).
// 채널 MCP 서버는 /api/events?client=channel 로 연결하므로 그 연결이 있으면 Claude 세션이 열려 있는 것이다.
const clients = new Set<ReadableStreamDefaultController<string>>();
const channelClients = new Set<ReadableStreamDefaultController<string>>();
const removed = new Map<string, Comment>(); // 삭제 되돌리기용 보관함
function emit(event: string, data: unknown) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.enqueue(chunk); } catch { clients.delete(c); }
  }
}

// 덱 폴더 이름만 허용한다(경로 이탈 방지).
const validDeck = (d: unknown): d is string => deckFolder(d, false) !== null; // 규칙은 app/folder.ts 한 곳
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
    if (typeof c.sig === "string" && /^[0-9a-f]{64}$/.test(c.sig)) s.sig = c.sig;
    for (const k of ["editBase", "revertUndo"] as const) if (typeof c[k] === "string" && ID.test(c[k] as string)) s[k] = c[k] as string;
    if (typeof c.editHash === "string" && /^[0-9a-f]{40}$/.test(c.editHash)) s.editHash = c.editHash;
    for (const k of ["repliedAt", "deliveredAt", "resolvedAt", "ackAt", "revertedAt"] as const) { const v = str(c[k], 40); if (v && !Number.isNaN(Date.parse(v))) s[k] = v; }
    if (c.resolved === true) s.resolved = true;
    if (c.slideDeleted === true) s.slideDeleted = true;
    if (c.recheck === true) s.recheck = true;
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
    return sanitize(list).map((c) => ({ ...c, trusted: verify(deck, c) }));
  } catch {
    const keep = join(decksDir, deck, `.comments.json.corrupt-${Math.floor(statSync(file(deck)).mtimeMs)}`);
    copyFileSync(file(deck), keep);
    throw new Error(`comments.json이 손상됨. 사본: ${keep}`);
  }
};
// 임시 파일에 쓴 뒤 rename한다. 쓰다 끊겨도 기존 파일은 온전하다.
export const save = (deck: string, list: Comment[]) => {
  const tmp = join(decksDir, deck, `.comments.json.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(list.map(({ trusted: _t, ...c }) => c), null, 2) + "\n"); // trusted는 읽을 때 계산하는 값이라 저장하지 않는다
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
    if (!rest.length || rest.at(-1) === "comments.json" || rest.some((s) => s.startsWith("."))) return; // .versions 같은 점 폴더 안의 파일도 무시
    clearTimeout(timers.get(deck));
    timers.set(deck, setTimeout(() => { timers.delete(deck); noteFileChanged(deck); emit("deck-changed", { deck }); }, 250));
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
      comment.sig = sign(b.deck, comment);
      save(b.deck, [...load(b.deck), comment]);
      emit("comment", { deck: b.deck, comment: { ...comment, trusted: true } });
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
      const repliedAt = new Date().toISOString();
      Object.assign(comment, { status: "done", reply: b.reply, repliedAt });
      // Claude가 그 사이에 덱을 고쳤다면 되돌릴 지점과 수정 뒤 해시를 코멘트에 연결한다(Revert Claude's edit).
      const edit = editsBetween(b.deck, comment.ackAt ?? comment.deliveredAt ?? comment.createdAt, repliedAt);
      if (edit) { comment.editBase = edit.base; comment.editHash = edit.hash; }
      save(b.deck, list);
      emit("reply", { deck: b.deck, comment });
      return Response.json({ ok: true });
    },
  },
  // 사용자가 검증 안 된 코멘트를 믿기로 한다(이 기기의 키로 다시 서명한다). 아직 전달 전인 열린 코멘트는 채널이 받도록 comment 이벤트로 알린다.
  "/api/comments/:id/trust": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      const list = load(b.deck);
      const comment = list.find((c) => c.id === req.params.id);
      if (!comment) return bad("not found", 404);
      comment.sig = sign(b.deck, comment); comment.trusted = true;
      save(b.deck, list);
      emit(comment.status === "open" && !comment.deliveredAt ? "comment" : "reply", { deck: b.deck, comment });
      return Response.json({ ok: true });
    },
  },
  // Claude가 작업을 시작했다고 알린다("처리 중" 표시). 열린 코멘트에만 적용한다.
  // Claude의 수정 되돌리기. 덱이 그 수정 뒤로 더 바뀌었으면 409(changed)로 거절하고 사용자가 버전 기록에서 고르게 한다.
  // {undo:true}는 되돌리기를 취소한다(되돌리기 직전 상태로 복원하고 다시 되돌릴 수 있게 한다).
  "/api/comments/:id/revert": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      if ((process.env.SLIDEKIT_READONLY_DECKS ?? "").split(",").some((f) => f.trim() === b.deck)) return bad("read-only deck", 403);
      const list = load(b.deck);
      const comment = list.find((c) => c.id === req.params.id);
      if (!comment) return bad("not found", 404);
      const file = join(decksDir, b.deck, "index.html");
      if (b.undo === true) {
        if (!comment.revertedAt || !comment.revertUndo) return bad("nothing to undo", 409);
        const r = restore(b.deck, comment.revertUndo);
        if (!r.ok) return bad(r.error, r.status);
        delete comment.revertedAt; delete comment.revertUndo;
      } else {
        if (!comment.editBase || comment.revertedAt) return bad("nothing to revert", 409);
        if (hash(readFileSync(file, "utf8")) !== comment.editHash) return Response.json({ error: "changed" }, { status: 409 });
        const r = restore(b.deck, comment.editBase);
        if (!r.ok) return bad(r.error, r.status);
        comment.revertedAt = new Date().toISOString();
        if (r.undo) comment.revertUndo = r.undo;
      }
      save(b.deck, list);
      emit("reply", { deck: b.deck, comment });
      return Response.json({ ok: true });
    },
  },
  "/api/comments/:id/ack": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      const list = load(b.deck);
      const comment = list.find((c) => c.id === req.params.id);
      if (!comment) return bad("not found", 404);
      if (comment.status === "open" && !comment.ackAt) {
        comment.ackAt = new Date().toISOString();
        save(b.deck, list);
        emit("reply", { deck: b.deck, comment });
      }
      return Response.json({ ok: true });
    },
  },
  // 삭제와 되돌리기: 지운 코멘트는 서버 메모리에 잠깐(최근 50개) 보관하고, restore는 그 보관본만 되살린다(클라이언트가 내용을 보내지 않는다).
  "/api/comments/:id/delete": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      const list = load(b.deck);
      const at = list.findIndex((c) => c.id === req.params.id);
      if (at < 0) return bad("not found", 404);
      const [gone] = list.splice(at, 1);
      removed.set(`${b.deck}/${gone.id}`, gone);
      if (removed.size > 50) removed.delete(removed.keys().next().value!);
      save(b.deck, list);
      emit("comments", { deck: b.deck, comments: list });
      return Response.json({ ok: true });
    },
  },
  "/api/comments/:id/restore": {
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await body(req);
      if (!b || !validDeck(b.deck)) return bad("deck");
      const k = `${b.deck}/${req.params.id}`;
      const gone = removed.get(k);
      if (!gone) return bad("nothing to restore", 404);
      const list = load(b.deck);
      if (!list.some((c) => c.id === gone.id)) list.push(gone);
      list.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      removed.delete(k);
      save(b.deck, list);
      emit("comments", { deck: b.deck, comments: list.map((c) => ({ ...c, trusted: verify(b.deck as string, c) })) });
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

/** 버전 복원 뒤에 부른다. 열린 코멘트의 발췌문이 복원된 덱의 그 번호 슬라이드에 없으면 recheck로 표시한다(코멘트는 지우지 않는다). */
export function flagAfterRestore(deck: string, html: string) {
  if (!validDeck(deck)) return;
  const slides = [...html.matchAll(/<section\b[^>]*\bdata-slide\b[^>]*>[\s\S]*?<\/section>/gi)].map((m) => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  const list = load(deck);
  let changed = false;
  for (const c of list) {
    if (c.status !== "open" || c.slideDeleted) continue;
    const lost = c.excerpt.trim() !== "" && !(slides[c.slide - 1] ?? "").includes(c.excerpt.trim().replace(/\s+/g, " "));
    if (lost !== !!c.recheck) { if (lost) c.recheck = true; else delete c.recheck; changed = true; }
  }
  if (!changed) return;
  save(deck, list);
  emit("comments", { deck, comments: list });
}
