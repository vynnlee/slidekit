import { useEffect, useState } from "react";
import { setDown, useServerDown } from "@/lib/connection";

// 서버 응답이 끊기면 작은 표시를 띄우고, 백오프(2초에서 30초)로 다시 확인한다. 복구되면 잠깐 Reconnected를 보인다.
// live region은 늘 렌더해 두어 스크린리더가 문구 변화를 읽는다.
export function ConnectionStatus() {
  const down = useServerDown();
  const [back, setBack] = useState(false);

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
    const offline = () => { setDown(true); wake(); };
    const visible = () => { if (document.visibilityState === "visible") wake(); };
    t = setTimeout(ping, 5000);
    window.addEventListener("online", wake);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false; clearTimeout(t);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  // 복구 직후 2초 동안 Reconnected 표시
  useEffect(() => {
    const on = () => { setBack(true); setTimeout(() => setBack(false), 2000); };
    window.addEventListener("slidekit:reconnected", on);
    return () => window.removeEventListener("slidekit:reconnected", on);
  }, []);

  const text = down ? "Server unreachable. Retrying..." : back ? "Reconnected" : "";
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-11 z-50 -translate-x-1/2">
      {text && <div className="rounded-md bg-surface-3 px-2 py-0.5 text-caption text-muted-foreground shadow-surface-3">{text}</div>}
    </div>
  );
}
