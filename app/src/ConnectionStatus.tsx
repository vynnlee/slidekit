import { useEffect, useState } from "react";

// 서버 응답이 끊기면 작은 표시를 띄우고, 백오프(2초에서 30초)로 다시 확인한다. 연결되면 사라진다.
export function ConnectionStatus() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>, fails = 0, alive = true;
    const ping = async () => {
      let ok = false;
      try { ok = (await fetch("/api/ping", { cache: "no-store" })).ok; } catch {}
      if (!alive) return;
      fails = ok ? 0 : fails + 1;
      setDown(!ok);
      t = setTimeout(ping, ok ? 5000 : Math.min(1000 * 2 ** fails, 30000));
    };
    const wake = () => { clearTimeout(t); ping(); };
    t = setTimeout(ping, 5000);
    window.addEventListener("online", wake);
    return () => { alive = false; clearTimeout(t); window.removeEventListener("online", wake); };
  }, []);
  if (!down) return null;
  return (
    <div role="status" className="fixed left-1/2 top-1 z-50 -translate-x-1/2 rounded-md bg-hover px-2 py-0.5 text-caption text-muted-foreground shadow-surface-3">
      Disconnected. Reconnecting...
    </div>
  );
}
