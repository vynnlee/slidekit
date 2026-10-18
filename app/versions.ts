// 덱 버전 기록: 덱 폴더 안 `.versions/`에 index.html 스냅샷을 남기고 되돌린다.
// 종류: save(편집기 저장 직전의 내용, 60초 안의 연속 저장은 처음 것 하나), external(편집기 밖에서 파일이 바뀌기 직전의 내용),
// mine(Reload로 버리기 전 내 저장 안 한 편집), disk(Overwrite로 덮기 전 파일 내용: 편집기가 올린다),
// restore(복원 직전의 현재 내용). 파일 이름이 곧 정보다: <UTC시각>-<종류>-<슬라이드 수>-<난수>.html (id는 .html을 뺀 이름).
// 점으로 시작하는 폴더라 정적 서빙, 검색, 복제, 번들러가 다루지 않는다(복제 필터는 decks-api.ts에 따로 있다).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deckFolder, decksDir } from "./folder";
import { readOnlyDeck, withDeckLock } from "./deck-lock";

export type Kind = "save" | "external" | "restore" | "mine" | "disk"; // mine: 편집기가 Reload로 버리기 전 내 저장 안 한 편집, disk: 편집기가 Overwrite로 덮기 전 파일 내용
export type Version = { id: string; at: string; kind: Kind; slides: number; bytes: number };

const KEEP = 50; // 덱마다 최근 50개
const KEEP_RESTORE = 10; // restore 종류는 따로 10개까지: 같은 두 버전을 번갈아 복원해 다른 기록을 밀어내지 못하게
const MAX_BYTES = 30 * 1024 * 1024; // 덱마다 30MB
const BURST_MS = 60_000; // 이 안의 연속 저장은 하나로
const ID = /^\d{8}T\d{6}Z-(save|external|restore|mine|disk)-\d{1,5}-[0-9a-f]{4}$/;

const bad = (error: string, status = 400) => Response.json({ error }, { status });
export const hash = (s: string) => createHash("sha1").update(s).digest("hex");
const slidesOf = (html: string) => (html.match(/<section\b[^>]*\bdata-slide\b/g) ?? []).length;
const vdir = (deck: string) => join(decksDir, deck, ".versions");

function parse(file: string, bytes: number): Version | null {
  const id = file.replace(/\.html$/, "");
  if (!ID.test(id)) return null;
  const [ts, kind, slides] = id.split("-");
  const at = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}Z`;
  return { id, at, kind: kind as Kind, slides: +slides, bytes };
}

/** 최신순 목록 */
export function list(deck: string): Version[] {
  const dir = vdir(deck);
  if (!existsSync(dir)) return [];
  const out: { v: Version; m: number }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".html")) continue;
    const st = statSync(join(dir, f));
    const v = parse(f, st.size);
    if (v) out.push({ v, m: st.mtimeMs });
  }
  // 같은 초 안에서는 만든 순서(mtime)로, 그래도 같으면 id로 정한다. id만 문자열로 비교하면 슬라이드 수 -10-이 -9-보다 앞서 prune이 최신을 지울 수 있다.
  return out.sort((a, b) => b.v.at.localeCompare(a.v.at) || b.m - a.m || b.v.id.localeCompare(a.v.id)).map((x) => x.v);
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** 내용을 스냅샷으로 남긴다. 마지막 스냅샷과 같으면 건너뛴다. 남기면 Version을, 아니면 null을 돌려준다. */
export function snapshot(deck: string, source: string, kind: Kind, now = new Date()): Version | null {
  const dir = vdir(deck);
  const have = list(deck);
  if (have[0] && readFileSync(join(dir, have[0].id + ".html"), "utf8") === source) return null;
  if (kind === "save" && have[0]?.kind === "save" && now.getTime() - Date.parse(have[0].at) < BURST_MS) return null; // 편집 한 번의 처음 상태만 남긴다
  mkdirSync(dir, { recursive: true });
  const id = `${stamp(now)}-${kind}-${slidesOf(source)}-${randomBytes(2).toString("hex")}`;
  const tmp = join(dir, `.tmp-${id}`);
  writeFileSync(tmp, source);
  renameSync(tmp, join(dir, `${id}.html`));
  prune(deck);
  return parse(`${id}.html`, Buffer.byteLength(source));
}

function prune(deck: string) {
  const dir = vdir(deck);
  // 끊긴 쓰기가 남긴 임시 파일(1분 넘은 것)은 용량과 개수에 안 잡히므로 여기서 지운다.
  for (const f of readdirSync(dir)) if (f.startsWith(".tmp-")) { try { if (Date.now() - statSync(join(dir, f)).mtimeMs > 60_000) rmSync(join(dir, f), { force: true }); } catch { /* 이미 없다 */ } }
  let all = list(deck);
  let restores = 0;
  const kept: Version[] = [];
  for (const v of all) {
    if (v.kind === "restore" && ++restores > KEEP_RESTORE) { rmSync(join(dir, v.id + ".html"), { force: true }); continue; }
    kept.push(v);
  }
  for (const v of kept.slice(KEEP)) rmSync(join(dir, v.id + ".html"), { force: true });
  all = kept.slice(0, KEEP);
  let total = all.reduce((n, v) => n + v.bytes, 0);
  for (let i = all.length - 1; i > 2 && total > MAX_BYTES; i--) { rmSync(join(dir, all[i].id + ".html"), { force: true }); total -= all[i].bytes; } // 가장 오래된 것부터, 최신 셋은 남긴다
}

export const read = (deck: string, id: string): string | null => {
  if (!ID.test(id)) return null;
  try { return readFileSync(join(vdir(deck), id + ".html"), "utf8"); } catch { return null; }
};

// ---- 편집기 밖 변경 감지: 마지막으로 본 내용을 메모리에 두었다가 파일이 달라지면 이전 내용을 external로 남긴다 ----
const lastSeen = new Map<string, string>();
const fileOf = (deck: string) => join(decksDir, deck, "index.html");
try {
  for (const d of readdirSync(decksDir, { withFileTypes: true })) if (d.isDirectory() && deckFolder(d.name)) lastSeen.set(d.name, readFileSync(fileOf(d.name), "utf8"));
} catch { /* decks/가 없으면 비어 있다 */ }

/** 편집기가 저장한 직후에 부른다. prev는 덮어쓰기 전 내용이다. watcher가 이 저장을 외부 변경으로 오해하지 않게 lastSeen도 맞춘다. */
export function afterSave(deck: string, prev: string, next: string) {
  snapshot(deck, prev, "save");
  lastSeen.set(deck, next);
}

/** 파일 감시가 변경을 알릴 때 부른다(디바운스 뒤). 편집기 저장이 아닌 변경이면 직전 내용을 external로 남기고 그 스냅샷을 돌려준다. */
export function noteFileChanged(deck: string): Version | null {
  let now: string;
  try { now = readFileSync(fileOf(deck), "utf8"); } catch { return null; }
  const before = lastSeen.get(deck);
  lastSeen.set(deck, now);
  if (before === undefined || before === now) return null;
  // external은 시각 합치기를 하지 않아서 null이면 마지막 스냅샷과 내용이 같다는 뜻이다. 그 스냅샷이 되돌릴 지점이다.
  const v = snapshot(deck, before, "external") ?? list(deck)[0] ?? null;
  if (v) logEdit(deck, { at: new Date().toISOString(), base: v.id, hash: hash(now) });
  return v;
}

// 편집기 밖 수정 기록: 코멘트에 답이 달릴 때 "그 사이에 일어난 수정"을 찾아 되돌릴 지점(base)과 수정 뒤 해시를 연결한다.
type Edit = { at: string; base: string; hash: string };
const editsFile = (deck: string) => join(vdir(deck), "edits.json");
const readEdits = (deck: string): Edit[] => { try { const a = JSON.parse(readFileSync(editsFile(deck), "utf8")); return Array.isArray(a) ? a : []; } catch { return []; } };
function logEdit(deck: string, e: Edit) {
  mkdirSync(vdir(deck), { recursive: true });
  const tmp = join(vdir(deck), `.tmp-edits-${randomBytes(2).toString("hex")}`);
  writeFileSync(tmp, JSON.stringify([...readEdits(deck), e].slice(-KEEP)));
  renameSync(tmp, editsFile(deck));
}

/** from(이상) until(이하) 사이의 편집기 밖 수정을 하나로 묶는다: base는 가장 이른 수정 직전 스냅샷, hash는 가장 늦은 수정 뒤 내용의 해시. */
export function editsBetween(deck: string, from: string, until: string): { base: string; hash: string } | null {
  const hit = readEdits(deck).filter((e) => e.at >= from && e.at <= until);
  return hit.length ? { base: hit[0].base, hash: hit.at(-1)!.hash } : null;
}

/** 현재 내용을 restore 스냅샷으로 남기고 version 내용으로 덮어쓴다. 되돌릴 때 쓰는 공용 함수. */
export function restore(deck: string, id: string): { ok: true; undo: string | null; before: string } | { ok: false; status: number; error: string } {
  const src = read(deck, id);
  if (src === null) return { ok: false, status: 404, error: "no such version" };
  const file = fileOf(deck);
  const cur = readFileSync(file, "utf8");
  const snap = snapshot(deck, cur, "restore"); // 복원 전 스냅샷은 필수다. 현재가 마지막 스냅샷과 같으면 그 스냅샷이 이미 있다.
  const undo = snap?.id ?? list(deck)[0]?.id ?? null; // snapshot이 null이면 현재가 마지막 스냅샷과 같다는 뜻이다
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  writeFileSync(tmp, src);
  renameSync(tmp, file);
  lastSeen.set(deck, src);
  return { ok: true, undo, before: cur };
}

type Req = Request & { params: { folder: string; vid?: string } };
const deckOf = (req: Req) => (deckFolder(req.params.folder) ? req.params.folder : null);

export const routes = {
  "/api/decks/:folder/versions": {
    GET: (req: Req) => (deckOf(req) ? Response.json(list(req.params.folder)) : bad("deck", 404)),
    // 편집기가 내용을 버리거나 덮기 전에 백업을 올린다(kind는 mine 또는 disk만). 같은 내용이 이미 마지막 스냅샷이면 건너뛴다.
    POST: async (req: Req) => {
      const deck = deckOf(req);
      if (!deck) return bad("deck", 404);
      if (readOnlyDeck(deck)) return bad("read-only deck", 403);
      const b = (await req.json().catch(() => null)) as { source?: unknown; kind?: unknown } | null;
      if (!b || typeof b.source !== "string" || (b.kind !== "mine" && b.kind !== "disk")) return bad("source and kind (mine or disk) are required");
      if (Buffer.byteLength(b.source) > MAX_BYTES) return bad("too large", 413);
      const kind = b.kind, source = b.source;
      const v = await withDeckLock(deck, async () => snapshot(deck, source, kind));
      return Response.json({ saved: !!v, id: v?.id ?? null });
    },
  },
  "/api/decks/:folder/versions/:vid": {
    GET: (req: Req) => {
      const deck = deckOf(req);
      if (!deck) return bad("deck", 404);
      const source = read(deck, req.params.vid!);
      const v = list(deck).find((x) => x.id === req.params.vid);
      return source === null || !v ? bad("no such version", 404) : Response.json({ ...v, source });
    },
  },
  // 미리보기: 옛 원문에 <base href="/decks/<덱>/">를 넣어 상대 경로(../../engine/ 이미지)가 풀리게 한다. 앱 출처와 분리하려고 sandbox로 연다.
  "/api/decks/:folder/versions/:vid/preview": {
    GET: (req: Req) => {
      const deck = deckOf(req);
      if (!deck) return bad("deck", 404);
      const src = read(deck, req.params.vid!);
      if (src === null) return bad("no such version", 404);
      const base = `<base href="/decks/${deck}/">`;
      // <header> 같은 이름에 걸리지 않게 head 태그만 찾고, 없으면 <html> 뒤, 그것도 없으면 맨 앞에 넣는다.
      const html = /<head(\s[^>]*)?>/i.test(src) ? src.replace(/<head(\s[^>]*)?>/i, (m) => m + base) : /<html(\s[^>]*)?>/i.test(src) ? src.replace(/<html(\s[^>]*)?>/i, (m) => m + base) : base + src;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox allow-scripts allow-popups; connect-src 'none'; form-action 'none'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
    },
  },
  "/api/decks/:folder/versions/:vid/restore": {
    POST: async (req: Req) => {
      const deck = deckOf(req);
      if (!deck) return bad("deck", 404);
      if (readOnlyDeck(deck)) return bad("read-only deck", 403);
      const r = await withDeckLock(deck, async () => restore(deck, req.params.vid!)); // 편집기 저장(PUT)과 같은 잠금
      if (r.ok) void import("./comments").then((m) => m.reanchorDeck(deck, r.before, readFileSync(fileOf(deck), "utf8"))).catch(() => {}); // 순환 import를 피해 늦게 불러온다
      return r.ok ? Response.json({ ok: true, undo: r.undo }) : bad(r.error, r.status);
    },
  },
};
