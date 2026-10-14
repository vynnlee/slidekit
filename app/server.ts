#!/usr/bin/env bun
import { join, normalize, sep } from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";
import index from "./index.html";
import { routes as commentRoutes } from "./comments";
import { routes as editorRoutes } from "./editor-api";
import { routes as exportRoutes } from "./export-api";
import { guardHost, guardRoutes } from "./guard";
import { alreadyUp, openApp } from "./launch";
import { createDeck, routes as deckRoutes } from "./decks-api";
import { routes as searchRoutes } from "./search-api";

// 하위 명령: slidekit new|lint|pdf|doctor|bundle|deploy <덱>. 해당 스크립트는 argv[2]를 덱 이름으로 읽는다.
const sub = process.argv[2];
const SUBS: Record<string, string> = { new: "../engine/new.ts", lint: "../engine/lint.ts", pdf: "../engine/pdf.ts", doctor: "../engine/doctor.ts", bundle: "../bundler/bundle.ts", deploy: "../deploy/deploy.ts" };
const USAGE = `사용법: slidekit [명령]
  (명령 없음)      앱을 연다(덱 목록, 편집기, 발표자 화면)
  new <이름>       새 덱을 만든다
  lint <덱>        규격 위반을 점검한다
  bundle <덱>      단독 HTML 한 파일로 묶는다
  pdf <덱>         슬라이드당 한 페이지의 PDF로 내보낸다
  deploy <덱>      static.vynnlee.com에 올린다
  doctor           환경을 점검한다`;
const dist = (a: string, b: string) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
if (sub === "help" || sub === "--help" || sub === "-h") { console.log(USAGE); process.exit(0); }
if (sub && !(sub in SUBS)) {
  const near = Object.keys(SUBS).find((k) => dist(sub, k) <= 2);
  console.error(`알 수 없는 명령: ${sub}${near ? `. ${near}을 말한 것인가` : ""}\n\n${USAGE}`);
  process.exit(1);
}
if (sub && sub in SUBS) {
  process.argv.splice(2, 1);
  process.env.SLIDEKIT_SUB = sub; // 하위 명령 스크립트가 직접 실행인지 알아보는 표시
  await import(SUBS[sub]);
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
  const full = join(root, rel);
  // 덱 안의 심볼릭 링크가 저장소 밖(예: ~/.ssh)을 가리켜도 읽히지 않게, 실제 경로가 저장소 안인지 확인한다.
  // 안정 미리보기(scripts/preview.ts)는 decks를 실제 저장소 폴더로 향한 심볼릭 링크로 둔다. 그 폴더 안만 추가로 허용한다.
  const real = await realpath(full).catch(() => null);
  const inside = async (base: string) => real!.startsWith((await realpath(base).catch(() => base)) + sep);
  if (!real || !((await inside(root)) || (await inside(join(root, "decks"))))) return null;
  const file = Bun.file(real);
  return (await file.exists()) ? new Response(file) : null;
}

Bun.serve({
  hostname: "127.0.0.1", // 0.0.0.0은 LAN 전체에 열린다
  port,
  maxRequestBodySize: 8 << 20, // 덱 원문(이미지 포함 가능)보다 넉넉하게
  // 테스트 서버는 SLIDEKIT_STABLE=1로 띄운다: HMR을 꺼서 팀원이 파일을 저장해도 열린 페이지가 다시 로드되지 않는다.
  ...(process.env.SLIDEKIT_STABLE ? { development: { hmr: false, console: false } } : {}),
  // 알려진 한계: Bun의 HTML 번들 라우트("/", "/edit/:id" 등)와 /_bun/*는 핸들러로 감쌀 수 없어 Host 검사가 /api/와 정적 파일에만 걸린다.
  // 127.0.0.1에만 바인딩하고 프런트 번들에는 비밀이 없으며 변경과 읽기 API는 모두 검사하므로, DNS 리바인딩으로 얻는 것은 앱 소스뿐이다.
  // 닫으려면 검사하는 앞단 프록시(app/preview-proxy.ts 방식) 뒤에 서버를 두거나 번들을 정적 파일로 빌드해 fetch에서 서빙해야 한다.
  routes: guardRoutes({
    "/": index,
    "/present/:id": index,
    "/edit/:id": index,
    "/dev/inspector": index,
    "/dev/tokens": index,
    "/dev/export": index,
    "/dev/controls": index,
    "/api/decks": { GET: async () => Response.json(await listDecks()), POST: createDeck },
    ...deckRoutes,
    ...searchRoutes,
    ...commentRoutes,
    ...editorRoutes,
    ...exportRoutes,
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
