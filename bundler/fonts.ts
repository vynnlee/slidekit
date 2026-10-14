/* 번들러의 글꼴 처리: CSS의 @font-face를 찾아 덱이 쓰는 글자만 남긴 woff2로 바꿔 인라인한다.
   원격(Google Fonts, jsdelivr 등 CDN CSS)과 로컬(url(./fonts/X.woff2))을 같은 방식으로 다룬다. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export type Range = [number, number];

/** `U+0460-052F, U+20B4, U+4??` 형태를 숫자 범위로. 없으면 null(모든 글자). */
export function parseRange(s: string | undefined): Range[] | null {
  if (!s) return null;
  const out: Range[] = [];
  for (const t of s.split(",")) {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(t.trim());
    if (!m) continue;
    if (m[1].includes("?")) out.push([parseInt(m[1].replace(/\?/g, "0"), 16), parseInt(m[1].replace(/\?/g, "f"), 16)]);
    else out.push([parseInt(m[1], 16), m[2] ? parseInt(m[2], 16) : parseInt(m[1], 16)]);
  }
  return out.length ? out : null;
}
export const rangeHits = (r: Range[] | null, chars: Set<number>) => !r || [...chars].some((c) => r.some(([a, b]) => c >= a && c <= b));

/** CSS 안의 @font-face 블록 위치 */
export function faceBlocks(css: string): { start: number; end: number; body: string }[] {
  const out: { start: number; end: number; body: string }[] = [];
  const hidden = css.replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length));
  for (const m of hidden.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) out.push({ start: m.index!, end: m.index! + m[0].length, body: css.slice(m.index!, m.index! + m[0].length) });
  return out;
}
/** 블록에서 쓸 글꼴 파일 URL: woff2를 우선, 없으면 첫 url */
export function pickSrc(block: string): { url: string; format: string } | null {
  const src = /src\s*:\s*([^;}]*)/i.exec(block)?.[1];
  if (!src) return null;
  const items = [...src.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)(?:\s*format\(\s*["']?([\w-]+)["']?\s*\))?/gi)].map((m) => ({ url: m[2], format: (m[3] ?? "").toLowerCase() }));
  return items.find((i) => /woff2/.test(i.format) || /\.woff2(\?|#|$)/i.test(i.url)) ?? items[0] ?? null;
}
export const withSrc = (block: string, dataUri: string) => block.replace(/src\s*:[^;}]*;?/i, `src:url(${dataUri}) format("woff2");`);
export const usedChars = (text: string) => new Set<number>([...text].map((c) => c.codePointAt(0)!).filter((c) => c > 0x20 || c === 0x20));

const cacheDir = process.env.SLIDEKIT_CACHE ?? join(homedir(), ".cache", "slidekit", "fonts");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 사설망, 루프백, 링크로컬 주소인지(SSRF 방어). IP 리터럴과 DNS 결과 모두에 쓴다. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.") || l.startsWith("::ffff:169.254.");
}
async function assertPublicHttps(u: URL) {
  if (u.protocol !== "https:") throw new Error(`https 주소만 받는다: ${u.href}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error(`내부 주소는 받지 않는다: ${host}`);
  if (/^[\d.]+$/.test(host) || host.includes(":")) { if (isPrivateAddress(host)) throw new Error(`내부 주소는 받지 않는다: ${host}`); return; }
  const addrs = await (await import("node:dns/promises")).lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`내부 주소로 연결되는 이름은 받지 않는다: ${host}`);
}
const MAX_BYTES = 20 * 1024 * 1024;

/** URL을 받아 캐시에 둔다(저장소에는 글꼴 파일을 두지 않는다). 같은 URL은 다시 받지 않는다.
    https만, 사설 주소 거부, 리다이렉트는 직접 따라가며 매번 검사, 15초 제한, 20MB 제한, 임시 파일에 쓴 뒤 rename. */
export async function fetchCached(url: string): Promise<Uint8Array> {
  mkdirSync(join(cacheDir, "net"), { recursive: true, mode: 0o700 });
  const f = join(cacheDir, "net", createHash("sha1").update(url).digest("hex"));
  if (existsSync(f)) return new Uint8Array(await Bun.file(f).arrayBuffer());
  let cur = new URL(url), res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHttps(cur);
    res = await fetch(cur, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur); continue; }
    break;
  }
  if (!res || !res.ok) throw new Error(`cannot download ${url} (${res?.status}); 인터넷이 필요하다. 받은 파일은 ${cacheDir}에 캐시된다`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error(`너무 큰 파일이다(${(len / 1048576).toFixed(0)}MB): ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`너무 큰 파일이다: ${url}`);
  const tmp = `${f}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, buf);
  renameSync(tmp, f); // 쓰다 중단된 잘린 파일이 캐시로 남지 않게 한다
  return buf;
}

/** 글꼴 파일들을 한 번에 부분집합 woff2로 만든다(uv와 fonttools 필요). */
export function subsetAll(inputs: Uint8Array[], chars: Set<number>): Uint8Array[] {
  if (!inputs.length) return [];
  const work = mkdtempSync(join(tmpdir(), "slidekit-font-"));
  try {
    writeFileSync(join(work, "chars.txt"), String.fromCodePoint(...chars));
    const jobs = inputs.map((b, i) => { writeFileSync(join(work, `in${i}`), b); return { in: join(work, `in${i}`), out: join(work, `out${i}.woff2`) }; });
    writeFileSync(join(work, "jobs.json"), JSON.stringify(jobs));
    // uv는 SLIDEKIT_UV로 바꿀 수 있다(테스트와 uv가 PATH에 없는 환경). 없으면 설치 방법을 알려 준다.
    let r;
    try { r = Bun.spawnSync([process.env.SLIDEKIT_UV ?? "uv", "run", "--quiet", "--with", "fonttools==4.66.1", "--with", "brotli==1.2.0", "python", join(import.meta.dir, "subset.py"), join(work, "chars.txt"), join(work, "jobs.json")], { stderr: "pipe" }); }
    catch (e) { throw new Error(`글꼴을 부분집합으로 줄이려면 uv가 필요하다. 설치: brew install uv 또는 https://docs.astral.sh/uv/ . 덱이 외부 글꼴 링크를 쓰지 않으면 이 단계는 필요 없다. (${String(e).slice(0, 120)})`); }
    if (r.exitCode !== 0) throw new Error("글꼴 부분집합 실패: " + r.stderr.toString().slice(-400));
    return jobs.map((j) => new Uint8Array(require("node:fs").readFileSync(j.out)));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** CSS 한 덩어리의 @font-face를 처리한다. load(url)이 글꼴 바이트를 돌려준다(원격이면 fetch, 로컬이면 파일).
    덱이 쓰지 않는 unicode-range 블록은 지운다. 바이트를 못 얻는 블록(eot, svg 등)은 그대로 둔다. */
export async function processFaces(css: string, chars: Set<number>, load: (url: string) => Promise<Uint8Array | null>): Promise<{ css: string; bytes: number; faces: number }> {
  const blocks = faceBlocks(css);
  // Google Fonts는 가변 글꼴 하나를 굵기마다 따로 선언한다(같은 url). 하나로 합쳐 같은 데이터를 두 번 인라인하지 않는다.
  const first = new Map<string, (typeof blocks)[number]>(), merged = new Map<(typeof blocks)[number], string>(), dup = new Set<(typeof blocks)[number]>();
  for (const b of blocks) {
    const w = /font-weight\s*:\s*(\d+)(?:\s+(\d+))?/i.exec(b.body), src = pickSrc(b.body);
    if (!w || !src) continue;
    const key = [/font-family\s*:\s*([^;}]+)/i.exec(b.body)?.[1], /font-style\s*:\s*([^;}]+)/i.exec(b.body)?.[1], src.url, /unicode-range\s*:\s*([^;}]*)/i.exec(b.body)?.[1]].join("|");
    const head = first.get(key);
    if (!head) { first.set(key, b); continue; }
    const hw = /font-weight\s*:\s*(\d+)(?:\s+(\d+))?/i.exec(merged.get(head) ?? head.body)!;
    const lo = Math.min(+hw[1], +w[1]), hi = Math.max(+(hw[2] ?? hw[1]), +(w[2] ?? w[1]));
    merged.set(head, (merged.get(head) ?? head.body).replace(/font-weight\s*:\s*[\d\s]+/i, `font-weight:${lo} ${hi}`));
    dup.add(b);
  }
  for (const [b, body] of merged) b.body = body;
  const todo: { b: (typeof blocks)[number]; data: Uint8Array }[] = [];
  const drop: (typeof blocks)[number][] = [];
  for (const b of blocks) {
    if (dup.has(b)) { drop.push(b); continue; }
    if (!rangeHits(parseRange(/unicode-range\s*:\s*([^;}]*)/i.exec(b.body)?.[1]), chars)) { drop.push(b); continue; }
    const s = pickSrc(b.body);
    if (!s || /^data:/i.test(s.url) || /\.(eot|svg)(\?|#|$)/i.test(s.url)) continue;
    const data = await load(s.url);
    if (data) todo.push({ b, data });
  }
  const out = subsetAll(todo.map((t) => t.data), chars);
  const repl = new Map<(typeof blocks)[number], string>();
  let bytes = 0;
  todo.forEach((t, i) => { bytes += out[i].length; repl.set(t.b, withSrc(t.b.body, `data:font/woff2;base64,${Buffer.from(out[i]).toString("base64")}`)); });
  let res = css, offset = 0;
  for (const b of blocks) {
    const to = drop.includes(b) ? "" : repl.get(b) ?? (merged.has(b) ? b.body : undefined);
    if (to === undefined) continue;
    res = res.slice(0, b.start + offset) + to + res.slice(b.end + offset);
    offset += to.length - (b.end - b.start);
  }
  return { css: res, bytes, faces: todo.length };
}
