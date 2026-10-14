/* 게시 기록(decks/<덱>/.publish.json)과 덱 지문. 서버, deploy.ts, 앱이 함께 쓰는 모듈이다(node:fs 사용, 브라우저 번들에는 넣지 않는다).
   기록은 { current: Entry | null, history: Entry[] }이고 history는 최신순 최대 20개다. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type Entry = { name: string; url: string; at: string; visibility: "public" | "password"; bytes: number; sha: string; unpublishedAt?: string };
export type PublishRecord = { current: Entry | null; history: Entry[] };

const MAX_HISTORY = 20;
const FILE = ".publish.json";
const IMG = "png|jpe?g|gif|webp|avif|svg";
// src, href 속성과 CSS url()이 가리키는 상대 경로 이미지
const REF = new RegExp(`(?:\\b(?:src|href)\\s*=\\s*["']([^"'#?]+\\.(?:${IMG}))(?:[?#][^"']*)?["']|url\\(\\s*["']?([^)"'#?]+\\.(?:${IMG}))(?:[?#][^)"']*)?["']?\\s*\\))`, "gi");

/** 덱 HTML이 참조하는 로컬 이미지(상대 경로이고 덱 폴더 안이며 실제로 있는 파일)를 경로순으로 돌려준다. */
export function localImageRefs(html: string, deckDir: string): { rel: string; size: number }[] {
  const root = resolve(deckDir), out = new Map<string, number>();
  for (const m of html.matchAll(REF)) {
    const rel = (m[1] ?? m[2]).trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(rel)) continue; // http:, data:, //, 절대 경로는 로컬 상대 경로가 아니다
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) continue; // 덱 폴더 밖
    try { const st = statSync(abs); if (st.isFile()) out.set(rel, st.size); } catch { /* 없는 파일은 건너뛴다 */ }
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, size]) => ({ rel, size }));
}

/** index.html 내용과 참조한 로컬 이미지의 `상대경로:크기` 목록으로 만든 sha1(hex). 게시 뒤 덱이 바뀌었는지 비교하는 데 쓴다. */
export function deckFingerprint(deckDir: string): string {
  const html = readFileSync(join(deckDir, "index.html"), "utf8");
  const h = createHash("sha1");
  h.update(html);
  for (const r of localImageRefs(html, deckDir)) h.update(`\n${r.rel}:${r.size}`);
  return h.digest("hex");
}

const isoOk = (s: unknown): s is string => typeof s === "string" && s.length <= 40 && !Number.isNaN(Date.parse(s));
function entryOf(v: unknown): Entry | null {
  if (typeof v !== "object" || v === null) return null;
  const e = v as Record<string, unknown>;
  if (typeof e.name !== "string" || !/^[\w-]{1,100}$/.test(e.name)) return null;
  if (typeof e.url !== "string" || e.url.length > 300 || !/^https?:\/\//.test(e.url)) return null;
  if (!isoOk(e.at)) return null;
  if (e.visibility !== "public" && e.visibility !== "password") return null;
  if (typeof e.bytes !== "number" || !Number.isFinite(e.bytes) || e.bytes < 0) return null;
  if (typeof e.sha !== "string" || !/^[0-9a-f]{40}$/.test(e.sha)) return null;
  if (e.unpublishedAt !== undefined && !isoOk(e.unpublishedAt)) return null;
  return { name: e.name, url: e.url, at: e.at, visibility: e.visibility, bytes: e.bytes, sha: e.sha, ...(e.unpublishedAt ? { unpublishedAt: e.unpublishedAt as string } : {}) };
}

/** 기록을 읽는다. 없거나 깨졌으면 빈 기록이고, 형식이 틀린 항목은 버리며 history는 20개로 자른다. */
export function readPublish(deckDir: string): PublishRecord {
  const file = join(deckDir, FILE);
  try {
    if (!existsSync(file) || statSync(file).size > 1_000_000) return { current: null, history: [] };
    const j = JSON.parse(readFileSync(file, "utf8")) as { current?: unknown; history?: unknown };
    const history = (Array.isArray(j.history) ? j.history : []).map(entryOf).filter((e): e is Entry => e !== null).slice(0, MAX_HISTORY);
    return { current: entryOf(j.current), history };
  } catch { return { current: null, history: [] }; }
}

function write(deckDir: string, rec: PublishRecord) {
  const file = join(deckDir, FILE), tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  renameSync(tmp, file);
}

/** 게시했다고 기록한다: current를 바꾸고 history 맨 앞에 넣는다. */
export function recordPublish(deckDir: string, entry: Entry): PublishRecord {
  const e = entryOf(entry);
  if (!e) throw new Error("게시 기록 형식이 올바르지 않다");
  const prev = readPublish(deckDir);
  const rec = { current: e, history: [e, ...prev.history].slice(0, MAX_HISTORY) };
  write(deckDir, rec);
  return rec;
}

/** 게시 취소를 기록한다: current가 있으면 history의 같은 항목에 unpublishedAt을 넣고 current를 null로 한다. */
export function recordUnpublish(deckDir: string, now = new Date()): PublishRecord {
  const prev = readPublish(deckDir);
  if (!prev.current) return prev;
  const cur = prev.current, at = now.toISOString();
  const history = prev.history.map((h) => (h.name === cur.name && h.at === cur.at && !h.unpublishedAt ? { ...h, unpublishedAt: at } : h));
  if (!history.some((h) => h.name === cur.name && h.at === cur.at)) history.unshift({ ...cur, unpublishedAt: at });
  const rec = { current: null, history: history.slice(0, MAX_HISTORY) };
  write(deckDir, rec);
  return rec;
}
