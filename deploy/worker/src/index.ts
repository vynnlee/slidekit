// static.vynnlee.com Worker. 덱 HTML과 공개 범위는 KV(DECKS)에 있다.
//   html:<deck> = 번들 HTML, meta:<deck> = {visibility, salt, hash}
// 비밀번호는 해시만 저장한다. 쿠키 서명 키는 Worker 비밀 값 COOKIE_SECRET이다.

type KV = {
  get(key: string, type?: "text"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};
export type Env = { DECKS: KV; COOKIE_SECRET: string };
export type Meta = { visibility: "public" | "password"; lang?: string; title?: string; salt?: string; hash?: string };

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

export async function makeCookie(secret: string, deck: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + DAY;
  const sig = b64((await hmac(secret, `${deck}.${exp}`)).buffer as ArrayBuffer);
  return `sk_${deck}=${exp}.${encodeURIComponent(sig)}; Path=/${deck}; Max-Age=${DAY}; HttpOnly; Secure; SameSite=Strict`;
}

async function validCookie(req: Request, secret: string, deck: string, now = Date.now()) {
  const m = (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)sk_${deck}=(\\d+)\\.([^;]+)`));
  if (!m || Number(m[1]) < now / 1000) return false;
  try {
    return same(await hmac(secret, `${deck}.${m[1]}`), unb64(decodeURIComponent(m[2])));
  } catch { return false; }
}

// script-src는 건드리지 않는다. 덱이 인라인 스크립트와 스타일을 쓴다.
const headers = {
  "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'",
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
const shell = (m: Msg, title: string, body: string, status: number, extra: Record<string, string> = {}) => new Response(
  `<!doctype html><html lang="${m === T.en ? "en" : "ko"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="data:,"><title>${esc(title)}</title>${CSS}<main>${body}</main>`,
  { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", ...extra } },
);
// 없음, 잠금, 거부 같은 막다른 안내
const plain = (status: number, text: string, extra: Record<string, string> = {}, m: Msg = T.ko, detail = "") =>
  shell(m, text, `<h1>${esc(text)}</h1>${detail ? `<p>${esc(detail)}</p>` : ""}`, status, extra);

// (덱, IP)별 실패 횟수를 KV에 둔다. KV 만료는 최소 60초라 창 안에서만 유효한 start로 직접 판단한다.
type Fails = { n: number; start: number };
async function failsOf(env: Env, key: string, now: number): Promise<Fails> {
  const f: Fails | null = JSON.parse((await env.DECKS.get(key)) ?? "null");
  return f && now / 1000 - f.start < WINDOW ? f : { n: 0, start: now / 1000 };
}

const form = (m: Msg, meta: Meta, err = "") => shell(m, meta.title || m.title,
  `<form method="post"><h1>${esc(meta.title || m.title)}</h1><p id="h">${m.hint}</p><input type="password" name="password" placeholder="${m.ph}" aria-label="${m.ph}" aria-describedby="${err ? "e" : "h"}"${err ? ' aria-invalid="true"' : ""} autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" autofocus required>${err ? `<p class="e" id="e" role="alert">${err}</p>` : ""}<button>${m.open}</button></form>
<script>(function(){var f=document.forms[0],b=f.querySelector("button"),t=b.textContent;f.addEventListener("submit",function(){b.disabled=true;b.textContent="${m.opening}..."});addEventListener("pageshow",function(){b.disabled=false;b.textContent=t})})()</script>`,
  err ? 401 : 200);

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const deck = new URL(req.url).pathname.replace(/^\/|\/$/g, "");
  if (!/^[\w-]+$/.test(deck)) return plain(404, msgs(req).none, {}, msgs(req));
  const meta: Meta | null = JSON.parse((await env.DECKS.get(`meta:${deck}`)) ?? "null");
  const html = meta && (await env.DECKS.get(`html:${deck}`));
  if (!meta || !html) return plain(404, msgs(req, meta).none, {}, msgs(req, meta));
  const m = msgs(req, meta);

  const page = (cache: string) => new Response(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache } });
  if (meta.visibility !== "password") return page("public, max-age=60");
  if (!meta.salt || !meta.hash) return new Response("Misconfigured", { status: 500 });

  if (req.method === "POST") {
    // 로그인 CSRF 방지: 다른 사이트에서 온 폼 전송은 거부한다. SameSite=Strict 쿠키가 나머지를 막는다.
    const origin = req.headers.get("Origin");
    if (origin && new URL(origin).host !== new URL(req.url).host) return plain(403, m.denied, {}, m);
    const key = `rl:${deck}:${req.headers.get("cf-connecting-ip") ?? "unknown"}`;
    const fails = await failsOf(env, key, now);
    if (fails.n >= MAX_FAILS) { const wait = Math.ceil(fails.start + WINDOW - now / 1000); return plain(429, m.locked, { "Retry-After": String(wait) }, m, m.retry(Math.max(1, Math.ceil(wait / 60)))); } // 맞는 비밀번호도 잠금 중이면 거부한다
    const pw = (await req.formData().catch(() => null))?.get("password");
    const { hash } = await hashPassword(typeof pw === "string" ? pw : "", meta.salt);
    if (!same(unb64(hash), unb64(meta.hash))) {
      fails.n++;
      await env.DECKS.put(key, JSON.stringify(fails), { expirationTtl: WINDOW });
      return form(m, meta, m.wrong);
    }
    await env.DECKS.delete(key);
    return new Response(null, { status: 303, headers: { ...headers, Location: `/${deck}`, "Set-Cookie": await makeCookie(env.COOKIE_SECRET, deck, now) } });
  }
  return (await validCookie(req, env.COOKIE_SECRET, deck)) ? page("private, no-store") : form(m, meta);
}

export default { fetch: handle };
