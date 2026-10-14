#!/usr/bin/env bun
/* bun run bundler/bundle.ts <deck folder name>  ->  dist/<deck>.html
   One self-contained file: engine, local images, subset fonts, all inlined. Opens from file://. */
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fetchCached, processFaces, usedChars } from "./fonts";

const root = join(import.meta.dir, "..");
const name = process.argv[2];
const fail = (m: string): never => { console.error(m); process.exit(1); };
if (!name) fail("사용법: slidekit bundle <덱>  (예: slidekit bundle my-talk)");
const deckDir = join(root, "decks", name);

const isLocal = (u: string) => !/^(data:|https?:|\/\/|#|mailto:|about:)/i.test(u);
/* url (relative to a base dir) -> file path: drop ?query and #hash, decode %xx.
   Only the deck folder and engine/ may be read (the deck links ../../engine/...), symlinks are resolved first,
   and repo internals such as .git, .env*, comments.json are refused, so a bundle can never carry them out. */
const allowedRoots = [deckDir, join(root, "engine")];
const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + "/");
const BLOCKED = /(?:^|\/)(?:\.git(?:\/|$)|\.env|\.mcp\.json|\.claude(?:\/|$)|comments\.json$|node_modules(?:\/|$))/;
function localPath(base: string, u: string) {
  const p = resolve(base, decodeURIComponent(u.split(/[?#]/)[0]).replace(/^\//, ""));
  if (!allowedRoots.some((d) => inside(p, d)) || BLOCKED.test(p.replace(root, ""))) fail(`덱 폴더 밖의 파일은 쓸 수 없다: ${u}. 파일을 덱 폴더 안으로 옮기고 상대 경로로 쓴다.`);
  try {
    const real = realpathSync(p);
    if (!allowedRoots.some((d) => inside(real, realpathSync(d)))) fail(`심볼릭 링크가 덱 폴더 밖을 가리킨다: ${u}`);
  } catch { /* 없는 파일은 dataUri가 안내한다 */ }
  return p;
}
const assetBytes = new Map<string, number>(); // 큰 이미지 경고용
async function dataUri(file: string) {
  const f = Bun.file(file);
  if (!(await f.exists())) fail(`없는 파일: ${file.replace(deckDir + "/", "")}. 덱 안의 src나 url() 경로를 확인하거나 파일을 덱 폴더에 넣는다.`);
  assetBytes.set(file.replace(deckDir + "/", ""), f.size);
  const mime = (f.type || "application/octet-stream").split(";")[0];
  return `data:${mime};base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`;
}
async function replaceAsync(s: string, re: RegExp, fn: (m: RegExpMatchArray) => Promise<string>) {
  const parts: Promise<string>[] = [];
  s.replace(re, (...a) => { parts.push(fn(a as unknown as RegExpMatchArray)); return ""; });
  const done = await Promise.all(parts);
  return s.replace(re, () => done.shift()!);
}
/* url(...) inside CSS, resolved against the file the CSS came from */
const inlineCssUrls = (css: string, base: string) =>
  replaceAsync(css, /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, async (m) =>
    isLocal(m[2]) ? `url("${await dataUri(localPath(base, m[2]))}")` : m[0]);

if (!(await Bun.file(join(deckDir, "index.html")).exists())) fail(`없는 덱: decks/${name}. 새 덱은 slidekit new ${name}`);
let html = await Bun.file(join(deckDir, "index.html")).text();

/* 1. fonts: only the characters this deck uses. Remote font CSS (Google Fonts, jsdelivr, any CDN), local @font-face files,
      and nothing at all for decks that use system fonts. Downloads are cached in ~/.cache/slidekit/fonts, never in the repo. */
const textOf = async (h: string) => {
  let t = h.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, "");
  for (const m of h.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) if (isLocal(m[1])) t += await Bun.file(localPath(deckDir, m[1])).text().catch(() => "");
  return t;
};
const chars = usedChars(" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ " + (await textOf(html)));
let fontFaces = 0, fontBytes = 0;
const fontLoad = (base: string) => async (u: string) =>
  /^data:/i.test(u) ? null : /^(https?:)?\/\//i.test(u) ? fetchCached(u.startsWith("//") ? "https:" + u : u) : new Uint8Array(await Bun.file(localPath(base, u)).arrayBuffer());
const inlineFonts = async (css: string, base: string) => {
  if (!/@font-face/i.test(css)) return css;
  const r = await processFaces(css, chars, fontLoad(base));
  fontFaces += r.faces; fontBytes += r.bytes;
  return r.css;
};
html = html.replace(/<link\b[^>]*rel="preconnect"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/g, "");
html = await replaceAsync(html, /<link\b[^>]*rel="stylesheet"[^>]*>\s*/g, async (m) => {
  const href = m[0].match(/href="(https?:\/\/[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  if (!href) return m[0];
  const css = new TextDecoder().decode(await fetchCached(href));
  if (!/@font-face/i.test(css)) return m[0]; // 글꼴 CSS가 아니면 그대로 둔다(외부 자원은 lint가 경고한다)
  const r = await processFaces(css, chars, async (u) => fontLoad(href)(new URL(u, href).href));
  fontFaces += r.faces; fontBytes += r.bytes;
  return `<style>\n${r.css.replace(/<\/style/gi, "<\\/style")}</style>\n`;
});

/* 2. local stylesheets and scripts */
html = await replaceAsync(html, /<link\b[^>]*rel="stylesheet"[^>]*>/g, async (m) => {
  const href = m[0].match(/href="([^"]+)"/)?.[1];
  if (!href || !isLocal(href)) return m[0];
  const file = localPath(deckDir, href);
  const css = await inlineCssUrls(await inlineFonts(await Bun.file(file).text(), dirname(file)), dirname(file));
  return `<style>\n${css.replace(/<\/style/gi, "<\\/style")}</style>`;
});
html = await replaceAsync(html, /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, async (m) => {
  if (!isLocal(m[1])) return m[0];
  const js = await Bun.file(localPath(deckDir, m[1])).text();
  const attrs = m[0].match(/^<script\b([^>]*)>/)![1].replace(/\s+src="[^"]*"/, ""); // type="module" 등은 유지
  return `<script${attrs}>\n${js.replace(/<\/script/gi, "<\\/script")}</script>`;
});

/* 3. images and CSS urls in style blocks */
html = await replaceAsync(html, /(<(?:img|source|image|video|audio|track)\b[^>]*?\b(?:xlink:)?(?:src|href|poster)=")([^"]+)(")/g, async (m) =>
  isLocal(m[2]) ? m[1] + (await dataUri(localPath(deckDir, m[2]))) + m[3] : m[0]);
/* srcset="a.png 1x, b.png 2x": inline each local URL (a value that already holds a data: URI is left alone) */
html = await replaceAsync(html, /(\ssrcset=")([^"]+)(")/g, async (m) => {
  if (/data:/i.test(m[2])) return m[0];
  const items = await Promise.all(m[2].split(",").map(async (it) => {
    const [u, ...rest] = it.trim().split(/\s+/);
    return u && isLocal(u) ? [await dataUri(localPath(deckDir, u)), ...rest].join(" ") : it.trim();
  }));
  return m[1] + items.join(", ") + m[3];
});
html = await replaceAsync(html, /(\sstyle=")([^"]*url\([^"]*)(")/g, async (m) => m[1] + (await inlineCssUrls(m[2], deckDir)) + m[3]);
html = await replaceAsync(html, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, async (m) => m[1] + (await inlineCssUrls(await inlineFonts(m[2], deckDir), deckDir)) + m[3]);

/* head: share preview, favicon, robots, lang. Only what the deck does not already declare. */
const metaJson = html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)?.[1];
let dm: { title?: string; subtitle?: string; visibility?: string; lang?: string } = {};
try { dm = JSON.parse(metaJson ?? "{}"); } catch { /* lint가 알려 준다 */ }
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#000"/><rect x="7" y="9" width="18" height="14" rx="2" fill="none" stroke="#fff" stroke-width="2"/></svg>`;
const heads: string[] = [];
if (!/<meta[^>]*name=["']viewport["']/i.test(html)) heads.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
if (!/<link[^>]*rel=["'](?:shortcut )?icon["']/i.test(html)) heads.push(`<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">`);
if (dm.title && !/property=["']og:title["']/i.test(html)) heads.push(`<meta property="og:title" content="${esc(dm.title)}">`);
if (dm.subtitle && !/name=["']description["']/i.test(html)) heads.push(`<meta name="description" content="${esc(dm.subtitle)}">`, `<meta property="og:description" content="${esc(dm.subtitle)}">`);
if (dm.visibility === "password" && !/name=["']robots["']/i.test(html)) heads.push('<meta name="robots" content="noindex">');
if (heads.length) html = html.replace(/<head[^>]*>/i, (h) => `${h}\n  ${heads.join("\n  ")}`);
if (!/<title>[^<]+<\/title>/i.test(html) && dm.title) html = html.replace(/<\/head>/i, () => `  <title>${esc(dm.title!)}</title>\n</head>`);
if (!/<html[^>]*\blang=/i.test(html)) html = html.replace(/<html\b/i, `<html lang="${dm.lang === "en" ? "en" : "ko"}"`);

await mkdir(join(root, "dist"), { recursive: true });
const outFile = join(root, "dist", `${name}.html`);
await Bun.write(outFile, html);
if (fontFaces) console.log(`fonts: ${fontFaces} faces, ${(fontBytes / 1024).toFixed(0)} KB`);
const imgBytes = [...assetBytes.values()].reduce((a, b) => a + b, 0);
if (assetBytes.size) console.log(`images: ${assetBytes.size} files, ${(imgBytes / 1024).toFixed(0)} KB`);
for (const [f, b] of assetBytes) if (b > 400 * 1024) console.warn(`큰 이미지: ${f} (${(b / 1024 / 1024).toFixed(1)} MB). 크기를 줄이면 번들이 가벼워지고 열리는 속도가 빨라진다(권장: 1920px 폭 이하, 400KB 이하).`);
console.log(`${outFile}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
