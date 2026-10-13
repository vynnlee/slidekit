// 127.0.0.1 바인딩만으로는 브라우저의 다른 사이트(CSRF, DNS rebinding)를 막지 못한다.
// Host는 로컬 이름만, Origin은 있으면 Host와 같아야 하고, 변경 요청은 JSON이어야 한다.
const localHosts = new Set(["127.0.0.1", "localhost"]);

export function guardReq(req: Request): Response | null {
  const host = req.headers.get("host") ?? "";
  if (!localHosts.has(host.replace(/:\d+$/, ""))) return new Response("host", { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== host) return new Response("origin", { status: 403 });
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
