import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useIsMac } from "@/components/ui/command-menu";

// 화면별 단축키 안내 대화상자('?'로 연다). 편집기의 그룹형 2열 키캡 안내와 같은 모양이고, 목록은 화면마다 따로 넘긴다.
export type KeyGroup = [title: string, rows: [combo: string, description: string][]];

const GLYPH: Record<string, string> = { Cmd: "⌘", Shift: "⇧", Enter: "↵", Delete: "⌫", Esc: "⎋", Up: "↑", Down: "↓", Left: "←", Right: "→" };
// "Shift+Cmd+Z"는 키캡 여러 개, "Up, Down"은 쉼표로 나눈 두 키. Cmd는 맥이 아니면 Ctrl로 보인다.
export function Keys({ combo }: { combo: string }) {
  const mac = useIsMac();
  return (
    <span className="flex items-center gap-1">
      {combo.split(", ").map((c, ci) => (
        <span key={ci} className="flex items-center gap-0.5">
          {(c === "+" ? ["+"] : c.split("+")).map((k) => <kbd key={k} className="min-w-5 rounded bg-surface-3 px-1 py-0.5 text-center font-sans text-micro tabular-nums text-foreground">{k === "Cmd" && !mac ? "Ctrl" : (GLYPH[k] ?? k)}</kbd>)}
        </span>
      ))}
    </span>
  );
}

export function ShortcutHelp({ open, onOpenChange, groups, description }: { open: boolean; onOpenChange(o: boolean): void; groups: KeyGroup[]; description?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogTitle>Shortcuts</DialogTitle>
        <DialogDescription className="sr-only">{description ?? "Keyboard shortcuts for this screen"}</DialogDescription>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 pt-3 sm:grid-cols-2">
          {groups.map(([g, rows]) => (
            <div key={g} className="flex flex-col gap-1.5">
              <span className="text-caption font-semibold">{g}</span>
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 text-body"><span className="text-muted-foreground">{v}</span><Keys combo={k} /></div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
