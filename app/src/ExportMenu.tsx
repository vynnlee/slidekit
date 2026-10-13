"use client";

import { useRef, useState } from "react";
import { Check, Copy, Download, FileText, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface ExportMenuProps {
  /** 덱 폴더 이름(= /edit/<id>가 아니라 decks/ 아래 폴더). 소문자, 숫자, - 만 쓰는 덱만 내보낼 수 있다. */
  folder: string;
  /** 저장 안 된 변경이 있는지. true면 내보내기 전에 `onSave`를 부른다. */
  dirty?: boolean;
  /** 저장한다. false를 돌려주면(실패, 충돌) 내보내지 않는다. */
  onSave?: () => Promise<boolean>;
}

type Mode = "idle" | "html" | "pdf" | "publish";
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
  const logEnd = useRef<HTMLDivElement>(null);
  const target = `${HOST}/${folder}`;

  const saved = async () => !dirty || !onSave || (await onSave());
  const close = () => { if (!busy) { setMode("idle"); setErr(""); } };

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
    setMode("publish"); setErr(""); setLog([]); setUrl(""); setPw(""); setPw2(""); setCopied(false);
    try {
      const list = await fetch("/api/decks").then((r) => r.json());
      setVisibility(list.find((d: { folder: string }) => d.folder === folder)?.visibility === "password" ? "password" : "public");
    } catch { /* 기본값 Public 표시. 서버가 실제 값으로 판단한다 */ }
  };

  const publish = async () => {
    setBusy(true); setErr(""); setLog([]);
    try {
      if (!(await saved())) return setErr("Save the deck first");
      const res = await post(`/api/decks/${folder}/deploy`, { confirm: true, ...(visibility === "password" ? { password: pw } : {}) });
      if (!res.ok || !res.body) return setErr(await errText(res));
      let buf = "";
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m: { log?: string; error?: string; done?: boolean; url?: string };
          try { m = JSON.parse(line); } catch { continue; }
          if (m.log) { setLog((l) => [...l, m.log!]); logEnd.current?.scrollIntoView?.({ block: "end" }); }
          if (m.error) setErr(m.error);
          if (m.done && m.url) setUrl(m.url);
        }
      }
    } catch { setErr("Connection lost. The deck may or may not be published"); } finally { setBusy(false); setPw(""); setPw2(""); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* 클립보드 거부: 링크를 직접 복사한다 */ } };
  const needPw = visibility === "password";
  const canPublish = !busy && !url && (!needPw || (pw.length > 0 && pw === pw2));

  return (
    <>
      <DropdownMenu size="compact">
        <DropdownTrigger render={<Button variant="ghost" size="compact" aria-label="Export"><Download />Export</Button>} />
        <DropdownContent align="end" side="bottom">
          <MenuItem index={0} icon={FileText} label="Download HTML" onSelect={() => download("html")} />
          <MenuItem index={1} icon={FileText} label="Download PDF" onSelect={() => download("pdf")} />
          <MenuItem index={2} icon={Globe} label="Publish to static.vynnlee.com..." onSelect={openPublish} />
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
                </div>
              )}
              {(log.length > 0 || busy) && (
                <div aria-live="polite" aria-label="Progress" className="max-h-40 overflow-auto rounded-md bg-hover p-2 font-mono text-caption text-muted-foreground">
                  {log.map((l, i) => <div key={i}>{l}</div>)}<div ref={logEnd} />
                </div>
              )}
              {err && <p role="alert" className="text-body">{err}</p>}
              {url && (
                <div className="flex items-center gap-2">
                  <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">{url}</a>
                  <Button size="compact" variant="secondary" onClick={copy} aria-label="Copy link">{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button size="compact" variant="ghost" disabled={busy} onClick={close}>{url ? "Close" : "Cancel"}</Button>
                {!url && <Button size="compact" variant="primary" disabled={!canPublish} onClick={publish}>{busy ? "Publishing..." : "Publish"}</Button>}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <DialogTitle>{mode === "pdf" ? "Download PDF" : "Download HTML"}</DialogTitle>
              {err ? <p role="alert" className="text-body">{err}</p> : <p className="text-body text-muted-foreground" aria-live="polite">Preparing the file...</p>}
              {err && <div className="flex justify-end"><Button size="compact" variant="ghost" onClick={close}>Close</Button></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export type { ExportMenuProps };
