// 리모컨 SSE 연결. 세션 토큰이 URL(로그, Referer, 브라우저 기록)에 남지 않도록 연결마다 1회용 티켓을 받아 그것만 URL에 싣는다.
// 티켓은 한 번만 쓰이므로 EventSource의 자동 재연결 대신 끊길 때마다 새 티켓을 받아 직접 다시 붙는다(1초에서 5초까지 늘려 가며).
export type RemoteStream = { close(): void };

export function openRemoteStream(o: {
  api: string; // /api/remote/<덱>
  role: "host" | "viewer";
  /** 티켓을 받을 때 보낼 자격 헤더(발표자는 X-Remote-Key, 휴대폰은 Authorization). 호출 때마다 최신 값을 읽는다. */
  headers: () => Record<string, string>;
  on: Record<string, (data: any) => void>;
  onOpen?(): void;
  /** 연결이 끊겨 다시 붙는 중 */
  onLost?(): void;
  /** 자격이 거절됐거나 서버가 세션을 끝냈다: 다시 붙지 않는다 */
  onDead(): void;
}): RemoteStream {
  let closed = false, wait = 1000, timer: ReturnType<typeof setTimeout> | undefined, es: EventSource | null = null;
  const stop = () => { closed = true; clearTimeout(timer); es?.close(); es = null; };
  const retry = () => { if (closed) return; timer = setTimeout(connect, wait); wait = Math.min(wait * 2, 5000); };
  async function connect() {
    if (closed) return;
    const r = await fetch(`${o.api}/ticket`, { method: "POST", headers: { "Content-Type": "application/json", ...o.headers() }, body: JSON.stringify({ role: o.role }) }).catch(() => null);
    if (closed) return;
    if (!r) return retry(); // 네트워크 문제는 다시 시도
    if (r.status === 403 || r.status === 404) { stop(); return o.onDead(); }
    if (!r.ok) return retry();
    const { ticket } = (await r.json().catch(() => ({}))) as { ticket?: string };
    if (closed) return;
    if (!ticket) return retry();
    const src = new EventSource(`${o.api}/events?ticket=${encodeURIComponent(ticket)}`);
    es = src;
    src.onopen = () => { wait = 1000; o.onOpen?.(); };
    src.onerror = () => { src.close(); if (es === src) es = null; if (closed) return; o.onLost?.(); retry(); };
    for (const [name, fn] of Object.entries(o.on)) src.addEventListener(name, (e) => { try { fn(JSON.parse((e as MessageEvent).data)); } catch {} });
    src.addEventListener("end", () => { stop(); o.onDead(); });
  }
  void connect();
  return { close: stop };
}
