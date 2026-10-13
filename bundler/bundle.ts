#!/usr/bin/env bun
/* bun run bundler/bundle.ts <deck folder name>  ->  dist/<deck>.html
   One self-contained file: engine, local images, subset fonts, all inlined. Opens from file://. */
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const name = process.argv[2];
if (!name) { console.error("usage: bun run bundler/bundle.ts <deck>"); process.exit(1); }
const deckDir = join(root, "decks", name);
const cache = process.env.SLIDEKIT_CACHE ?? join(homedir(), ".cache", "slidekit", "fonts");

const isLocal = (u: string) => !/^(data:|https?:|\/\/|#|mailto:|about:)/i.test(u);
async function dataUri(file: string) {
  const f = Bun.file(file);
  if (!(await f.exists())) throw new Error(`missing asset: ${file}`);
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
    isLocal(m[2]) ? `url("${await dataUri(resolve(base, m[2]))}")` : m[0]);

let html = await Bun.file(join(deckDir, "index.html")).text();

/* 1. fonts requested through Google Fonts links */
const fonts: { family: string; weights: number[] }[] = [];
html = html.replace(/<link\b[^>]*>\s*/g, (tag) => {
  if (/rel="preconnect"/.test(tag) && /fonts\.(googleapis|gstatic)\.com/.test(tag)) return "";
  const href = tag.match(/href="([^"]*fonts\.googleapis\.com\/css2[^"]*)"/)?.[1];
  if (!href) return tag;
  for (const f of new URL(href.replace(/&amp;/g, "&")).searchParams.getAll("family")) {
    const [family, axes = ""] = f.split(":");
    const weights = (axes.split("@")[1] ?? "400").split(";").map(Number).filter(Boolean);
    fonts.push({ family, weights });
  }
  return "";
});

/* 2. local stylesheets and scripts */
html = await replaceAsync(html, /<link\b[^>]*rel="stylesheet"[^>]*>/g, async (m) => {
  const href = m[0].match(/href="([^"]+)"/)?.[1];
  if (!href || !isLocal(href)) return m[0];
  const file = resolve(deckDir, href);
  const css = await inlineCssUrls(await Bun.file(file).text(), dirname(file));
  return `<style>\n${css.replace(/<\/style/gi, "<\\/style")}</style>`;
});
html = await replaceAsync(html, /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, async (m) => {
  if (!isLocal(m[1])) return m[0];
  const js = await Bun.file(resolve(deckDir, m[1])).text();
  return `<script>\n${js.replace(/<\/script/gi, "<\\/script")}</script>`;
});

/* 3. images and CSS urls in style blocks */
html = await replaceAsync(html, /(<(?:img|source|image)\b[^>]*?\b(?:xlink:)?(?:src|href)=")([^"]+)(")/g, async (m) =>
  isLocal(m[2]) ? m[1] + (await dataUri(resolve(deckDir, m[2]))) + m[3] : m[0]);
html = await replaceAsync(html, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, async (m) => m[1] + (await inlineCssUrls(m[2], deckDir)) + m[3]);

/* 4. font subsets: only the characters this deck uses */
if (fonts.length) {
  const text = html.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, "");
  const chars = new Set<string>([..." !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ "]);
  for (const ch of text) if (ch.codePointAt(0)! > 0x20 || ch === " ") chars.add(ch);
  const work = await mkdtemp(join(tmpdir(), "slidekit-font-"));
  await mkdir(cache, { recursive: true });
  await Bun.write(join(work, "chars.txt"), [...chars].join(""));
  const uv = (...args: string[]) => {
    const r = Bun.spawnSync(["uv", "run", "--quiet", "--with", "fonttools", "--with", "brotli", ...args], { stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  let faces = "";
  for (const { family, weights } of fonts) {
    const dir = family.replace(/\s+/g, "").toLowerCase(), file = `${family.replace(/\s+/g, "")}[wght].ttf`;
    const src = join(cache, file);
    if (!(await Bun.file(src).exists())) {
      const res = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`cannot download ${family} (${res.status}); put ${file} in ${cache}`);
      await Bun.write(src, await res.arrayBuffer());
    }
    const sub = join(work, dir + "-sub.ttf"), inst = join(work, dir + "-inst.ttf"), out = join(work, dir + ".woff2");
    const lo = Math.min(...weights), hi = Math.max(...weights);
    uv("pyftsubset", src, `--text-file=${join(work, "chars.txt")}`, `--output-file=${sub}`, "--layout-features=*", "--no-hinting");
    uv("fonttools", "varLib.instancer", sub, `wght=${lo}:${hi}`, "-o", inst);
    uv("pyftsubset", inst, `--text-file=${join(work, "chars.txt")}`, "--flavor=woff2", `--output-file=${out}`, "--layout-features=*");
    const b64 = Buffer.from(await Bun.file(out).arrayBuffer()).toString("base64");
    faces += `@font-face{font-family:"${family}";font-style:normal;font-weight:${lo} ${hi};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}\n`;
    console.log(`font ${family} ${lo}-${hi}: ${(b64.length * 0.75 / 1024).toFixed(0)} KB`);
  }
  await rm(work, { recursive: true, force: true });
  html = html.replace(/<style\b/, `<style>\n${faces}</style>\n<style`);
}

await mkdir(join(root, "dist"), { recursive: true });
const outFile = join(root, "dist", `${name}.html`);
await Bun.write(outFile, html);
console.log(`${outFile}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
