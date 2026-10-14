import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { validatePatch } from "../../engine/deck-meta";
import type { DeckMeta } from "@/lib/deck-meta";

// 덱 설정 폼. 값을 들고 있지 않고 meta를 그대로 보여 주며, 바뀐 필드만 onChange(patch)로 내보낸다.
// 글자 입력은 약 400ms 디바운스해서 호출 횟수를 줄인다(편집기에서는 호출 하나가 실행 취소 한 건이고 캔버스를 다시 불러온다).
const LANGS: [string, string][] = [["ko", "Korean"], ["en", "English"]];
const str = (v: unknown) => (typeof v === "string" ? v : "");

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </label>
  );
}

function TextRow({ field, label, hint, meta, onChange, type }: { field: string; label: string; hint?: string; meta: DeckMeta; onChange(p: Record<string, unknown>): void; type?: string }) {
  const [v, setV] = useState(str(meta[field]));
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef(str(meta[field]));
  // 밖에서 값이 바뀌면(되돌리기, 다시 불러오기) 입력 중이 아닐 때 따라간다.
  useEffect(() => { const s = str(meta[field]); if (s !== last.current) { last.current = s; setV(s); setErr(""); } }, [meta, field]);
  // 닫거나 떠날 때 아직 보내지 않은 입력은 버리지 않고 보낸다.
  const pending = useRef<string | null>(null), push = useRef(onChange);
  push.current = onChange;
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current !== null) push.current({ [field]: pending.current }); }, [field]);
  const edit = (next: string) => {
    setV(next);
    clearTimeout(timer.current);
    const issue = validatePatch({ [field]: next })[0];
    setErr(issue?.msg ?? "");
    if (issue) { pending.current = null; return; }
    pending.current = next;
    timer.current = setTimeout(() => { pending.current = null; last.current = next.trim(); onChange({ [field]: next }); }, type === "date" ? 0 : 400);
  };
  return (
    <Row label={label} hint={err ? undefined : hint}>
      <Field type={type} aria-label={label} aria-invalid={!!err || undefined} value={v} onChange={(e) => edit(e.target.value)} onBlur={() => { if (pending.current !== null) { clearTimeout(timer.current); const n = pending.current; pending.current = null; if (n.trim() !== str(meta[field])) { last.current = n.trim(); onChange({ [field]: n }); } } }} />
      {err && <span role="alert" className="text-caption text-destructive">{err}</span>}
    </Row>
  );
}

export function DeckSettingsForm({ meta, onChange, error }: { meta: DeckMeta; onChange(patch: Record<string, unknown>): void; error?: string }) {
  const lang = str(meta.lang) || "ko";
  const langs = LANGS.some(([c]) => c === lang) ? LANGS : [...LANGS, [lang, lang] as [string, string]];
  const vis = meta.visibility === "password" ? "password" : "public";
  return (
    <div className="flex flex-col gap-3 pt-3">
      <TextRow field="title" label="Title (browser tab and deck list)" hint="Cover text is not changed." meta={meta} onChange={onChange} />
      <TextRow field="subtitle" label="Subtitle" meta={meta} onChange={onChange} />
      <TextRow field="author" label="Author" meta={meta} onChange={onChange} />
      <TextRow field="date" label="Date" meta={meta} onChange={onChange} type="date" />
      <Row label="Language">
        <Select value={lang} onValueChange={(v) => onChange({ lang: v })} size="compact">
          <SelectTrigger aria-label="Language" />
          <SelectContent>{langs.map(([c, name], i) => <SelectItem key={c} index={i} value={c}>{name}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      <Row label="Visibility" hint={vis === "password" ? "A password deck asks for the password when you publish. It is never saved in the deck." : "Anyone with the link can open a published deck."}>
        <Select value={vis} onValueChange={(v) => onChange({ visibility: v })} size="compact">
          <SelectTrigger aria-label="Visibility" />
          <SelectContent>
            <SelectItem index={0} value="public">Public</SelectItem>
            <SelectItem index={1} value="password">Password</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Switch label="Page numbers" checked={meta.pageNumber === true} onToggle={() => onChange({ pageNumber: meta.pageNumber !== true })} />
      <Switch label="Progress bar" checked={meta.progress === true} onToggle={() => onChange({ progress: meta.progress !== true })} />
      {typeof meta.id === "string" && <p className="text-caption text-muted-foreground">Deck ID: <span className="tabular-nums">{meta.id}</span> (follows the folder name)</p>}
      <p role={error ? "alert" : undefined} className="min-h-4 text-caption text-destructive">{error}</p>
    </div>
  );
}

// 목록에서 여는 설정: 서버에서 meta와 mtime을 읽고, 바뀔 때마다 PATCH한다(base가 다르면 409).
export function DeckSettingsDialog({ folder, title, onClose, onSaved }: { folder: string | null; title?: string; onClose(): void; onSaved?(): void }) {
  const [state, setState] = useState<{ meta: DeckMeta; mtime: number } | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(Promise.resolve());
  const mtimes = useRef<Record<string, number>>({}); // 닫는 순간 보류 입력이 내려보내져도 base를 잃지 않게 폴더별로 기억한다
  useEffect(() => {
    setState(null); setError("");
    if (!folder) return;
    let live = true;
    fetch(`/api/decks/${encodeURIComponent(folder)}/meta`).then(async (r) => { const j = await r.json(); if (!live) return; if (r.ok) { mtimes.current[folder] = j.mtime; setState(j); } else setError(j.error ?? "Could not load the settings."); }).catch(() => live && setError("Could not load the settings."));
    return () => { live = false; };
  }, [folder]);
  // 닫는 렌더(folder가 null)에서 만들어진 change가 보류 입력을 내려보낼 때도 마지막으로 열렸던 폴더를 쓰도록 기억한다.
  const lastFolder = useRef<string | null>(null);
  if (folder) lastFolder.current = folder;
  const change = (patch: Record<string, unknown>) => {
    const f = lastFolder.current;
    // 연속 변경이 같은 mtime으로 겹치지 않게 차례로 보낸다.
    busy.current = busy.current.then(async () => {
      const base = f ? mtimes.current[f] : undefined;
      if (!f || base === undefined) return;
      const r = await fetch(`/api/decks/${encodeURIComponent(f)}/meta`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch, base }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (r?.ok) { mtimes.current[f] = j.mtime; setState(j); setError(""); onSaved?.(); }
      else if (r?.status === 409) setError("The deck changed in another window. Close this and open the settings again.");
      else setError(j.error ?? "Could not save the settings.");
    });
  };
  return (
    <Dialog open={!!folder} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        <DialogTitle>Deck settings</DialogTitle>
        <DialogDescription>{title ?? folder}. Changes are saved as you make them.</DialogDescription>
        {state ? <DeckSettingsForm meta={state.meta} onChange={change} error={error} /> : <p role={error ? "alert" : "status"} className="pt-2 text-caption text-muted-foreground">{error || "Loading..."}</p>}
      </DialogContent>
    </Dialog>
  );
}
