import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "@/lib/deck";

// 한 덱의 코멘트와 Claude 채널 연결 상태를 서버(SSE)와 맞춰 둔다.
//  - comment(새 코멘트), reply(갱신: 답, 전달됨, 해결), comments(전체 교체), channel({connected})
// channel은 아직 모르면 null, 채널 MCP 서버가 연결돼 있으면 true.
export function useCommentsLive(folder: string | null) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [channel, setChannel] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const upsert = useCallback((c: Comment) => setComments((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c])), []);

  useEffect(() => {
    alive.current = true;
    if (!folder) return;
    setComments([]); setError("");
    fetch(`/api/comments?deck=${encodeURIComponent(folder)}`)
      .then((r) => { if (!r.ok) throw new Error(`Could not load comments (${r.status})`); return r.json(); })
      .then((l: Comment[]) => alive.current && setComments(l))
      .catch((e) => alive.current && setError(String(e.message ?? e)));
    const es = new EventSource("/api/events");
    const on = (type: string, fn: (d: any) => void) => es.addEventListener(type, (e) => {
      try { fn(JSON.parse((e as MessageEvent).data)); } catch { /* 깨진 이벤트는 무시 */ }
    });
    on("comment", (d) => d.deck === folder && upsert(d.comment));
    on("reply", (d) => d.deck === folder && upsert(d.comment));
    on("comments", (d) => d.deck === folder && setComments(d.comments));
    on("channel", (d) => setChannel(!!d.connected));
    return () => { alive.current = false; es.close(); };
  }, [folder, upsert]);

  /** 해결 표시와 되돌리기. 서버가 갱신 이벤트를 보내 주지만 바로 반영하도록 먼저 고친다. */
  const resolve = useCallback(async (c: Comment, resolved: boolean) => {
    const prev = c;
    upsert({ ...c, resolved: resolved || undefined, resolvedAt: resolved ? new Date().toISOString() : undefined });
    try {
      const r = await fetch(`/api/comments/${c.id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: folder, resolved }) });
      if (!r.ok) throw new Error(String(r.status));
    } catch { upsert(prev); setError("Could not update the comment"); }
  }, [folder, upsert]);

  return { comments, setComments, channel, error, upsert, resolve };
}
