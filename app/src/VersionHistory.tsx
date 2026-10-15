import { useCallback, useEffect, useState } from "react";
import { ExternalLink, History, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast, TOAST } from "@/Toaster";
import { ago } from "@/lib/comment-state";
import { diffDecks, slidesLabel } from "@/lib/deck-diff";

type Version = { id: string; at: string; kind: "save" | "external" | "restore" | "mine" | "disk"; slides: number; bytes: number };
const KIND: Record<Version["kind"], string> = {
  save: "Before a save",
  external: "Before a change outside the editor",
  restore: "Before a restore",
  mine: "Before reload (my edits)",
  disk: "Before overwrite (file on disk)",
};
const post = (path: string) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

interface VersionHistoryProps {
  folder: string;
  open: boolean;
  onOpenChange(o: boolean): void;
  /** 저장 안 된 변경이 있으면 먼저 저장한다. false를 돌려주면 복원하지 않는다. */
  ensureSaved?: () => Promise<boolean>;
}

// 덱의 이전 버전 목록(최근 50개)과 복원. 복원은 현재 상태를 먼저 스냅샷으로 남기고, Undo 토스트로 되돌릴 수 있다.
export function VersionHistory({ folder, open, onOpenChange, ensureSaved }: VersionHistoryProps) {
  const [items, setItems] = useState<Version[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [compare, setCompare] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setErr("");
    fetch(`/api/decks/${folder}/versions`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setItems, () => setErr("Could not load the version history"));
  }, [folder]);
  useEffect(() => { if (open) { setItems(null); setCompare({}); load(); } }, [open, load]);

  const diffWith = async (v: Version) => {
    setBusy(v.id);
    try {
      const [cur, old] = await Promise.all([
        fetch(`/api/decks/${folder}/source`).then((r) => r.json()),
        fetch(`/api/decks/${folder}/versions/${v.id}`).then((r) => r.json()),
      ]);
      const d = diffDecks(cur.source, old.source);
      const parts = [d.changed.length ? `${slidesLabel(d.changed)} would come back or change` : "", d.removed ? `${d.removed} current ${d.removed === 1 ? "slide is" : "slides are"} not in this version` : "", d.outside ? "styles or header differ" : ""].filter(Boolean);
      setCompare((c) => ({ ...c, [v.id]: parts.join(". ") || "Same as the current deck" }));
    } catch { setCompare((c) => ({ ...c, [v.id]: "Could not compare" })); } finally { setBusy(""); }
  };

  const restore = async (v: Version) => {
    setBusy(v.id); setErr("");
    try {
      if (ensureSaved && !(await ensureSaved())) { setErr("Save the deck first"); return; }
      const r = await post(`/api/decks/${folder}/versions/${v.id}/restore`);
      if (!r.ok) throw new Error(String(r.status));
      const { undo } = (await r.json()) as { undo?: string | null };
      onOpenChange(false);
      toast(`Restored the version from ${new Date(v.at).toLocaleTimeString()}`, undo ? { action: { label: "Undo", onClick: () => { post(`/api/decks/${folder}/versions/${undo}/restore`).then((u) => toast(u.ok ? "Restore undone" : "Could not undo the restore", { ms: 3000 })).catch(() => toast("Could not undo the restore", { ms: 3000 })); } } } : { ms: 5000 });
    } catch { setErr("Could not restore this version"); } finally { setBusy(""); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <div className="flex flex-col gap-3">
          <DialogTitle>Version history</DialogTitle>
          <p className="text-caption text-muted-foreground">The editor keeps the last 50 states from before saves and changes made outside the editor. Restoring keeps the current deck as a version too.</p>
          {err && <p role="alert" className="text-body">{err}</p>}
          {items === null && !err && <p className="flex items-center gap-2 text-body text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading...</p>}
          {items && items.length === 0 && <p className="text-body text-muted-foreground" data-testid="no-versions">No earlier versions yet. They appear after the next save.</p>}
          {items && items.length > 0 && (
            <ul aria-label="Versions" className="flex max-h-80 flex-col gap-1 overflow-auto" data-testid="version-list">
              {items.map((v) => (
                <li key={v.id} data-version-id={v.id} data-kind={v.kind} className="flex flex-col gap-1 rounded-md bg-hover p-2">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="text-body">{ago(v.at)}</span>
                    <span className="text-micro text-muted-foreground">{new Date(v.at).toLocaleString()}</span>
                    <span className="ml-auto text-micro tabular-nums text-muted-foreground">{v.slides} slides</span>
                  </div>
                  <span className="text-micro text-muted-foreground">{KIND[v.kind]}</span>
                  {compare[v.id] && <span className="text-micro" aria-live="polite">{compare[v.id]}</span>}
                  <div className="flex items-center gap-1">
                    <Button size="compact" variant="ghost" disabled={!!busy} onClick={() => diffWith(v)} aria-label={`Compare version from ${new Date(v.at).toLocaleTimeString()} with the current deck`}>Compare</Button>
                    <a href={`/api/decks/${folder}/versions/${v.id}/preview`} target="_blank" rel="noreferrer" aria-label={`Preview version from ${new Date(v.at).toLocaleTimeString()} in a new tab`} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-body hover:bg-hover"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Preview</a>
                    <Button size="compact" variant="secondary" className="ml-auto" disabled={!!busy} onClick={() => restore(v)} leadingIcon={busy === v.id ? Loader2 : RotateCcw} aria-label={`Restore version from ${new Date(v.at).toLocaleTimeString()}`}>Restore</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
