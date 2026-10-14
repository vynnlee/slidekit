// 127.0.0.1 바인딩만으로는 브라우저의 다른 사이트(CSRF, DNS rebinding)를 막지 못한다.
// Host는 로컬 이름만, Origin은 있으면 Host와 같아야 하고, 변경 요청은 JSON이어야 한다.
const localHosts = new Set(["127.0.0.1", "localhost"]);

export function guardHost(req: Request): Response | null {
  const host = req.headers.get("host") ?? "";
  return localHosts.has(host.replace(/:\d+$/, "")) ? null : new Response("host", { status: 403 });
}

export function guardReq(req: Request): Response | null {
  const denied = guardHost(req);
  if (denied) return denied;
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  // Origin: null이나 깨진 값은 파싱 예외 대신 403이다. 다른 사이트에서 온 요청(Sec-Fetch-Site: cross-site)도 거절한다.
  let originHost = "";
  if (origin) { try { originHost = new URL(origin).host; } catch { return new Response("origin", { status: 403 }); } }
  if (origin && originHost !== host) return new Response("origin", { status: 403 });
  if (req.headers.get("sec-fetch-site") === "cross-site") return new Response("origin", { status: 403 });
  if (req.method !== "GET" && !req.headers.get("content-type")?.startsWith("application/json")) return new Response("type", { status: 415 });
  return null;
}

type H = (req: any, ...a: any[]) => Response | Promise<Response>;
const wrap = (h: H): H => (req, ...a) => guardReq(req) ?? h(req, ...a);

// /api/ 아래 라우트(함수 또는 메서드 맵)를 모두 감싼다.
export function guardRoutes<T extends Record<string, unknown>>(routes: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(routes)) {
    out[k] = !k.startsWith("/api/") ? v
      : typeof v === "function" ? wrap(v as H)
      : Object.fromEntries(Object.entries(v as object).map(([m, h]) => [m, wrap(h as H)]));
  }
  return out as T;
}
