/* 발행 호환 검사(spec/ARTIFACT-CHECK.md): 덱을 단일 HTML 파일로 올려도 그대로 동작하는지 올리기 전에 본다.
   기본은 원본을 읽는 정적 검사(빠르고 오프라인). build: true면 실제로 번들러를 돌려 크기와 묶을 수 있음을 확정한다. 안내용이고 실제 차단은 배포 Worker의 CSP다. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { Issue } from "./lint";

export const MAX_BYTES = 16 * 1024 * 1024;
export const WARN_BYTES = 12 * 1024 * 1024;
export const ALLOWED_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"]; // 번들러가 글꼴 CSS로 인라인하는 곳
const FONT_ESTIMATE = 400 * 1024, FONT_ESTIMATE_MAX = 2 * 1024 * 1024;
const ENGINE = join(import.meta.dir);

export type Level = "OK" | "WARN" | "FAIL";
export type Check = { id: "bundle" | "hosts" | "size" | "storage" | "network"; level: Level; msg: string; items: string[] };
export type ArtifactResult = { deck: string; ok: boolean; checks: Check[]; estimatedBytes: number; reasons: string[] };
export type Opts = { allowHosts?: string[]; build?: boolean };

const STORAGE = /\b(localStorage|sessionStorage|indexedDB|openDatabase|caches|document\s*\.\s*cookie)\b/;
const NETWORK = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\s*\()|\bimport\s*\(/;
const BLOCKED = /(?:^|\/)(?:\.git(?:\/|$)|\.env|\.mcp\.json|\.claude(?:\/|$)|comments\.json$|node_modules(?:\/|$))/;
const isRemote = (u: string) => /^(?:https?:)?\/\//i.test(u);
const isLocal = (u: string) => !/^(?:data:|blob:|https?:|\/\/|#|mailto:|about:|javascript:)/i.test(u.trim()) && u.trim() !== "";

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const stripHtmlComments = (h: string) => h.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")); // 줄 번호를 지키려고 공백으로 바꾼다
const stripJsComments = (js: string) => js.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/.*$/gm, (m) => " ".repeat(m.length));

type Src = { file: string; line0: number; text: string; css?: boolean; js?: boolean; base: string }; // line0: 글이 시작하는 줄(파일 안)

/** 검사할 글: HTML 본문(자원 속성), 인라인과 로컬 스크립트, 인라인과 로컬 스타일. 엔진 파일과 JSON 스크립트는 뺀다. */
function sources(html: string, deckDir: string, rel = "index.html") {
  const h = stripHtmlComments(html);
  const scripts: Src[] = [], styles: Src[] = [];
  for (const m of h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/type\s*=\s*["']application\/(?:json|ld\+json)/i.test(attrs)) continue;
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)/i)?.[1];
    if (src) {
      if (/(?:^|\/)slidekit\.js(?:[?#]|$)/.test(src)) continue; // 엔진은 별도 시험이 깨끗함을 보증한다
      if (isLocal(src)) {
        const f = resolve(deckDir, decodeURIComponent(src.split(/[?#]/)[0]));
        if (existsSync(f)) scripts.push({ file: src, line0: 1, text: readFileSync(f, "utf8"), js: true, base: dirname(f) });
      }
    } else scripts.push({ file: rel, line0: lineOf(h, m.index! + m[0].indexOf(">") + 1), text: m[2], js: true, base: deckDir });
  }
  for (const m of h.matchAll(/\bon[a-z]+\s*=\s*"([^"]*)"|\bon[a-z]+\s*=\s*'([^']*)'/gi)) scripts.push({ file: rel, line0: lineOf(h, m.index!), text: m[1] ?? m[2], js: true, base: deckDir });
  for (const m of h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) styles.push({ file: rel, line0: lineOf(h, m.index!), text: m[1], css: true, base: deckDir });
  for (const m of h.matchAll(/\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/gi)) styles.push({ file: rel, line0: lineOf(h, m.index!), text: m[1] ?? m[2], css: true, base: deckDir });
  for (const m of h.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(m[0])) continue;
    const href = m[0].match(/\bhref\s*=\s*["']([^"']+)/i)?.[1];
    if (!href || !isLocal(href) || /(?:^|\/)slidekit\.css(?:[?#]|$)/.test(href)) continue;
    const f = resolve(deckDir, decodeURIComponent(href.split(/[?#]/)[0]));
    if (existsSync(f)) styles.push({ file: href, line0: 1, text: readFileSync(f, "utf8"), css: true, base: dirname(f) });
  }
  return { h, scripts, styles };
}

type Ref = { url: string; tag: string; attr: string; where: string; fontCss: boolean; base: string };
/** 자원 속성이 가리키는 주소(3절). a의 href와 xmlns는 이동이거나 이름이라 뺀다. */
function refs(h: string, styles: Src[], rel = "index.html", deckDir = ""): Ref[] {
  const out: Ref[] = [];
  const URLATTR = /\b(src|href|xlink:href|poster|data|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of h.matchAll(/<([a-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
    const tag = m[1].toLowerCase();
    if (tag === "a") continue; // 이동일 뿐 자원이 아니다
    if (tag === "meta") {
      const u = /http-equiv\s*=\s*["']?refresh/i.test(m[2]) ? m[2].match(/content\s*=\s*["'][^"']*url\s*=\s*([^"']+)/i)?.[1] : undefined;
      if (u) out.push({ url: u.trim(), tag, attr: "refresh", where: `${rel}:${lineOf(h, m.index!)}`, fontCss: false, base: deckDir });
      continue;
    }
    const fontLink = tag === "link" && (/\brel\s*=\s*["']?(?:stylesheet|preload|preconnect|dns-prefetch)/i.test(m[2]));
    for (const a of m[2].matchAll(URLATTR)) {
      const attr = a[1].toLowerCase(), val = a[2] ?? a[3] ?? "";
      const urls = attr === "srcset" ? val.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : [val.trim()];
      for (const url of urls) if (url) out.push({ url, tag, attr, where: `${rel}:${lineOf(h, m.index!)}`, fontCss: fontLink, base: deckDir });
    }
  }
  for (const s of styles) {
    for (const m of s.text.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi)) if (!/@import\s*$/i.test(s.text.slice(0, m.index!))) out.push({ url: m[2].trim(), tag: "css", attr: "url()", where: `${s.file}:${s.line0 + s.text.slice(0, m.index!).split("\n").length - 1}`, fontCss: /@font-face/i.test(s.text.slice(Math.max(0, m.index! - 200), m.index!)), base: s.base });
    for (const m of s.text.matchAll(/@import\s+(?:url\(\s*)?["']?([^)"';\s]+)/gi)) out.push({ url: m[1], tag: "css", attr: "@import", where: `${s.file}:${s.line0 + s.text.slice(0, m.index!).split("\n").length - 1}`, fontCss: true, base: s.base });
  }
  return out;
}

const hostOf = (u: string) => { try { return new URL(u.startsWith("//") ? "https:" + u : u).host; } catch { return u.slice(0, 40); } };

function localProblem(r: Ref, deckDir: string): string | null {
  const u = r.url;
  if (!isLocal(u)) return null;
  const f = resolve(r.base || deckDir, decodeURIComponent(u.split(/[?#]/)[0]).replace(/^\//, ""));
  const roots = [resolve(deckDir), resolve(ENGINE)];
  if (!roots.some((d) => f === d || f.startsWith(d + sep))) return `${u}: 덱 폴더 밖의 파일(${r.where})`;
  if (BLOCKED.test(f.replace(resolve(deckDir, "..", ".."), ""))) return `${u}: 번들러가 거부하는 경로(${r.where})`;
  if (!existsSync(f)) return `${u}: 없는 파일(${r.where})`;
  try { const real = realpathSync(f); if (!roots.some((d) => real.startsWith(realpathSync(d) + sep) || real === realpathSync(d))) return `${u}: 심볼릭 링크가 덱 폴더 밖을 가리킨다(${r.where})`; } catch { /* 위에서 존재 확인 */ }
  // 번들러가 인라인하지 않는 태그의 로컬 파일은 단일 파일에 들어가지 않는다
  if (["iframe", "embed", "object", "form"].includes(r.tag)) return `${u}: <${r.tag}>의 로컬 파일은 단일 파일에 들어가지 않는다(${r.where})`;
  return null;
}

function scan(list: Src[], re: RegExp) {
  const hits: string[] = [];
  for (const s of list) {
    const text = s.js ? stripJsComments(s.text) : s.text;
    text.split("\n").forEach((line, i) => {
      const m = line.match(re);
      if (m) hits.push(`${(m[1] ?? m[0]).replace(/\s+/g, "")} (${s.file}:${s.line0 + i}): ${line.trim().slice(0, 60)}`);
    });
  }
  return hits;
}

/** 예상 렌더 크기(base64 포함). 실제 번들이 소스보다 새로우면 그 크기를 쓴다. 번들러가 인라인하는 로컬 파일(이미지, 영상, 소리, 스타일, 스크립트)의 크기를 더한다. */
export function estimateBytes(html: string, deckDir: string, deck: string, all: Ref[] = []): { bytes: number; actual: boolean } {
  const bundle = join(deckDir, "..", "..", "dist", `${deck}.html`);
  try { if (existsSync(bundle) && statSync(bundle).mtimeMs > statSync(join(deckDir, "index.html")).mtimeMs) return { bytes: statSync(bundle).size, actual: true }; } catch { /* 추정으로 */ }
  const engine = ["slidekit.js", "slidekit.css"].reduce((n, f) => n + statSync(join(ENGINE, f)).size, 0);
  const files = new Set<string>();
  for (const r of all) if (isLocal(r.url) && !["a", "iframe", "embed", "object"].includes(r.tag)) files.add(resolve(r.base || deckDir, decodeURIComponent(r.url.split(/[?#]/)[0]).replace(/^\//, "")));
  let assets = 0;
  for (const f of files) { if (f.startsWith(resolve(ENGINE) + sep)) continue; try { const st = statSync(f); if (st.isFile()) assets += st.size; } catch { /* 없는 파일은 bundle 검사가 알린다 */ } }
  const faces = /@font-face/i.test(html) || /<link\b[^>]*rel=["']?stylesheet[^>]*href=["']https?:/i.test(html);
  return { bytes: Buffer.byteLength(html) + engine + Math.ceil((assets * 4) / 3) + (faces ? Math.min(FONT_ESTIMATE_MAX, FONT_ESTIMATE * 2) : 0), actual: false };
}

const mib = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MiB`;

export function artifactCheck(deckDir: string, opts: Opts = {}): ArtifactResult {
  const deck = deckDir.split("/").pop() ?? "";
  const html = readFileSync(join(deckDir, "index.html"), "utf8");
  const { h, scripts, styles } = sources(html, deckDir);
  const all = refs(h, styles, "index.html", deckDir);
  const allow = new Set([...ALLOWED_FONT_HOSTS, ...(opts.allowHosts ?? [])]);
  const checks: Check[] = [];

  const lp = [...new Set(all.map((r) => localProblem(r, deckDir)).filter((x): x is string => !!x))];
  const nLocal = new Set(all.filter((r) => isLocal(r.url)).map((r) => r.url)).size;
  checks.push({ id: "bundle", level: lp.length ? "FAIL" : "OK", msg: lp.length ? `단일 파일로 묶을 수 없다(${lp.length}건)` : `단일 파일로 묶을 수 있다(로컬 참조 ${nLocal}개, 모두 덱 폴더 안)`, items: lp });

  const ext = all.filter((r) => isRemote(r.url) && !(r.fontCss && allow.has(hostOf(r.url)))).map((r) => `${hostOf(r.url)} — <${r.tag}> ${r.attr} ${r.url.slice(0, 70)} (${r.where})`);
  const extU = [...new Set(ext)];
  checks.push({ id: "hosts", level: extU.length ? "FAIL" : "OK", msg: extU.length ? `허용 호스트 밖의 외부 자원 ${extU.length}건` : "허용 호스트 밖의 외부 자원 없음", items: extU });

  let est = estimateBytes(html, deckDir, deck, all);
  if (opts.build) {
    const b = Bun.spawnSync(["bun", join(import.meta.dir, "..", "bundler", "bundle.ts"), deck], { stdout: "pipe", stderr: "pipe" });
    if (b.exitCode !== 0) {
      const c = checks.find((x) => x.id === "bundle")!;
      c.level = "FAIL"; c.msg = "번들러가 실패했다"; c.items.push(b.stderr.toString().trim().split("\n").slice(-2).join(" ").slice(0, 200));
    } else { const f = join(deckDir, "..", "..", "dist", `${deck}.html`); est = { bytes: statSync(f).size, actual: true }; }
  }
  const sizeLevel: Level = est.bytes > MAX_BYTES ? "FAIL" : est.bytes >= WARN_BYTES ? "WARN" : "OK";
  checks.push({ id: "size", level: sizeLevel, msg: `${est.actual ? "번들 크기" : "예상 크기"} ${mib(est.bytes)} (한도 ${mib(MAX_BYTES)})`, items: [] });

  const st = scan(scripts, new RegExp(STORAGE.source, "")), nw = scan(scripts, new RegExp(NETWORK.source, ""));
  checks.push({ id: "storage", level: st.length ? "FAIL" : "OK", msg: st.length ? `브라우저 저장소 사용 ${st.length}건` : "localStorage, sessionStorage, indexedDB 사용 없음", items: st });
  checks.push({ id: "network", level: nw.length ? "FAIL" : "OK", msg: nw.length ? `외부로 나가는 요청 ${nw.length}건` : "fetch, XMLHttpRequest, WebSocket 사용 없음", items: nw });

  const reasons = checks.filter((c) => c.level === "FAIL").map((c) => `${c.msg}${c.items[0] ? `: ${c.items[0]}` : ""}`);
  return { deck, ok: reasons.length === 0, checks, estimatedBytes: est.bytes, reasons };
}

const NAME: Record<Check["id"], string> = { bundle: "번들", hosts: "외부자원", size: "크기", storage: "저장소", network: "네트워크" };
/** 한 화면 요약. 줄은 OK, WARN, FAIL로 시작한다. */
export function formatArtifact(r: ArtifactResult): string[] {
  const out: string[] = [];
  for (const c of r.checks) {
    out.push(`${c.level.padEnd(4)} ${NAME[c.id].padEnd(6)} ${c.msg}`);
    for (const it of c.items.slice(0, 5)) out.push(`       ${it}`);
    if (c.items.length > 5) out.push(`       그 밖의 ${c.items.length - 5}건`);
  }
  out.push("", r.ok ? "Artifact로 올릴 수 있음" : `Artifact로 올릴 수 없음: ${r.reasons.join("; ")}`);
  return out;
}

/** lint --artifact: 같은 검사를 lint 규칙(artifact-*, 모두 error)으로 낸다. */
export function artifactIssues(deckDir: string, opts: Opts = {}): Issue[] {
  const r = artifactCheck(deckDir, opts);
  return r.checks.filter((c) => c.level === "FAIL").flatMap((c) => (c.items.length ? c.items : [c.msg]).map((it) => ({ level: "error" as const, rule: `artifact-${c.id}`, msg: `${c.msg}: ${it}` })));
}
