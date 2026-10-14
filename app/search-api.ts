import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";

const decks = join(import.meta.dir, "..", "decks");
const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const plain = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, " ").trim();

type Slide = { n: number; title: string; text: string; notes: string };
type Entry = { folder: string; id: string; title: string; slides: Slide[] };

// 덱 파일이 바뀌지 않았다면(mtime 같음) 다시 읽지 않는다.
const cache = new Map<string, { mtime: number; entry: Entry }>();

async function indexDeck(folder: string): Promise<Entry | null> {
  const file = join(decks, folder, "index.html");
  const st = await stat(file).catch(() => null);
  if (!st) return null;
  const hit = cache.get(folder);
  if (hit && hit.mtime === st.mtimeMs) return hit.entry;
  const html = await Bun.file(file).text();
  let meta: Record<string, unknown> = {};
  try { const m = html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/); if (m) meta = JSON.parse(m[1]); } catch {}
  const slides: Slide[] = [];
  for (const m of html.matchAll(/<section\b([^>]*\bdata-slide=[^>]*)>([\s\S]*?)<\/section>/g)) {
    const body = m[2];
    const notes = plain(body.match(/<aside\b[^>]*\bdata-notes\b[^>]*>([\s\S]*?)<\/aside>/)?.[1] ?? "");
    const text = plain(body.replace(/<aside\b[^>]*\bdata-notes\b[^>]*>[\s\S]*?<\/aside>/g, " "));
    const title = m[1].match(/\bdata-title="([^"]*)"/)?.[1] ?? plain(body.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/)?.[1] ?? "");
    slides.push({ n: slides.length + 1, title: plain(title), text, notes });
  }
  const entry = { folder, id: (meta.id as string) ?? folder, title: (meta.title as string) ?? html.match(/<title>([^<]*)<\/title>/)?.[1] ?? folder, slides };
  cache.set(folder, { mtime: st.mtimeMs, entry });
  return entry;
}

// 검색용 색인: 덱마다 슬라이드의 제목, 본문, 노트 텍스트. 필터링은 클라이언트가 한다.
export async function searchIndex() {
  const dirs = await readdir(decks, { withFileTypes: true }).catch(() => []);
  const all = await Promise.all(dirs.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => indexDeck(d.name)));
  return Response.json(all.filter(Boolean));
}

export const routes = { "/api/search-index": () => searchIndex() };
