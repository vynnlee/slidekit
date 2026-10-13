// static.vynnlee.com Worker. 덱 HTML과 공개 범위는 KV(DECKS)에 있다.
//   html:<deck> = 번들 HTML, meta:<deck> = {visibility, salt, hash}
// 비밀번호는 해시만 저장한다. 쿠키 서명 키는 Worker 비밀 값 COOKIE_SECRET이다.

type KV = { get(key: string, type?: "text"): Promise<string | null> };
export type Env = { DECKS: KV; COOKIE_SECRET: string };
export type Meta = { visibility: "public" | "password"; salt?: string; hash?: string };

const enc = new TextEncoder();
const ITER = 100_000; // Workers의 PBKDF2 반복 상한
const DAY = 7 * 24 * 3600;

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

const headers = { "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

const form = (err = "") => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>비밀번호</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;font:16px system-ui}form{display:grid;gap:12px;width:260px}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #444;background:#111;color:#fff}button{background:#fff;color:#000}p{margin:0;color:#f87}</style>
<form method="post"><input type="password" name="password" placeholder="비밀번호" autofocus required>${err ? `<p>${err}</p>` : ""}<button>열기</button></form>`,
  { status: err ? 401 : 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
);

export async function handle(req: Request, env: Env): Promise<Response> {
  const deck = new URL(req.url).pathname.replace(/^\/|\/$/g, "");
  if (!/^[\w-]+$/.test(deck)) return new Response("Not found", { status: 404 });
  const meta: Meta | null = JSON.parse((await env.DECKS.get(`meta:${deck}`)) ?? "null");
  const html = meta && (await env.DECKS.get(`html:${deck}`));
  if (!meta || !html) return new Response("Not found", { status: 404 });

  const page = (cache: string) => new Response(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache } });
  if (meta.visibility !== "password") return page("public, max-age=60");
  if (!meta.salt || !meta.hash) return new Response("Misconfigured", { status: 500 });

  if (req.method === "POST") {
    const pw = (await req.formData().catch(() => null))?.get("password");
    const { hash } = await hashPassword(typeof pw === "string" ? pw : "", meta.salt);
    if (!same(unb64(hash), unb64(meta.hash))) return form("비밀번호가 맞지 않습니다");
    return new Response(null, { status: 303, headers: { ...headers, Location: `/${deck}`, "Set-Cookie": await makeCookie(env.COOKIE_SECRET, deck) } });
  }
  return (await validCookie(req, env.COOKIE_SECRET, deck)) ? page("private, no-store") : form();
}

export default { fetch: handle };
