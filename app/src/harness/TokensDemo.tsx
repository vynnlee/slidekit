// /dev/tokens?deck=<폴더>: TokensPanel을 편집기 없이 검증하는 개발용 페이지. 저장은 편집기와 같은 PUT 흐름.
import { splitDeck } from "@/lib/deck-source";
import { useEffect, useRef, useState } from "react";
import { TokensPanel } from "@/TokensPanel";
import { Button } from "@/components/ui/button";

export function TokensDemo() {
  const folder = new URLSearchParams(location.search).get("deck") ?? "";
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const mtime = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);

  useEffect(() => {
    fetch(`/api/decks/${folder}/source`).then((r) => r.json()).then((r) => { setSrc(r.source); mtime.current = r.mtime; });
  }, [folder]);

  const save = async () => {
    const res = await fetch(`/api/decks/${folder}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: src, base: mtime.current }) });
    const j = await res.json();
    if (res.ok) mtime.current = j.mtime;
    setStatus(res.ok ? "Saved" : `Error ${res.status}`);
  };
  if (src === null) return null;
  // 슬라이드 단위 쪼개기는 편집기의 일이라, 데모는 head 구간만 바꾸고 나머지는 그대로 둔다.
  const cut = splitDeck(src).prefix.length; // 주석이나 style 안의 "<section" 글자는 토크나이저가 건너뛴다
  const prefix = src.slice(0, cut);
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="w-[280px] overflow-auto border-r border-border/60" data-testid="panel">
        <TokensPanel prefix={prefix} canvas={doc} onPrefixChange={(next) => { setSrc(next + src.slice(cut)); setStatus("Unsaved"); }} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        <div className="flex items-center gap-2"><Button variant="primary" size="compact" onClick={save}>Save</Button><span data-testid="status">{status}</span></div>
        <iframe ref={frame} title="Preview" className="min-h-0 flex-1 border-0" src={`/decks/${folder}/index.html#2`}
          onLoad={() => setDoc(frame.current?.contentDocument ?? null)} />
      </div>
    </div>
  );
}
