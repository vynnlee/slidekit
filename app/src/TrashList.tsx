import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusPage } from "./StatusPage";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { trashMenu } from "@/lib/menu-model";
import { toast } from "./Toaster";
import { UNREACHABLE, isDown, onReconnect } from "@/lib/connection";

type Item = { entry: string; folder: string; title: string; deletedAt: string };

const call = async (path: string, method: string, body: object = {}) => {
  if (isDown()) throw new Error(UNREACHABLE);
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => { throw new Error(UNREACHABLE); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
};
const when = (iso: string) => new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

// 휴지통 보기: 복구는 원래 이름(충돌하면 -restored)으로, 영구 삭제는 이름을 입력해야 한다.
export function TrashList({ onRestored }: { onRestored: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState<Item | null>(null);
  const cm = useContextMenu();
  const [typed, setTyped] = useState("");

  const load = () => fetch("/api/trash").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(setItems).catch(() => setErr("Could not load trash"));
  useEffect(() => { load(); return onReconnect(() => { setErr(""); load(); }); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setErr("");
    try { await fn(); await load(); return true; }
    catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const restore = (i: Item) => run(async () => { const r = await call(`/api/trash/${encodeURIComponent(i.entry)}/restore`, "POST"); onRestored(); toast(`Restored ${i.title}`); return r; });
  const purge = async () => {
    const i = purging;
    if (i && (await run(() => call(`/api/trash/${encodeURIComponent(i.entry)}/purge`, "POST", { confirm: typed })))) setPurging(null);
  };

  return (
    <>
      <ContextMenu menu={cm} />
      {err && (
        <p role="alert" className="mb-2 flex items-center gap-2 text-caption text-destructive">
          {err}{items === null && <Button variant="ghost" size="compact" onClick={() => { setErr(""); load(); }}>Retry</Button>}
        </p>
      )}
      {items?.length === 0 && <StatusPage as="h2" title="Trash is empty">Decks you move to Trash show up here.</StatusPage>}
      <ul className="flex flex-col gap-0.5">
        {items?.map((i) => (
          <li key={i.entry} className="flex h-9 items-center gap-3 px-2 text-body" {...cm.bind(() => trashMenu({ restore: () => { restore(i); }, purge: () => { setTyped(""); setErr(""); setPurging(i); } }, { restore: RotateCcw, purge: Trash2 }))}>
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            <span className="shrink-0 text-caption text-muted-foreground">{i.folder}</span>
            <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{when(i.deletedAt)}</span>
            <Tooltip content="Restore" side="top"><Button variant="ghost" size="icon-compact" aria-label={`Restore ${i.title}`} disabled={busy} onClick={() => restore(i)}><RotateCcw /></Button></Tooltip>
            <Tooltip content="Delete forever" side="top"><Button variant="ghost" size="icon-compact" aria-label={`Delete ${i.title} forever`} onClick={() => { setTyped(""); setErr(""); setPurging(i); }}><Trash2 /></Button></Tooltip>
          </li>
        ))}
      </ul>
      <Dialog open={!!purging} onOpenChange={(o) => !o && setPurging(null)}>
        <DialogContent size="sm">
          <DialogTitle>Delete forever?</DialogTitle>
          <DialogDescription>This cannot be undone. Type {purging?.folder} to confirm.</DialogDescription>
          <form className="flex flex-col gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (typed === purging?.folder) purge(); }}>
            <Field autoFocus aria-label="Deck name" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="compact" onClick={() => setPurging(null)}>Cancel</Button>
              <Button type="submit" variant="primary" size="compact" disabled={typed !== purging?.folder || busy}>Delete forever</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
