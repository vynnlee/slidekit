#!/usr/bin/env bun
import { join, normalize, sep } from "node:path";
import { readdir, stat } from "node:fs/promises";
import index from "./index.html";
import { routes as commentRoutes } from "./comments";
import { routes as editorRoutes } from "./editor-api";
import { guardHost, guardRoutes } from "./guard";
import { alreadyUp, openApp } from "./launch";
import { createDeck } from "./decks-api";

// 하위 명령: slidekit new|lint|bundle|deploy <덱>. 해당 스크립트는 argv[2]를 덱 이름으로 읽는다.
const sub = process.argv[2];
if (sub === "bundle" || sub === "deploy" || sub === "new" || sub === "lint") {
  process.argv.splice(2, 1);
  await import(sub === "bundle" ? "../bundler/bundle.ts" : sub === "deploy" ? "../deploy/deploy.ts" : sub === "new" ? "../engine/new.ts" : "../engine/lint.ts");
  process.exit(0);
}

const root = join(import.meta.dir, "..");
const port = Number(process.env.PORT ?? 3200);
const url = `http://127.0.0.1:${port}`;
if (await alreadyUp(port)) { console.log(`slidekit ${url} (already running)`); openApp(url); process.exit(0); }

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
      const slides = (html.match(/<section\b[^>]*\bdata-slide=/g) ?? []).length;
      const modified = (await stat(join(root, "decks", d.name, "index.html"))).mtime.toISOString();
      return { ...meta, date: meta.date as string | undefined, title, folder: d.name, id: (meta.id as string) ?? d.name, slides, modified };
    }),
  );
  return decks.filter(Boolean).sort((a, b) => String(b!.date ?? "").localeCompare(String(a!.date ?? "")));
}

// 덱과 엔진만 정적으로 서빙한다. 덱 iframe이 ../../engine/ 상대 경로를 쓰므로 저장소 구조를 유지한다.
async function serveStatic(pathname: string) {
  let rel: string;
  try { rel = normalize(decodeURIComponent(pathname)); } catch { return null; }
  if (rel.includes("\0") || rel.split(sep).some((s) => s.startsWith("."))) return null; // 점 파일과 임시 파일 제외
  const top = rel.split(sep).filter(Boolean)[0];
  if (top !== "decks" && top !== "engine") return null;
  const file = Bun.file(join(root, rel));
  return (await file.exists()) ? new Response(file) : null;
}

Bun.serve({
  hostname: "127.0.0.1", // 0.0.0.0은 LAN 전체에 열린다
  port,
  maxRequestBodySize: 8 << 20, // 덱 원문(이미지 포함 가능)보다 넉넉하게
  routes: guardRoutes({
    "/": index,
    "/present/:id": index,
    "/edit/:id": index,
    "/dev/inspector": index,
    "/api/decks": { GET: async () => Response.json(await listDecks()), POST: createDeck },
    ...commentRoutes,
    ...editorRoutes,
  }),
  async fetch(req) {
    const denied = guardHost(req); // 모든 메서드에 적용한다
    if (denied) return denied;
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    return (await serveStatic(new URL(req.url).pathname)) ?? new Response("Not found", { status: 404 });
  },
});
console.log(`slidekit ${url}`);
openApp(url);
