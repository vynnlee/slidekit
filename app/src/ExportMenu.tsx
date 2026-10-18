"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Circle, Copy, Download, ExternalLink, FileText, Globe, History, Link2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ago } from "@/lib/comment-state";
import { VersionHistory } from "@/VersionHistory";
import { toast, TOAST } from "@/Toaster";
import { agentPrompt } from "@/lib/agent-prompt";

interface ExportMenuProps {
  /** 덱 폴더 이름(= /edit/<id>가 아니라 decks/ 아래 폴더). 소문자, 숫자, - 만 쓰는 덱만 내보낼 수 있다. */
  folder: string;
  /** 저장 안 된 변경이 있는지. true면 내보내기 전에 `onSave`를 부른다. */
  dirty?: boolean;
  /** 저장한다. false를 돌려주면(실패, 충돌) 내보내지 않는다. */
  onSave?: () => Promise<boolean>;
}

type Mode = "idle" | "html" | "pdf" | "publish";
// 서버의 게시 기록(.publish.json)과 현재 덱 지문 비교 결과
type PubEntry = { url: string; at: string; visibility: "public" | "password"; bytes: number; unpublishedAt?: string };
type Published = { published: false } | { published: true; name: string; url: string; at: string; visibility: "public" | "password"; bytes: number; changed: boolean; history: PubEntry[] };
type Stage = "idle" | "saving" | "bundling" | "publishing" | "done";
type Check = { errors: number; warnings: number; issues: { level: string; rule: string; msg: string }[]; largeImages: { file: string; bytes: number }[]; visibility: "public" | "password" | "unknown"; estimatedBytes: number; lastBundleBytes: number | null; notesMissing?: number; slides?: number; lowContrast?: { name: string; ratio: number; need: number }[] };
const fmt = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
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
// 서버가 사람이 읽는 문장(error)과 엔진 출력(details)을 따로 준다.
const readErr = async (res: Response) => {
  const j = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
  return { msg: j.error || `Request failed (${res.status})`, details: j.details ?? "" };
};
const MIN_PW = 8;
// PDF 종류: 슬라이드(기본), 쪽마다 슬라이드 한 장과 노트, 한 쪽에 여러 장(유인물). 파일 이름과 다운로드 kind는 서버 규칙(export-api)을 따른다.
type PdfMode = "slides" | "notes" | "handout";
const PDF_FILE: Record<PdfMode, string> = { slides: "pdf", notes: "notes.pdf", handout: "handout.pdf" };
const PDF_KIND: Record<PdfMode, string> = { slides: "pdf", notes: "notes-pdf", handout: "handout-pdf" };

function CheckRow({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  // 색만으로 구분하지 않도록 아이콘 모양을 다르게 한다(통과 체크, 주의 느낌표).
  return (
    <li className="flex items-start gap-2">
      {ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" /> : <AlertCircle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${warn ? "text-muted-foreground" : "text-foreground"}`} aria-hidden="true" />}
      <span>{children}</span>
    </li>
  );
}

export function ExportMenu({ folder, dirty, onSave }: ExportMenuProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "password">("public");
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState(""), [copied, setCopied] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [details, setDetails] = useState("");
  const [anyway, setAnyway] = useState(false); // lint 오류가 있어도 게시하겠다는 확인
  const token = useRef(0); // 대화상자를 닫으면 올려서, 닫은 뒤 늦게 오는 결과를 무시한다
  const [check, setCheck] = useState<Check | null | "error">(null);
  const [versions, setVersions] = useState(false);
  const [pdfDialog, setPdfDialog] = useState(false);
  const [pub, setPub] = useState<Published | null>(null);
  const [pubOpen, setPubOpen] = useState(false), [unpubOpen, setUnpubOpen] = useState(false);
  const [unpubBusy, setUnpubBusy] = useState(false), [typedName, setTypedName] = useState(""), [unpubErr, setUnpubErr] = useState(""), [unpubDetails, setUnpubDetails] = useState("");
  const loadPub = () => fetch(`/api/decks/${folder}/published`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j: Published) => setPub(j), () => setPub(null));
  useEffect(() => { void loadPub(); }, [folder]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pdfMode, setPdfMode] = useState<PdfMode>("notes");
  const [per, setPer] = useState(3);
  const [fileLabel, setFileLabel] = useState("");
  const lastPdf = useRef<{ mode: PdfMode; per: number } | undefined>(undefined); // 다시 시도할 때 같은 옵션을 쓴다
  // 코멘트의 되돌리기가 거절되었을 때 토스트의 "Version history" 버튼이 이 대화상자를 연다.
  useEffect(() => { const on = () => setVersions(true); window.addEventListener("slidekit:open-versions", on); return () => window.removeEventListener("slidekit:open-versions", on); }, []);
  const [last, setLast] = useState(() => readPublished(folder));
  const logEnd = useRef<HTMLDivElement>(null);
  const target = `${HOST}/${folder}`;

  const saved = async () => !dirty || !onSave || (await onSave());
  // 작업 중에 닫으면(Esc, Cancel) 서버의 번들, PDF, 게시 프로세스도 멈춘다.
  const close = () => {
    if (busy) { void post("/api/export/cancel").catch(() => {}); setBusy(false); }
    token.current++; setMode("idle"); setErr(""); setDetails("");
  };
  const say = (t: string, ms: number = TOAST.info) => toast(t, { ms });
  const fail = async (res: Response) => { const e = await readErr(res); setErr(e.msg); setDetails(e.details); };

  const download = async (kind: "html" | "pdf", pdf?: { mode: PdfMode; per: number }) => {
    const pm = pdf?.mode ?? "slides";
    lastPdf.current = pdf;
    setMode(kind); setErr(""); setDetails(""); setBusy(true); setFileLabel(`${folder}.${kind === "html" ? "html" : PDF_FILE[pm]}`);
    const my = ++token.current;
    try {
      if (!(await saved())) return setErr("Save the deck first");
      const res = await post(`/api/decks/${folder}/${kind === "html" ? "bundle" : "pdf"}`, pdf ? { mode: pdf.mode, per: pdf.per } : undefined);
      if (my !== token.current) return; // 닫혔다
      if (!res.ok) return fail(res);
      const info = (await res.json().catch(() => ({}))) as { bytes?: number; pages?: number };
      if (info.bytes) say(`${folder}.${kind === "html" ? "html" : PDF_FILE[pm]} ready: ${fmt(info.bytes)}${info.pages ? `, ${info.pages} pages` : ""}`);
      const a = document.createElement("a");
      a.href = `/api/decks/${folder}/download?kind=${kind === "html" ? "html" : PDF_KIND[pm]}`; a.download = `${folder}.${kind === "html" ? "html" : PDF_FILE[pm]}`;
      document.body.appendChild(a); a.click(); a.remove();
      setMode("idle");
    } catch { if (my === token.current) setErr("Could not reach the server. Check that slidekit is still running."); } finally { if (my === token.current) setBusy(false); }
  };

  const openPublish = async () => {
    setMode("publish"); setErr(""); setLog([]); setUrl(""); setPw(""); setPw2(""); setCopied(false); setStage("idle"); setLast(readPublished(folder)); setCheck(null); setDetails(""); setAnyway(false);
    fetch(`/api/decks/${folder}/check`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setCheck, () => setCheck("error")); // 배포 전 점검(읽기만)
    try {
      const list = await fetch("/api/decks").then((r) => r.json());
      setVisibility(list.find((d: { folder: string }) => d.folder === folder)?.visibility === "password" ? "password" : "public");
    } catch { /* 기본값 Public 표시. 서버가 실제 값으로 판단한다 */ }
  };

  const publish = async () => {
    setBusy(true); setErr(""); setDetails(""); setLog([]); setStage("saving");
    const my = ++token.current;
    try {
      if (!(await saved())) { setStage("idle"); return setErr("Save the deck first"); }
      const res = await post(`/api/decks/${folder}/deploy`, { confirm: true, ...(visibility === "password" ? { password: pw } : {}) });
      if (my !== token.current) return;
      if (!res.ok || !res.body) { setStage("idle"); return fail(res); }
      setStage("bundling");
      let buf = "";
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m: { log?: string; error?: string; details?: string; done?: boolean; url?: string };
          try { m = JSON.parse(line); } catch { continue; }
          if (m.log) { setLog((l) => [...l, m.log!]); logEnd.current?.scrollIntoView?.({ block: "end" }); if (m.log === "Publishing...") setStage("publishing"); }
          if (m.error) { setErr(m.error); if (m.details) setDetails(m.details); }
          if (m.done && m.url) {
            setUrl(m.url); setStage("done"); setPw(""); setPw2(""); // 성공하면 비밀번호를 메모리에서 지운다
            const rec = { url: m.url, at: new Date().toISOString() };
            try { localStorage.setItem(PUBLISHED_KEY(folder), JSON.stringify(rec)); } catch { /* 저장소 거부: 기록만 건너뛴다 */ }
            setLast(rec);
            void loadPub(); // 서버 기록(.publish.json)을 다시 읽는다
          }
        }
      }
    } catch { if (my === token.current) setErr("Connection lost. The deck may or may not be published. Retrying publishes again."); } finally { if (my === token.current) setBusy(false); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { say("Could not copy. Select the link and copy it by hand."); } };
  // 게시 취소: 서버가 CLI를 돌리고 NDJSON으로 진행을 알린다. 실제 삭제는 사용자가 이 확인 대화상자에서 Unpublish를 눌렀을 때만 일어난다.
  const unpublish = async () => {
    setUnpubBusy(true); setUnpubErr(""); setUnpubDetails("");
    try {
      const res = await post(`/api/decks/${folder}/unpublish`, { confirm: true, confirmName: typedName });
      if (!res.ok || !res.body) { const e = await readErr(res); setUnpubErr(e.msg); setUnpubDetails(e.details); return; }
      let buf = "", done: { dryRun?: boolean } | null = null, failed = false;
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m: { error?: string; details?: string; done?: boolean; dryRun?: boolean };
          try { m = JSON.parse(line); } catch { continue; }
          if (m.error) { failed = true; setUnpubErr(m.error); setUnpubDetails(m.details ?? ""); }
          if (m.done) done = { dryRun: m.dryRun };
        }
      }
      if (done && !failed) {
        setUnpubOpen(false); setPubOpen(false);
        toast(done.dryRun ? "Dry run: nothing was removed" : "Unpublished, the link no longer works", { ms: TOAST.long });
        await loadPub();
      }
    } catch { setUnpubErr("Connection lost. The deck may or may not be unpublished. Check the link."); } finally { setUnpubBusy(false); }
  };
  // 덱 내용을 Markdown으로: 복사는 클립보드에, 내려받기는 .md 파일로(발표자 노트 포함)
  const copyMarkdown = async () => {
    try { const r = await fetch(`/api/decks/${folder}/outline`); if (!r.ok) throw new Error(); await navigator.clipboard.writeText(await r.text()); say("Copied as Markdown", TOAST.copy); }
    catch { say("Could not copy the deck as Markdown"); }
  };
  const downloadMarkdown = () => { const a = document.createElement("a"); a.href = `/api/decks/${folder}/outline?download=1`; a.download = `${folder}.md`; a.click(); say(`Downloading ${folder}.md`); };
  const linkOf = () => (pub && pub.published ? pub.url : last?.url ?? "");
  // 에이전트에게 붙여 넣을 문구: 공개 덱은 주소와 deck.md를 받는 curl, 비밀번호 덱은 주소만(spec/DECK-MD-DEPLOY.md).
  const copyPrompt = async (u: string, vis: "public" | "password") => {
    const t = agentPrompt(u, vis);
    if (!t) return say("No published link to copy");
    try { await navigator.clipboard.writeText(t); say("Agent prompt copied", TOAST.copy); } catch { say("Could not copy the prompt"); }
  };
  const copyLast = async () => { try { await navigator.clipboard.writeText(linkOf()); say("Link copied", TOAST.copy); } catch { say("Could not copy. Open Publish to see the link"); } };
  const needPw = visibility === "password";
  const canPublish = !busy && !url && (!needPw || (pw.length >= MIN_PW && pw === pw2)) && (check === null || check === "error" || check.errors === 0 || anyway);

  return (
    <>
      <DropdownMenu size="compact">
        <DropdownTrigger render={<Button variant="secondary" size="compact" aria-label="Export" leadingIcon={Download}>Export</Button>} />
        <DropdownContent align="end" side="bottom">
          <MenuItem index={0} icon={FileText} label="Download HTML" onSelect={() => download("html")} />
          <MenuItem index={1} icon={FileText} label="Download PDF" onSelect={() => download("pdf")} />
          <MenuItem index={2} icon={FileText} label="PDF options..." onSelect={() => setPdfDialog(true)} />
          <MenuItem index={3} icon={Copy} label="Copy as Markdown" onSelect={copyMarkdown} />
          <MenuItem index={4} icon={FileText} label="Download .md" onSelect={downloadMarkdown} />
          <MenuItem index={5} icon={Globe} label="Publish to static.vynnlee.com..." onSelect={openPublish} />
          {(pub?.published || last) && <MenuItem index={6} icon={Link2} label="Copy published link" onSelect={copyLast} />}
          {pub?.published && <MenuItem index={7} icon={Globe} label="Published..." onSelect={() => { void loadPub(); setPubOpen(true); }} />}
          <MenuItem index={pub?.published ? 8 : (pub?.published || last) ? 7 : 6} icon={History} label="Version history..." onSelect={() => setVersions(true)} />
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
                <span className="text-caption text-muted-foreground">To change it, set visibility to public or password in the deck&apos;s deck-meta.</span>
              </div>
              <p className="text-caption text-muted-foreground" role="note">
                {needPw ? "This uploads the deck to the internet. Viewers must enter the password you set below." : "This uploads the deck to the internet. Anyone with the link can view it."}
              </p>
              {needPw && (
                <div className="flex flex-col gap-2">
                  <Field type="password" aria-label="Deck password" placeholder="Password (8+ characters)" autoComplete="new-password" value={pw} disabled={busy || !!url} onChange={(e) => setPw(e.target.value)} />
                  <Field type="password" aria-label="Confirm password" placeholder="Confirm password" autoComplete="new-password" value={pw2} disabled={busy || !!url} onChange={(e) => setPw2(e.target.value)} />
                  <span className="text-caption text-muted-foreground">Use at least 8 characters. Viewers enter it once per device.</span>
                  {pw2 && pw !== pw2 && <span role="alert" className="text-caption">Passwords do not match</span>}
                </div>
              )}
              {stage === "idle" && !url && check && (
                <section aria-label="Pre-publish check" data-testid="precheck" className="flex flex-col gap-1.5 rounded-md bg-hover p-2 text-caption">
                  <span className="text-micro uppercase tracking-wide text-muted-foreground">Pre-publish check</span>
                  {check === "error" ? <span className="text-muted-foreground">Could not check the deck. Publishing still works.</span> : (
                    <ul className="flex flex-col gap-1">
                      <CheckRow ok={check.errors === 0 && check.warnings === 0} warn={check.errors === 0 && check.warnings > 0}>
                        {check.errors > 0 ? `${check.errors} lint ${check.errors === 1 ? "error" : "errors"}` : check.warnings > 0 ? `${check.warnings} lint ${check.warnings === 1 ? "warning" : "warnings"}` : "No lint problems"}
                        {check.issues.length > 0 && (
                          <ul className="mt-0.5 flex flex-col gap-0.5 text-muted-foreground" data-testid="lint-issues">
                            {check.issues.slice(0, 3).map((i, k) => <li key={k}>{i.msg}</li>)}
                            {check.errors + check.warnings > 3 && <li>and {check.errors + check.warnings - 3} more. Run lint on the deck to see all.</li>}
                          </ul>
                        )}
                      </CheckRow>
                      <CheckRow ok={!check.largeImages.length} warn>
                        {check.largeImages.length ? `${check.largeImages.length} large ${check.largeImages.length === 1 ? "image" : "images"} (${check.largeImages[0].file}, ${fmt(check.largeImages[0].bytes)}). Smaller images load faster.` : "No large images"}
                      </CheckRow>
                      <CheckRow ok={check.visibility !== "unknown"} warn={check.visibility === "unknown"}>
                        {check.visibility === "password" ? "Password protected: you will set the password below" : check.visibility === "public" ? "Public: anyone with the link can view it" : "Visibility could not be read from the deck"}
                      </CheckRow>
                      {!!check.notesMissing && <CheckRow ok={false} warn>{`No speaker notes on ${check.notesMissing} ${check.notesMissing === 1 ? "slide" : "slides"}`}</CheckRow>}
                      {check.lowContrast?.map((c) => <CheckRow key={c.name} ok={false} warn>{`Low contrast: ${c.name} ${c.ratio.toFixed(1)}:1 (needs ${c.need}:1)`}</CheckRow>)}
                      <CheckRow ok>{`About ${fmt(check.estimatedBytes)} before fonts${check.lastBundleBytes ? `. Last bundle ${fmt(check.lastBundleBytes)}` : ""}`}</CheckRow>
                    </ul>
                  )}
                  {check !== "error" && check.errors > 0 && (
                    <label className="mt-1 flex cursor-default items-center gap-2 text-caption">
                      <input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />
                      Publish anyway, I know about the lint errors
                    </label>
                  )}
                </section>
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
              {busy && stage !== "idle" && <p className="text-caption text-muted-foreground">This can take a minute. Cancel stops it.</p>}
              {err && <p role="alert" className="text-body">{err}</p>}
              {err && details && (
                <details className="rounded-md bg-hover"><summary className="cursor-default select-none px-2 py-1 text-caption text-muted-foreground">Details</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap px-2 pb-2 font-mono text-caption text-muted-foreground">{details}</pre></details>
              )}
              {url && (
                <div className="flex flex-col gap-2" data-testid="publish-done">
                  <p className="text-body">Published{needPw ? ". Viewers need the password you set." : ". Anyone with the link can view it."}</p>
                  {needPw && <p className="text-caption text-muted-foreground">Share the link and the password separately.</p>}
                  <a href={url} target="_blank" rel="noreferrer" className="break-all underline">{url}</a>
                  <div className="flex items-center gap-2">
                    <Button size="compact" variant="secondary" onClick={copy} aria-label="Copy link" leadingIcon={copied ? Check : Copy}>{copied ? "Copied" : "Copy link"}</Button>
                    <Button size="compact" variant="secondary" onClick={() => void copyPrompt(url, needPw ? "password" : "public")} leadingIcon={FileText}>Copy agent prompt</Button>
                    <a href={url} target="_blank" rel="noreferrer" aria-label="Open in new tab" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-body hover:bg-hover"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open</a>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button size="compact" variant="ghost" onClick={close}>{url ? "Close" : "Cancel"}</Button>
                {!url && <Button size="compact" variant="primary" disabled={!canPublish} onClick={publish} leadingIcon={err && !busy ? RotateCcw : undefined}>{busy ? "Publishing..." : err ? "Retry" : "Publish"}</Button>}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <DialogTitle>{mode === "pdf" ? "Download PDF" : "Download HTML"}</DialogTitle>
              {err ? <p role="alert" className="text-body">{err}</p> : (
                <p className="flex items-center gap-2 text-body text-muted-foreground" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Preparing {fileLabel}...</p>
              )}
              {!err && <p className="text-caption text-muted-foreground">{mode === "pdf" ? "A PDF can take a minute." : "This usually takes a few seconds."} Cancel stops it.</p>}
              {err && details && (
                <details className="rounded-md bg-hover"><summary className="cursor-default select-none px-2 py-1 text-caption text-muted-foreground">Details</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap px-2 pb-2 font-mono text-caption text-muted-foreground">{details}</pre></details>
              )}
              {!err && <div className="flex justify-end"><Button size="compact" variant="ghost" onClick={close}>Cancel</Button></div>}
              {err && (
                <div className="flex justify-end gap-2">
                  <Button size="compact" variant="ghost" onClick={close}>Close</Button>
                  <Button size="compact" variant="primary" leadingIcon={RotateCcw} onClick={() => download(mode === "pdf" ? "pdf" : "html", lastPdf.current)}>Retry</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={pdfDialog} onOpenChange={setPdfDialog}>
        <DialogContent size="sm">
          <div className="flex flex-col gap-3">
            <DialogTitle>PDF options</DialogTitle>
            <fieldset className="flex flex-col gap-2 text-body">
              <legend className="sr-only">PDF type</legend>
              {([["slides", "Slides", "One slide per page, 16:9"], ["notes", "With notes", "A4 pages with one slide and its speaker notes"], ["handout", "Handout", "Several slides per A4 page"]] as const).map(([v, label, hint]) => (
                <label key={v} className="flex cursor-default items-start gap-2">
                  <input type="radio" name="pdf-mode" value={v} checked={pdfMode === v} onChange={() => setPdfMode(v)} className="mt-1" />
                  <span className="flex flex-col"><span>{label}</span><span className="text-caption text-muted-foreground">{hint}</span></span>
                </label>
              ))}
            </fieldset>
            {pdfMode === "handout" && (
              <label className="flex items-center gap-2 text-body">Slides per page
                <select aria-label="Slides per page" value={per} onChange={(e) => setPer(+e.target.value)} className="rounded-md bg-hover px-2 py-1">
                  {[2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button size="compact" variant="ghost" onClick={() => setPdfDialog(false)}>Cancel</Button>
              <Button size="compact" variant="primary" leadingIcon={Download} onClick={() => { setPdfDialog(false); void download("pdf", { mode: pdfMode, per }); }}>Download PDF</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {pub?.published && (
        <Dialog open={pubOpen} onOpenChange={setPubOpen}>
          <DialogContent size="sm">
            <div className="flex flex-col gap-3" data-testid="published-dialog">
              <DialogTitle>Published</DialogTitle>
              <a href={pub.url} target="_blank" rel="noreferrer" className="break-all underline">{pub.url}</a>
              <p className="text-caption text-muted-foreground">
                Published {ago(pub.at)}, {pub.visibility === "password" ? "password protected" : "public"}, about {fmt(pub.bytes)}.
              </p>
              {pub.changed && (
                <div className="flex items-start gap-2 rounded-md bg-hover p-2 text-caption" data-testid="changed-since-publish">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">Changed since publish. The published version is older than this deck.</span>
                  <Button size="compact" variant="secondary" onClick={() => { setPubOpen(false); void openPublish(); }}>Publish again</Button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button size="compact" variant="secondary" onClick={copyLast} aria-label="Copy published link" leadingIcon={Copy}>Copy link</Button>
                <Button size="compact" variant="secondary" onClick={() => void copyPrompt(pub.url, pub.visibility)} leadingIcon={FileText}>Copy agent prompt</Button>
                <a href={pub.url} target="_blank" rel="noreferrer" aria-label="Open published deck in a new tab" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-body hover:bg-hover"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open</a>
              </div>
              {pub.history.length > 1 && (
                <section aria-label="Publish history" className="flex flex-col gap-1">
                  <span className="text-micro uppercase tracking-wide text-muted-foreground">History</span>
                  <ul className="flex flex-col gap-0.5 text-caption text-muted-foreground" data-testid="publish-history">
                    {pub.history.slice(0, 5).map((h, i) => <li key={i}>{ago(h.at)}, {h.visibility === "password" ? "password" : "public"}, {fmt(h.bytes)}{h.unpublishedAt ? `, unpublished ${ago(h.unpublishedAt)}` : ""}</li>)}
                  </ul>
                </section>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button size="compact" variant="ghost" className="text-destructive [&_svg]:text-destructive" leadingIcon={Trash2} onClick={() => { setUnpubErr(""); setUnpubDetails(""); setTypedName(""); setUnpubOpen(true); }}>Unpublish...</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {pub?.published && (
        <Dialog open={unpubOpen} onOpenChange={(o) => { if (!unpubBusy) setUnpubOpen(o); }}>
          <DialogContent size="sm">
            <div className="flex flex-col gap-3" data-testid="unpublish-dialog">
              <DialogTitle>Unpublish this deck?</DialogTitle>
              <p className="text-body">This removes <span className="break-all">{pub.url}</span> for everyone. People with the link will see a not found page. The deck in this app is not deleted.</p>
              {pub.name !== folder && (
                <label className="flex flex-col gap-1 text-caption">
                  <span>This address was published as <strong className="text-body">{pub.name}</strong>, not as this deck folder. Type that name to confirm.</span>
                  <input value={typedName} onChange={(e) => setTypedName(e.target.value)} aria-label="Published name" autoComplete="off" spellCheck={false} className="h-7 rounded-md bg-hover px-2 text-body" />
                </label>
              )}
              {pub.visibility === "password" && <p className="text-caption text-muted-foreground">The password-protected copy is removed too.</p>}
              {unpubBusy && <p className="flex items-center gap-2 text-caption text-muted-foreground" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Removing from Cloudflare...</p>}
              {unpubErr && <p role="alert" className="text-body">{unpubErr}</p>}
              {unpubErr && unpubDetails && <details className="rounded-md bg-hover"><summary className="cursor-default select-none px-2 py-1 text-caption text-muted-foreground">Details</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap px-2 pb-2 font-mono text-caption text-muted-foreground">{unpubDetails}</pre></details>}
              <div className="flex justify-end gap-2">
                <Button size="compact" variant="ghost" disabled={unpubBusy} onClick={() => setUnpubOpen(false)}>Cancel</Button>
                <Button size="compact" variant="secondary" className="text-destructive [&_svg]:text-destructive" disabled={unpubBusy || (pub.name !== folder && typedName !== pub.name)} onClick={unpublish} leadingIcon={unpubErr ? RotateCcw : Trash2}>{unpubErr ? "Try again" : "Unpublish"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <VersionHistory folder={folder} open={versions} onOpenChange={setVersions} ensureSaved={saved} />
    </>
  );
}
export type { ExportMenuProps };
