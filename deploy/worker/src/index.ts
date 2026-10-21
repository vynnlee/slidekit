// 덱 게시용 Worker(사용자가 직접 배포한다, deploy/README.md). 덱 HTML과 공개 범위는 KV(DECKS)에 있다.
//   html:<deck> = 번들 HTML, meta:<deck> = {visibility, salt, hash}
// 비밀번호는 해시만 저장한다. 쿠키 서명 키는 Worker 비밀 값 COOKIE_SECRET이다.

import { PERMISSIONS, cleanHosts, deckCsp } from "./csp";

type KV = {
  get(key: string, type?: "text"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};
// 로그인 시도 카운터 Durable Object 바인딩(선택). 없으면 KV 카운터로 동작한다(구버전 배포와 호환).
export type LimiterNs = { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } };
export type Env = { DECKS: KV; COOKIE_SECRET: string; LIMITER?: LimiterNs };
export type Meta = { visibility: "public" | "password"; lang?: string; title?: string; salt?: string; hash?: string; hosts?: unknown };

const enc = new TextEncoder();
const ITER = 100_000; // Workers의 PBKDF2 반복 상한
const DAY = 7 * 24 * 3600;
const MAX_FAILS = 5;
const WINDOW = 15 * 60; // 초. 첫 실패부터 센다

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(pw: string, salt = b64(crypto.getRandomValues(new Uint8Array(16)).buffer)) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: ITER }, key, 256);
  return { salt, hash: b64(bits) };
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.reduce((d, x, i) => d | (x ^ b[i]), 0) === 0;

// 서명 대상에 덱 이름과 비밀번호 salt를 넣는다. 비밀번호를 바꾸면(salt가 바뀌면) 이미 발급된 쿠키가 모두 무효가 된다.
export async function makeCookie(secret: string, deck: string, salt: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + DAY;
  const sig = b64((await hmac(secret, `${deck}.${exp}.${salt}`)).buffer as ArrayBuffer);
  return `sk_${deck}=${exp}.${encodeURIComponent(sig)}; Path=/${deck}; Max-Age=${DAY}; HttpOnly; Secure; SameSite=Strict`;
}

async function validCookie(req: Request, secret: string, deck: string, salt: string, now = Date.now()) {
  const m = (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)sk_${deck}=(\\d+)\\.([^;]+)`));
  if (!m || Number(m[1]) < now / 1000) return false;
  try {
    return same(await hmac(secret, `${deck}.${m[1]}.${salt}`), unb64(decodeURIComponent(m[2])));
  } catch { return false; }
}

// 이 공통 헤더의 CSP는 안내 페이지와 오류용이다. 덱 응답은 page()에서 deckCsp(meta.hosts)로 바꾼다(spec/WORKER-CSP.md).
// Cross-Origin-Opener-Policy와 Resource-Policy: 같은 출처의 다른 덱이 window.open이나 fetch로 잠금 해제된 덱을 읽지 못하게 한다.
const headers = {
  "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'", "Strict-Transport-Security": "max-age=31536000",
  "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin",
};

const T = {
  ko: { title: "비밀번호", hint: "이 덱은 비밀번호가 필요합니다", ph: "비밀번호", open: "열기", wrong: "비밀번호가 맞지 않습니다", locked: "시도가 너무 많습니다", retry: (n: number) => `약 ${n}분 뒤에 다시 시도할 수 있습니다`, none: "찾을 수 없습니다", denied: "허용되지 않은 요청입니다", opening: "여는 중" },
  en: { title: "Password", hint: "This deck is password protected", ph: "Password", open: "Open", wrong: "Incorrect password", locked: "Too many attempts", retry: (n: number) => `Try again in about ${n} min`, none: "Not found", denied: "Request not allowed", opening: "Opening" },
};
type Msg = (typeof T)["ko"];
// deck-meta.lang이 우선이고, 없으면 Accept-Language 첫 항목, 기본은 ko이다.
const msgs = (req: Request, meta?: Meta | null): Msg => {
  const l = meta?.lang ?? req.headers.get("Accept-Language")?.split(",")[0].trim().toLowerCase() ?? "";
  return l.startsWith("en") ? T.en : T.ko;
};
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// 비밀번호, 잠금, 없음 안내가 같은 모양(검은 바탕, 흰 글자, 가운데 한 칸)을 쓴다. 모바일 390px에서도 한 칸 폭을 지킨다.
const CSS = `<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#000;color:#fff;font:16px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;-webkit-font-smoothing:antialiased}
main{display:grid;gap:14px;width:min(320px,100%)}
h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}
p{margin:0;font-size:14px;color:#a3a3a3}
p.e{color:#f87171}
form{display:grid;gap:12px}
input,button{font:inherit;width:100%;min-height:44px;padding:11px 14px;border-radius:10px;border:1px solid #333;background:#0a0a0a;color:#fff}
input::placeholder{color:#6b6b6b}
input[aria-invalid=true]{border-color:#f87171}
button{background:#fff;color:#000;border-color:#fff;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:progress}
input:focus-visible,button:focus-visible{outline:2px solid #fff;outline-offset:2px}
</style>`;
const shell = (m: Msg, title: string, body: string, status: number, extra: Record<string, string> = {}, nonce = "") => new Response(
  `<!doctype html><html lang="${m === T.en ? "en" : "ko"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="data:,"><title>${esc(title)}</title>${CSS}<main>${body}</main>`,
  { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; ${nonce ? `script-src 'nonce-${nonce}'; ` : ""}form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, ...extra } },
);
// 없음, 잠금, 거부 같은 막다른 안내
const plain = (status: number, text: string, extra: Record<string, string> = {}, m: Msg = T.ko, detail = "") =>
  shell(m, text, `<h1>${esc(text)}</h1>${detail ? `<p>${esc(detail)}</p>` : ""}`, status, extra);

// 로그인 시도 제한. (덱, IP)별로 15분 창에서 MAX_FAILS번까지 시도할 수 있고, 맞으면 지운다.
// Durable Object(LIMITER)가 있으면 시도를 검사와 동시에 센다(한 객체가 요청을 직렬로 처리하므로 동시 요청이 5번을 넘기지 못한다).
// 없으면 KV 카운터를 쓴다: 읽고 쓰기 사이에 틈이 있어 동시 요청에 뚫릴 수 있다(구버전과 같은 동작).
type Fails = { n: number; start: number };
type Take = { ok: boolean; wait: number };
const nextFail = (f: Fails | null, nowMs: number): Fails => (f && nowMs / 1000 - f.start < WINDOW ? f : { n: 0, start: nowMs / 1000 });
function limiter(env: Env, key: string, now: number) {
  if (env.LIMITER) {
    const stub = env.LIMITER.get(env.LIMITER.idFromName(key));
    const call = async (op: string) => (await (await stub.fetch(new Request(`https://limiter/${op}`, { method: "POST", body: JSON.stringify({ now }) }))).json()) as Take;
    return { take: () => call("attempt"), fail: async () => {}, clear: async () => { await call("clear"); } };
  }
  return {
    async take(): Promise<Take> {
      const f = nextFail(JSON.parse((await env.DECKS.get(key)) ?? "null"), now);
      return { ok: f.n < MAX_FAILS, wait: Math.ceil(f.start + WINDOW - now / 1000) };
    },
    async fail() {
      const f = nextFail(JSON.parse((await env.DECKS.get(key)) ?? "null"), now);
      f.n++;
      await env.DECKS.put(key, JSON.stringify(f), { expirationTtl: WINDOW });
    },
    async clear() { await env.DECKS.delete(key); },
  };
}

// Durable Object: 키(덱:IP)마다 하나. 시도 횟수와 창 시작을 저장하고, 창이 끝나면 알람으로 저장소를 비운다.
type Storage = { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; deleteAll(): Promise<void>; setAlarm(t: number): Promise<void> };
export class Limiter {
  constructor(private state: { storage: Storage }) {}
  async fetch(req: Request): Promise<Response> {
    const st = this.state.storage;
    const { now } = (await req.json().catch(() => ({ now: Date.now() }))) as { now: number };
    if (new URL(req.url).pathname === "/clear") { await st.deleteAll(); return Response.json({ ok: true, wait: 0 }); }
    // 읽고 쓰는 사이에 외부 호출(fetch 등)이 없어 같은 객체의 다른 요청이 끼어들지 못한다.
    const f = nextFail(await st.get<Fails>("f") ?? null, now);
    const wait = Math.ceil(f.start + WINDOW - now / 1000);
    if (f.n >= MAX_FAILS) return Response.json({ ok: false, wait });
    f.n++;
    await st.put("f", f);
    await st.setAlarm(f.start * 1000 + WINDOW * 1000 + 1000);
    return Response.json({ ok: true, wait });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}

const form = (m: Msg, meta: Meta, err = "", nonce = crypto.randomUUID().replace(/-/g, "")) => shell(m, meta.title || m.title,
  `<form method="post"><h1>${esc(meta.title || m.title)}</h1><p id="h">${m.hint}</p><input type="password" name="password" placeholder="${m.ph}" aria-label="${m.ph}" aria-describedby="${err ? "e" : "h"}"${err ? ' aria-invalid="true"' : ""} autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" autofocus required>${err ? `<p class="e" id="e" role="alert">${err}</p>` : ""}<button>${m.open}</button></form>
<script nonce="${nonce}">(function(){var f=document.forms[0],b=f.querySelector("button"),t=b.textContent;f.addEventListener("submit",function(){b.disabled=true;b.textContent="${m.opening}..."});addEventListener("pageshow",function(){b.disabled=false;b.textContent=t})})()</script>`,
  err ? 401 : 200, {}, nonce);

// /<덱>/deck.md: 덱의 글(발표자 노트 없음)을 Markdown으로. 비밀번호 덱은 덱 HTML과 같은 쿠키 관문 뒤에서만 나온다(spec/DECK-MD-DEPLOY.md).
// 공개 덱은 누구나(에이전트의 curl 포함) 읽는다. Sec-Fetch-Dest 검사는 비밀번호 덱에만 걸린다: 같은 출처의 다른 덱 스크립트가 fetch로 읽는 것을 막는다.
const textOnly = (status: number, text: string, extra: Record<string, string> = {}) =>
  new Response(text + "\n", { status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", ...extra } });
async function serveMarkdown(req: Request, env: Env, deck: string, now: number): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return textOnly(405, "Method not allowed", { Allow: "GET, HEAD" });
  const meta: Meta | null = JSON.parse((await env.DECKS.get(`meta:${deck}`)) ?? "null");
  const md = meta && (await env.DECKS.get(`md:${deck}`));
  if (!meta || !md) return textOnly(404, msgs(req, meta).none);
  let cache = "public, max-age=0, must-revalidate";
  if (meta.visibility === "password") {
    const m = msgs(req, meta);
    if (!meta.salt || !meta.hash) return textOnly(404, m.none);
    const dest = req.headers.get("Sec-Fetch-Dest");
    if (dest && dest !== "document") return textOnly(403, m.denied);
    if (!(await validCookie(req, env.COOKIE_SECRET, deck, meta.salt, now))) return textOnly(403, m.hint);
    cache = "private, no-store";
  }
  return new Response(req.method === "HEAD" ? null : md, { headers: { ...headers, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": cache } });
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const md = new URL(req.url).pathname.match(/^\/([\w-]+)\/deck\.md$/);
  if (md) return serveMarkdown(req, env, md[1], now);
  const deck = new URL(req.url).pathname.replace(/^\/|\/$/g, "");
  if (!/^[\w-]+$/.test(deck)) return plain(404, msgs(req).none, {}, msgs(req));
  const meta: Meta | null = JSON.parse((await env.DECKS.get(`meta:${deck}`)) ?? "null");
  const html = meta && (await env.DECKS.get(`html:${deck}`));
  if (!["GET", "HEAD", "POST"].includes(req.method)) return plain(405, "Method not allowed", { Allow: "GET, HEAD, POST" }, msgs(req));
  if (!meta || !html) return plain(404, msgs(req, meta).none, {}, msgs(req, meta));
  const m = msgs(req, meta);

  // 덱 응답(공개, 비밀번호 통과 뒤)은 외부로 나가는 요청을 막는 CSP를 붙인다. hosts는 deploy가 번들에서 뽑아 올린 값이고 여기서 다시 검증한다.
  const page = (cache: string) => new Response(html, { headers: { ...headers, "Content-Security-Policy": deckCsp(cleanHosts(meta.hosts)), "Permissions-Policy": PERMISSIONS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache } });
  if (meta.visibility !== "password") return page("public, max-age=0, must-revalidate");
  if (!meta.salt || !meta.hash) return plain(404, m.none, {}, m);

  if (req.method === "POST") {
    // 로그인 CSRF 방지: 다른 사이트에서 온 폼 전송은 거부한다. SameSite=Strict 쿠키가 나머지를 막는다.
    const origin = req.headers.get("Origin");
    let oh = ""; // Origin: null이나 깨진 값은 파싱 예외 대신 거부한다
    if (origin) { try { oh = new URL(origin).host; } catch { return plain(403, m.denied, {}, m); } }
    if (origin && oh !== new URL(req.url).host) return plain(403, m.denied, {}, m);
    const key = `rl:${deck}:${req.headers.get("cf-connecting-ip") ?? "unknown"}`;
    const rl = limiter(env, key, now);
    const t = await rl.take();
    if (!t.ok) { const wait = t.wait; return plain(429, m.locked, { "Retry-After": String(wait) }, m, m.retry(Math.max(1, Math.ceil(wait / 60)))); } // 맞는 비밀번호도 잠금 중이면 거부한다
    const pw = (await req.formData().catch(() => null))?.get("password");
    const { hash } = await hashPassword(typeof pw === "string" ? pw : "", meta.salt);
    if (!same(unb64(hash), unb64(meta.hash))) {
      await rl.fail();
      return form(m, meta, m.wrong);
    }
    await rl.clear();
    return new Response(null, { status: 303, headers: { ...headers, Location: `/${deck}`, "Set-Cookie": await makeCookie(env.COOKIE_SECRET, deck, meta.salt, now) } });
  }
  // 같은 출처의 다른 덱 스크립트가 fetch로 읽는 것을 막는다: 보호된 덱은 주소창 이동(문서) 요청에만 서빙한다.
  const dest = req.headers.get("Sec-Fetch-Dest");
  if (dest && dest !== "document") return plain(403, m.denied, {}, m);
  return (await validCookie(req, env.COOKIE_SECRET, deck, meta.salt)) ? page("private, no-store") : form(m, meta);
}

// Workers 런타임은 fetch(request, env, ctx)로 부른다. handle의 셋째 인자는 시각(테스트용)이라 ctx를 그대로 넘기면 now가 객체가 되어
// 쿠키 만료 계산이 깨진다(비밀번호 POST가 500). 그래서 런타임 진입점은 request와 env만 넘긴다.
export default { fetch: (req: Request, env: Env) => handle(req, env) };
