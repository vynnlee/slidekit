#!/usr/bin/env bun
// tailnet 미리보기용 프록시. Bun 개발 서버는 Host와 Origin이 다르면 403이므로 둘을 다시 쓴다.
// 사용: UP=3220 PORT=3221 bun app/preview-proxy.ts (127.0.0.1에만 바인딩)
const up = Number(process.env.UP ?? 3220);
const port = Number(process.env.PORT ?? 3221);
const local = `127.0.0.1:${up}`;

type Data = { url: string; upstream?: WebSocket; queue: (string | Buffer)[] };

Bun.serve<Data>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, server) {
    const u = new URL(req.url);
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
      const up = new WebSocket(ws.data.url, { headers: { origin: `http://${local}` } });
      ws.data.upstream = up;
      up.onopen = () => ws.data.queue.splice(0).forEach((m) => up.send(m));
      up.onmessage = (e) => ws.send(e.data as string);
      up.onclose = () => ws.close();
    },
    message(ws, m) {
      const up = ws.data.upstream!;
      up.readyState === WebSocket.OPEN ? up.send(m) : ws.data.queue.push(m);
    },
    close(ws) {
      ws.data.upstream?.close();
    },
  },
});
console.log(`preview-proxy http://127.0.0.1:${port} -> ${local}`);
