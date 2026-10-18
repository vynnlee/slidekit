import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "@/lib/deck";
import { toast, TOAST } from "@/Toaster";

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
    // 재접속하면 그 사이 놓친 이벤트(서버 재시작 등)를 목록을 다시 받아 맞춘다(첫 연결은 위의 로드가 한다)
    let opened = false;
    es.onopen = () => {
      if (!opened) { opened = true; return; }
      fetch(`/api/comments?deck=${encodeURIComponent(folder)}`).then((r) => (r.ok ? r.json() : null)).then((l: Comment[] | null) => { if (l && alive.current) setComments(l); }).catch(() => {});
    };
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

  /** 보류했거나 전달되지 않은 코멘트를 묶음 알림으로 보낸다. 서버가 보류를 풀고 갱신 이벤트를 보낸다. */
  const sendAll = useCallback(async () => {
    try {
      const r = await fetch("/api/comments/send-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: folder }) });
      if (!r.ok) throw new Error(String(r.status));
      const { count, remaining = 0, sent = count, waiting = 0, reason = null, resetAt } = (await r.json()) as { count: number; remaining?: number; sent?: number; waiting?: number; reason?: "paused" | "disconnected" | "limit" | null; resetAt?: string };
      const n = (k: number) => `${k} ${k === 1 ? "comment" : "comments"}`;
      const at = resetAt ? new Date(resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
      // 실제로 간 것과 못 간 것(이유)을 그대로 말한다
      const why = reason === "paused" ? "Claude is paused, they send when you resume" : reason === "disconnected" ? "Claude is not connected, they send when a session connects" : reason === "limit" ? `waiting for the hourly limit${at ? `, resumes ${at}` : ""}` : "";
      toast(!count ? "Nothing to send" : sent === 0 ? `Saved ${n(waiting)}. ${why}` : waiting ? `Sent ${n(sent)} to Claude. ${n(waiting)} ${why}` : `Sent ${n(sent)} to Claude${remaining ? `, ${remaining} more waiting, press Send all again` : ""}`, { ms: remaining || waiting ? TOAST.long : TOAST.info });
    } catch { setError("Could not send the comments"); }
  }, [folder]);


  /** 한 코멘트를 보낸다(Send), 멈춘 요청을 다시 보낸다(Resend), 요청을 취소한다(Cancel). 결과는 이유와 함께 토스트로 말한다. */
  const act = useCallback(async (c: Comment, what: "send" | "resend" | "cancel") => {
    try {
      const r = await fetch(`/api/comments/${c.id}/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: folder }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { sent?: boolean; reason?: "paused" | "disconnected" | "limit" | null; resetAt?: string };
      if (what === "cancel") toast("Cancelled. Claude may still finish what it started.", { ms: TOAST.long });
      else if (d.sent) toast(what === "resend" ? "Sent to Claude again" : "Sent to Claude", { ms: TOAST.info });
      else toast(d.reason === "paused" ? "Saved. Claude is paused, it sends when you resume." : d.reason === "limit" ? `Saved. Waiting for the hourly limit${d.resetAt ? `, resumes ${new Date(d.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}.` : d.reason === "disconnected" ? "Saved. Claude is not connected, it sends when a session connects." : "Already sent", { ms: TOAST.long });
    } catch { setError(what === "cancel" ? "Could not cancel the request" : "Could not send the comment"); }
  }, [folder]);
  const send = useCallback((c: Comment) => act(c, "send"), [act]);
  const resend = useCallback((c: Comment) => act(c, "resend"), [act]);
  const cancel = useCallback((c: Comment) => act(c, "cancel"), [act]);

  /** 답이 달린 코멘트를 모두 해결 처리한다. */
  const resolveReplied = useCallback(async () => {
    const todo = comments.filter((c) => c.status === "done" && !c.resolved);
    for (const c of todo) await resolve(c, true);
    if (todo.length) toast(`Resolved ${todo.length} ${todo.length === 1 ? "comment" : "comments"}`, { ms: TOAST.info });
  }, [comments, resolve]);

  /** 검증 안 된 코멘트를 믿기로 한다(서버가 이 기기의 키로 다시 서명하고 갱신 이벤트를 보낸다). */
  const trust = useCallback(async (c: Comment) => {
    try {
      const r = await fetch(`/api/comments/${c.id}/trust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: folder }) });
      if (!r.ok) throw new Error(String(r.status));
    } catch { setError("Could not trust the comment"); }
  }, [folder]);

  /** 삭제하고 Undo 토스트를 띄운다. Undo는 서버가 보관한 코멘트를 되살린다. */
  const remove = useCallback(async (c: Comment) => {
    const post = (path: string) => fetch(`/api/comments/${c.id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: folder }) });
    try {
      const r = await post("delete");
      if (!r.ok) throw new Error(String(r.status));
    } catch { setError("Could not delete the comment"); return; }
    setComments((l) => l.filter((x) => x.id !== c.id));
    toast("Comment deleted", { action: { label: "Undo", onClick: () => { post("restore").catch(() => setError("Could not restore the comment")); } } });
  }, [folder]);

  /** Claude의 수정을 되돌리고(undo=true면 취소) 토스트로 알린다. 덱이 그 뒤로 바뀌었으면 서버가 409(changed)로 거절한다. */
  const revert = useCallback(async (c: Comment, undo = false) => {
    try {
      const r = await fetch(`/api/comments/${c.id}/revert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck: folder, undo }) });
      if (r.status === 409 && !undo && ((await r.json().catch(() => ({}))) as { error?: string }).error === "changed") {
        toast("The deck changed after Claude's edit, so it was not reverted", { ms: TOAST.error, action: { label: "Version history", onClick: () => window.dispatchEvent(new Event("slidekit:open-versions")) } });
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
    } catch { setError("Could not revert the edit"); return; }
    toast(undo ? "Revert undone" : "Reverted Claude's edit", undo ? { ms: TOAST.info } : { action: { label: "Undo", onClick: () => { void revert(c, true); } } });
  }, [folder]);

  return { comments, setComments, channel, error, upsert, resolve, trust, remove, revert, sendAll, send, resend, cancel, resolveReplied };
}
