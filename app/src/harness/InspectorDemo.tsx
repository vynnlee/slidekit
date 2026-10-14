// /dev/inspector: Inspector 부품을 한 화면에서 눈으로 점검하고 Playwright로 검증하는 개발용 페이지.
import { useState } from "react";
import { AlignHorizontalJustifyCenter, Bold, Eye, Link, RotateCw, SquareRoundCorner } from "lucide-react";
import { NumberField } from "@/components/ui/number-field";
import { ColorField } from "@/components/ui/color-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { InspectorSection } from "@/components/ui/inspector-section";
import { AlignBox } from "@/components/ui/align-box";
import { SidesField } from "@/components/ui/sides-field";
import { Button } from "@/components/ui/button";

export function InspectorDemo() {
  const [x, setX] = useState("100px");
  const [w, setW] = useState("400px");
  const [rot, setRot] = useState("0");
  const [mixed, setMixed] = useState(true);
  const [color, setColor] = useState("#a78bfa");
  const [dir, setDir] = useState("row");
  const [align, setAlign] = useState<[string, string]>(["flex-start", "center"]);
  const [pad, setPad] = useState({ top: "10px", right: "10px", bottom: "10px", left: "10px" });
  const [pressed, setPressed] = useState(false);
  const [log, setLog] = useState({ live: 0, undo: 0 });
  const scrub = {
    onScrubStart: () => setLog((l) => ({ ...l, undo: l.undo + 1 })),
    onScrubEnd: () => undefined,
  };
  const live = (set: (v: string) => void) => (v: string) => { set(v); setMixed(false); setLog((l) => ({ ...l, live: l.live + 1 })); };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="w-[280px] border-r border-border/60" data-testid="panel">
        <InspectorSection id="demo-pos" title="Position" action={<Button size="compact" variant="ghost" className="[&_svg]:size-3.5" aria-label="Link ratio" aria-pressed={pressed} onClick={() => setPressed(!pressed)}><Link /></Button>}>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X" aria-label="X" value={x} onChange={live(setX)} {...scrub} mixed={mixed} />
            <NumberField label="W" aria-label="W" value={w} onChange={live(setW)} {...scrub} />
            <NumberField label={<RotateCw />} aria-label="Rotation" value={rot} onChange={live(setRot)} {...scrub} unit="" step={1} min={-180} max={180} />
            <NumberField label={<SquareRoundCorner />} aria-label="Radius" value="8px" onChange={() => undefined} {...scrub} min={0} />
          </div>
          <SegmentedControl aria-label="Direction" value={dir} onChange={setDir} options={[
            { value: "row", icon: <AlignHorizontalJustifyCenter />, label: "Row" },
            { value: "column", icon: <Bold />, label: "Column" },
            { value: "none", icon: <Eye />, label: "None" },
          ]} />
        </InspectorSection>
        <InspectorSection id="demo-layout" title="Layout">
          <AlignBox direction={dir === "column" ? "column" : "row"} justify={align[0]} align={align[1]} onChange={(j, a) => setAlign([j, a])} />
          <SidesField label="Padding" values={pad} onChange={(sides, v) => setPad((p) => ({ ...p, ...Object.fromEntries(sides.map((s) => [s, v])) }))} />
        </InspectorSection>
        <InspectorSection id="demo-fill" title="Fill">
          <ColorField aria-label="Fill" value={color} onChange={setColor} allowNone />
        </InspectorSection>
      </div>
      <pre data-testid="state" className="p-4 text-xs">{JSON.stringify({ x, w, rot, mixed, color, dir, align, pad, pressed, ...log }, null, 1)}</pre>
    </div>
  );
}
