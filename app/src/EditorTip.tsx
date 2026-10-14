import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsMac } from "@/components/ui/command-menu";

// 편집기를 처음 여는 브라우저에서 한 번만 보이는 안내 카드. 닫으면(Got it) 다시 뜨지 않는다.
// 편집기는 <EditorTip sample={...} />를 화면 안 어디든(fixed라 위치는 자유) 한 줄로 붙인다.
const KEY = "slidekit.tip.editor";
const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } };

export function EditorTip({ sample = false }: { sample?: boolean }) {
  const [open, setOpen] = useState(() => !seen());
  const mac = useIsMac();
  if (!open) return null;
  const close = () => { try { localStorage.setItem(KEY, "1"); } catch {} setOpen(false); };
  return (
    <div role="region" aria-label="Editor tips" className="fixed bottom-4 left-4 z-40 flex w-72 flex-col gap-1.5 rounded-lg bg-surface-3 p-3 text-body shadow-surface-3">
      <p>Click selects a top-level element. Double-click goes one level in, {mac ? "Cmd" : "Ctrl"}+click picks the innermost.</p>
      <p>{mac ? "Cmd" : "Ctrl"}+K opens the command menu.</p>
      <p>Select an element and press C to leave a comment.</p>
      {sample && <p className="text-muted-foreground">Replace the sample text, then run lint or Publish.</p>}
      <Button variant="primary" size="compact" className="self-end" onClick={close}>Got it</Button>
    </div>
  );
}
