#!/usr/bin/env bun
// tailnet 미리보기용 프록시. Bun 개발 서버는 Host와 Origin이 다르면 403이므로 둘을 다시 쓴다.
// 사용: UP=3220 PORT=3221 bun app/preview-proxy.ts (127.0.0.1에만 바인딩)
const up = Number(process.env.UP ?? 3220);
const port = Number(process.env.PORT ?? 3221);
const allowedHosts = new Set(["127.0.0.1", "localhost", "mac-cloud.tail5a652b.ts.net"]);
const local = `127.0.0.1:${up}`;

type Data = { url: string; upstream?: WebSocket; queue: (string | Buffer)[] };

Bun.serve<Data>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, server) {
    const u = new URL(req.url);
    // Origin을 지우기 전에 확인한다. 다른 사이트가 이 프록시를 통해 앱 API를 부르지 못하게 한다.
    const host = req.headers.get("host") ?? "", origin = req.headers.get("origin");
    let originHost = "";
    if (origin) { try { originHost = new URL(origin).host; } catch { return new Response("forbidden", { status: 403 }); } } // Origin: null 같은 깨진 값은 403
    if (!allowedHosts.has(host.replace(/:\d+$/, "")) || (origin && originHost !== host)) return new Response("forbidden", { status: 403 });
    if (req.headers.get("upgrade") === "websocket") {
      return server.upgrade(req, { data: { url: `ws://${local}${u.pathname}${u.search}`, queue: [] } })
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    const headers = new Headers(req.headers);
    headers.set("host", local);
    headers.delete("origin");
    return fetch(`http://${local}${u.pathname}${u.search}`, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
    });
  },
  websocket: {
    open(ws) {
      const up = new WebSocket(ws.data.url, { headers: { origin: `http://${local}` } } as never);
      ws.data.upstream = up;
      up.onopen = () => ws.data.queue.splice(0).forEach((m) => up.send(m as string));
      up.onmessage = (e) => ws.send(e.data as string);
      up.onclose = () => ws.close();
    },
    message(ws, m) {
      const up = ws.data.upstream!;
      up.readyState === WebSocket.OPEN ? up.send(m as string) : ws.data.queue.push(m);
    },
    close(ws) {
      ws.data.upstream?.close();
    },
  },
});
console.log(`preview-proxy http://127.0.0.1:${port} -> ${local}`);
