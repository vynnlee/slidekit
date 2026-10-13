#!/usr/bin/env bun
import { join, normalize, sep } from "node:path";
import { readdir } from "node:fs/promises";
import index from "./index.html";

const root = join(import.meta.dir, "..");
const port = Number(process.env.PORT ?? 3200);

async function listDecks() {
  const dirs = await readdir(join(root, "decks"), { withFileTypes: true }).catch(() => []);
  const decks = await Promise.all(
    dirs.filter((d) => d.isDirectory()).map(async (d) => {
      const html = await Bun.file(join(root, "decks", d.name, "index.html")).text().catch(() => null);
      if (html === null) return null;
      let meta: Record<string, unknown> = {};
      const m = html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/);
      try { if (m) meta = JSON.parse(m[1]); } catch {}
      const title = (meta.title as string) ?? html.match(/<title>([^<]*)<\/title>/)?.[1] ?? d.name;
      return { ...meta, date: meta.date as string | undefined, title, folder: d.name, id: (meta.id as string) ?? d.name };
    }),
  );
  return decks.filter(Boolean).sort((a, b) => String(b!.date ?? "").localeCompare(String(a!.date ?? "")));
}

// 덱과 엔진만 정적으로 서빙한다. 덱 iframe이 ../../engine/ 상대 경로를 쓰므로 저장소 구조를 유지한다.
async function serveStatic(pathname: string) {
  const rel = normalize(decodeURIComponent(pathname));
  const top = rel.split(sep).filter(Boolean)[0];
  if (top !== "decks" && top !== "engine") return null;
  const file = Bun.file(join(root, rel));
  return (await file.exists()) ? new Response(file) : null;
}

Bun.serve({
  hostname: "127.0.0.1", // 0.0.0.0은 LAN 전체에 열린다
  port,
  routes: {
    "/": index,
    "/present/:id": index,
    "/api/decks": async () => Response.json(await listDecks()),
  },
  async fetch(req) {
    return (await serveStatic(new URL(req.url).pathname)) ?? new Response("Not found", { status: 404 });
  },
});
console.log(`slidekit http://127.0.0.1:${port}`);
