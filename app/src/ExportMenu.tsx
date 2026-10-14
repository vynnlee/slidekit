"use client";

import { useRef, useState } from "react";
import { AlertCircle, Check, Circle, Copy, Download, ExternalLink, FileText, Globe, Link2, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ago } from "@/lib/comment-state";

interface ExportMenuProps {
  /** 덱 폴더 이름(= /edit/<id>가 아니라 decks/ 아래 폴더). 소문자, 숫자, - 만 쓰는 덱만 내보낼 수 있다. */
  folder: string;
  /** 저장 안 된 변경이 있는지. true면 내보내기 전에 `onSave`를 부른다. */
  dirty?: boolean;
  /** 저장한다. false를 돌려주면(실패, 충돌) 내보내지 않는다. */
  onSave?: () => Promise<boolean>;
}

type Mode = "idle" | "html" | "pdf" | "publish";
type Stage = "idle" | "saving" | "bundling" | "publishing" | "done";
const PUBLISHED_KEY = (folder: string) => `slidekit.published.${folder}`;
const STEPS: { id: Exclude<Stage, "idle" | "done">; label: string }[] = [
  { id: "saving", label: "Save the deck" },
  { id: "bundling", label: "Bundle into one file" },
  { id: "publishing", label: "Upload and publish" },
];
const ORDER: Stage[] = ["idle", "saving", "bundling", "publishing", "done"];
const readPublished = (folder: string): { url: string; at: string } | null => {
  try { return JSON.parse(localStorage.getItem(PUBLISHED_KEY(folder)) ?? "null"); } catch { return null; }
};
const HOST = "https://static.vynnlee.com";

async function post(path: string, body?: unknown) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
}
const errText = async (res: Response) => {
  const j = await res.json().catch(() => ({}));
  return res.status === 409 ? "Another export is already running" : (j.error as string) || `Request failed (${res.status})`;
};

export function ExportMenu({ folder, dirty, onSave }: ExportMenuProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "password">("public");
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState(""), [copied, setCopied] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [toast, setToast] = useState("");
  const [last, setLast] = useState(() => readPublished(folder));
  const logEnd = useRef<HTMLDivElement>(null);
  const target = `${HOST}/${folder}`;

  const saved = async () => !dirty || !onSave || (await onSave());
  const close = () => { if (!busy) { setMode("idle"); setErr(""); } };

  const say = (t: string) => { setToast(t); setTimeout(() => setToast(""), 2500); };

  const download = async (kind: "html" | "pdf") => {
    setMode(kind); setErr(""); setBusy(true);
    try {
      if (!(await saved())) return setErr("Save the deck first");
      const res = await post(`/api/decks/${folder}/${kind === "html" ? "bundle" : "pdf"}`);
      if (!res.ok) return setErr(await errText(res));
      const a = document.createElement("a");
      a.href = `/api/decks/${folder}/download?kind=${kind}`; a.download = `${folder}.${kind}`;
      document.body.appendChild(a); a.click(); a.remove();
      setMode("idle");
    } catch { setErr("Could not reach the server"); } finally { setBusy(false); }
  };

  const openPublish = async () => {
    setMode("publish"); setErr(""); setLog([]); setUrl(""); setPw(""); setPw2(""); setCopied(false); setStage("idle"); setLast(readPublished(folder));
    try {
      const list = await fetch("/api/decks").then((r) => r.json());
      setVisibility(list.find((d: { folder: string }) => d.folder === folder)?.visibility === "password" ? "password" : "public");
    } catch { /* 기본값 Public 표시. 서버가 실제 값으로 판단한다 */ }
  };

  const publish = async () => {
    setBusy(true); setErr(""); setLog([]); setStage("saving");
    try {
      if (!(await saved())) { setStage("idle"); return setErr("Save the deck first"); }
      const res = await post(`/api/decks/${folder}/deploy`, { confirm: true, ...(visibility === "password" ? { password: pw } : {}) });
      if (!res.ok || !res.body) { setStage("idle"); return setErr(await errText(res)); }
      setStage("bundling");
      let buf = "";
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m: { log?: string; error?: string; done?: boolean; url?: string };
          try { m = JSON.parse(line); } catch { continue; }
          if (m.log) { setLog((l) => [...l, m.log!]); logEnd.current?.scrollIntoView?.({ block: "end" }); if (m.log === "Publishing...") setStage("publishing"); }
          if (m.error) setErr(m.error);
          if (m.done && m.url) {
            setUrl(m.url); setStage("done"); setPw(""); setPw2(""); // 성공하면 비밀번호를 메모리에서 지운다
            const rec = { url: m.url, at: new Date().toISOString() };
            try { localStorage.setItem(PUBLISHED_KEY(folder), JSON.stringify(rec)); } catch { /* 저장소 거부: 기록만 건너뛴다 */ }
            setLast(rec);
          }
        }
      }
    } catch { setErr("Connection lost. The deck may or may not be published. Retrying publishes again."); } finally { setBusy(false); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* 클립보드 거부: 링크를 직접 복사한다 */ } };
  const copyLast = async () => { try { await navigator.clipboard.writeText(last!.url); say("Link copied"); } catch { say("Could not copy. Open Publish to see the link"); } };
  const needPw = visibility === "password";
  const canPublish = !busy && !url && (!needPw || (pw.length >= 8 && pw === pw2));

  return (
    <>
      <DropdownMenu size="compact">
        <DropdownTrigger render={<Button variant="secondary" size="compact" aria-label="Export" leadingIcon={Download}>Export</Button>} />
        <DropdownContent align="end" side="bottom">
          <MenuItem index={0} icon={FileText} label="Download HTML" onSelect={() => download("html")} />
          <MenuItem index={1} icon={FileText} label="Download PDF" onSelect={() => download("pdf")} />
          <MenuItem index={2} icon={Globe} label="Publish to static.vynnlee.com..." onSelect={openPublish} />
          {last && <MenuItem index={3} icon={Link2} label="Copy published link" onSelect={copyLast} />}
        </DropdownContent>
      </DropdownMenu>
      <Dialog open={mode !== "idle"} onOpenChange={(o) => !o && close()}>
        <DialogContent size="sm">
          {mode === "publish" ? (
            <div className="flex flex-col gap-3">
              <DialogTitle>Publish deck</DialogTitle>
              <div className="flex flex-col gap-1 text-body">
                <span className="text-muted-foreground">Address</span>
                <span className="break-all">{target}</span>
                <span className="pt-1 text-muted-foreground">Visibility</span>
                <span>{needPw ? "Password" : "Public"}</span>
              </div>
              <p className="text-caption text-muted-foreground" role="note">
                {needPw ? "This uploads the deck to the internet. Viewers must enter the password you set below." : "This uploads the deck to the internet. Anyone with the link can view it."}
              </p>
              {needPw && (
                <div className="flex flex-col gap-2">
                  <Field type="password" aria-label="Deck password" placeholder="Password" autoComplete="new-password" value={pw} disabled={busy || !!url} onChange={(e) => setPw(e.target.value)} />
                  <Field type="password" aria-label="Confirm password" placeholder="Confirm password" autoComplete="new-password" value={pw2} disabled={busy || !!url} onChange={(e) => setPw2(e.target.value)} />
                  {pw2 && pw !== pw2 && <span className="text-caption text-muted-foreground">Passwords do not match</span>}
                  {pw.length > 0 && pw.length < 8 && <span className="text-caption text-muted-foreground">Use at least 8 characters</span>}
                </div>
              )}
              {last && !url && !busy && stage === "idle" && (
                <p className="text-caption text-muted-foreground">Last published {ago(last.at)}: <a href={last.url} target="_blank" rel="noreferrer" className="underline">{last.url.replace("https://", "")}</a></p>
              )}
              {stage !== "idle" && (
                <ol aria-label="Steps" className="flex flex-col gap-1.5 text-body" data-testid="publish-steps">
                  {STEPS.map((st) => {
                    const at = ORDER.indexOf(stage), me = ORDER.indexOf(st.id);
                    const failed = !!err && !busy && at === me;
                    const state = failed ? "failed" : at > me ? "done" : at === me ? "running" : "pending";
                    return (
                      <li key={st.id} data-step={st.id} data-state={state} className={state === "pending" ? "flex items-center gap-2 text-muted-foreground" : "flex items-center gap-2"}>
                        {state === "done" ? <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                          : state === "running" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          : state === "failed" ? <AlertCircle className="h-4 w-4" aria-hidden="true" />
                          : <Circle className="h-4 w-4" aria-hidden="true" />}
                        <span>{st.label}</span>
                        <span className="sr-only">{state}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {(log.length > 0 || busy) && (
                <details open={!url} className="rounded-md bg-hover">
                  <summary className="cursor-default select-none px-2 py-1 text-caption text-muted-foreground">Details</summary>
                  <div aria-live="polite" aria-label="Progress" className="max-h-40 overflow-auto px-2 pb-2 font-mono text-caption text-muted-foreground">
                    {log.map((l, i) => <div key={i}>{l}</div>)}<div ref={logEnd} />
                  </div>
                </details>
              )}
              {err && <p role="alert" className="text-body">{err}</p>}
              {url && (
                <div className="flex flex-col gap-2" data-testid="publish-done">
                  <p className="text-body">Published{needPw ? ". Viewers need the password you set." : ". Anyone with the link can view it."}</p>
                  <a href={url} target="_blank" rel="noreferrer" className="break-all underline">{url}</a>
                  <div className="flex items-center gap-2">
                    <Button size="compact" variant="secondary" onClick={copy} aria-label="Copy link" leadingIcon={copied ? Check : Copy}>{copied ? "Copied" : "Copy link"}</Button>
                    <a href={url} target="_blank" rel="noreferrer" aria-label="Open in new tab" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-body hover:bg-hover"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open</a>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button size="compact" variant="ghost" disabled={busy} onClick={close}>{url ? "Close" : "Cancel"}</Button>
                {!url && <Button size="compact" variant="primary" disabled={!canPublish} onClick={publish} leadingIcon={err && !busy ? RotateCcw : undefined}>{busy ? "Publishing..." : err ? "Retry" : "Publish"}</Button>}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <DialogTitle>{mode === "pdf" ? "Download PDF" : "Download HTML"}</DialogTitle>
              {err ? <p role="alert" className="text-body">{err}</p> : (
                <p className="flex items-center gap-2 text-body text-muted-foreground" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Preparing {folder}.{mode === "pdf" ? "pdf" : "html"}...</p>
              )}
              {err && (
                <div className="flex justify-end gap-2">
                  <Button size="compact" variant="ghost" onClick={close}>Close</Button>
                  <Button size="compact" variant="primary" leadingIcon={RotateCcw} onClick={() => download(mode === "pdf" ? "pdf" : "html")}>Retry</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {toast && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-surface-3 px-3 py-1.5 text-body shadow-surface-3">{toast}</div>}
    </>
  );
}
export type { ExportMenuProps };
