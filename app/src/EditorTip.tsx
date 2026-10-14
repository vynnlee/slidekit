import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsMac } from "@/components/ui/command-menu";

// 편집기를 처음 여는 브라우저에서 한 번만 보이는 안내 카드. 첫 상호작용이나 15초 뒤, 또는 Got it으로 닫히고 다시 뜨지 않는다.
// 편집기는 <EditorTip sample={...} />를 화면 안 어디든(fixed라 위치는 자유: 넓은 화면은 Layers 패널 아래 빈 자리(왼쪽 아래, 패널 폭 안), 좁은 화면은 헤더 아래 가운데. 카드는 포인터를 받지 않고 Got it 버튼만 받으므로 아래 요소(필름스트립 등)의 클릭과 드래그를 막지 않는다) 한 줄로 붙인다.
const KEY = "slidekit.tip.editor";
const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } };

export function EditorTip({ sample = false }: { sample?: boolean }) {
  const [open, setOpen] = useState(() => !seen());
  const mac = useIsMac();
  const close = () => { try { localStorage.setItem(KEY, "1"); } catch {} setOpen(false); };
  // 첫 상호작용(아무 클릭이나 키 입력)이나 15초 뒤에 스스로 닫힌다. 카드는 포인터를 받지 않아 그 클릭은 아래 요소에 그대로 간다.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(close, 15000);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", close, true); };
  }, [open]);
  if (!open) return null;
  return (
    <div role="region" aria-label="Editor tips" className="pointer-events-none fixed z-40 flex w-72 max-w-[calc(100vw-2rem)] md:w-56 flex-col gap-1.5 rounded-lg bg-surface-3 p-3 text-body shadow-surface-3 max-md:left-1/2 max-md:top-12 max-md:-translate-x-1/2 md:bottom-4 md:left-2">
      <p>Click selects a top-level element. Double-click goes one level in, {mac ? "Cmd" : "Ctrl"}+click picks the innermost.</p>
      <p>{mac ? "Cmd" : "Ctrl"}+K opens the command menu.</p>
      <p>Select an element and press C to leave a comment.</p>
      {sample && <p className="text-muted-foreground">Replace the sample text, then run lint or Publish.</p>}
      <Button variant="primary" size="compact" className="pointer-events-auto self-end" onClick={close}>Got it</Button>
    </div>
  );
}
