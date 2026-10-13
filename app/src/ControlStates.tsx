// /dev/controls: 입력 컨트롤의 상태표. 행은 컨트롤, 열은 상태(기본, 호버, 포커스, 설정됨, Mixed, 비활성, 오류).
// 호버와 포커스는 실제 의사 상태를 못 만드니 같은 토큰의 클래스를 강제로 붙여 눈으로 비교한다. 맨 위 행은 기준인 Fluid Select.
import { useState, type ReactNode } from "react";
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Bold, Italic, RotateCw } from "lucide-react";
import { Field } from "@/components/ui/field";
import { NumberField } from "@/components/ui/number-field";
import { ColorField } from "@/components/ui/color-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AlignBox } from "@/components/ui/align-box";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const HOVER = "bg-hover";
const FOCUS = "ring-1 ring-[color:var(--focus-ring,#6B97FF)]";
const STATES = ["Default", "Hover", "Focus", "Set", "Mixed", "Disabled", "Error"] as const;

const noop = () => undefined;
const seg = (extra = "") => [
  { value: "a", icon: <AlignHorizontalJustifyCenter />, label: "Horizontal" },
  { value: "b", icon: <AlignVerticalJustifyCenter />, label: "Vertical" },
  { value: "c", icon: <RotateCw />, label: "Rotate" + extra },
];

function Row({ name, cells }: { name: string; cells: ReactNode[] }) {
  return (
    <>
      <div className="self-center text-caption text-muted-foreground">{name}</div>
      {cells.map((c, i) => <div key={i} className="flex min-w-0 items-center" data-state={STATES[i]}>{c}</div>)}
    </>
  );
}

export function ControlStates() {
  const [sel, setSel] = useState("a");
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="mb-4 text-title font-semibold">Control states</h1>
      <div className="grid items-center gap-x-3 gap-y-3" style={{ gridTemplateColumns: "96px repeat(7, 132px)" }}>
        <div />
        {STATES.map((s) => <div key={s} className="text-caption text-muted-foreground">{s}</div>)}

        <Row name="Select (reference)" cells={[
          <Sel key="d" />, <Sel key="h" cls={HOVER} />, <Sel key="f" cls={FOCUS} />, <Sel key="s" />, <Sel key="m" />,
          <Sel key="x" disabled />, <Sel key="e" cls="border-destructive/50" />,
        ]} />
        <Row name="Field" cells={[
          <Field key="d" aria-label="Field" placeholder="Value" />,
          <Field key="h" aria-label="Field hover" defaultValue="Hover" className={HOVER} />,
          <Field key="f" aria-label="Field focus" defaultValue="Focus" className={FOCUS} />,
          <Field key="s" aria-label="Field set" defaultValue="Set" />,
          <Field key="m" aria-label="Field mixed" placeholder="Mixed" />,
          <Field key="x" aria-label="Field disabled" defaultValue="Disabled" disabled />,
          <Field key="e" aria-label="Field error" defaultValue="Error" aria-invalid />,
        ]} />
        <Row name="NumberField" cells={[
          <NumberField key="d" label="X" aria-label="Number" value="0" onChange={noop} suffix="px" />,
          <NumberField key="h" label="X" aria-label="Number hover" value="12" onChange={noop} className={HOVER} />,
          <NumberField key="f" label="X" aria-label="Number focus" value="12" onChange={noop} className={FOCUS} />,
          <NumberField key="s" label="X" aria-label="Number set" value="24" onChange={noop} dirty onReset={noop} suffix="px" />,
          <NumberField key="m" label="X" aria-label="Number mixed" value="" onChange={noop} mixed />,
          <NumberField key="x" label="X" aria-label="Number disabled" value="8" onChange={noop} disabled disabledReason="Set by the layout" />,
          <NumberField key="e" label="X" aria-label="Number error" value="-1" onChange={noop} error />,
        ]} />
        <Row name="Segmented (radio)" cells={[
          <SegmentedControl key="d" aria-label="Seg" value="" onChange={noop} options={seg()} />,
          <SegmentedControl key="h" aria-label="Seg hover" value="a" onChange={noop} options={seg()} className={HOVER} />,
          <SegmentedControl key="f" aria-label="Seg focus" value="b" onChange={noop} options={seg()} className={FOCUS} />,
          <SegmentedControl key="s" aria-label="Seg set" value={sel} onChange={setSel} options={seg()} />,
          <SegmentedControl key="m" aria-label="Seg mixed" value="" onChange={noop} options={seg()} />,
          <SegmentedControl key="x" aria-label="Seg disabled" value="a" onChange={noop} options={seg()} disabled />,
          <SegmentedControl key="e" aria-label="Seg error" value="a" onChange={noop} options={seg()} className="border-destructive/50" />,
        ]} />
        <Row name="Segmented (toggle)" cells={[
          <Tog key="d" v="" />, <Tog key="h" v="a" cls={HOVER} />, <Tog key="f" v="b" cls={FOCUS} />, <Tog key="s" v="a" />,
          <Tog key="m" v="" />, <Tog key="x" v="a" disabled />, <Tog key="e" v="a" cls="border-destructive/50" />,
        ]} />
        <Row name="Color" cells={[
          <ColorField key="d" aria-label="Color" value="" onChange={noop} allowNone />,
          <ColorField key="h" aria-label="Color hover" value="#a78bfa" onChange={noop} />,
          <ColorField key="f" aria-label="Color focus" value="#a78bfa" onChange={noop} />,
          <ColorField key="s" aria-label="Color set" value="#34d399" onChange={noop} />,
          <ColorField key="m" aria-label="Color mixed" value="" onChange={noop} allowNone />,
          <span key="x" className="text-caption text-muted-foreground">n/a</span>,
          <span key="e" className="text-caption text-muted-foreground">n/a</span>,
        ]} />
        <Row name="AlignBox" cells={[
          <Align key="d" />, <Align key="h" />, <Align key="f" />, <Align key="s" />, <Align key="m" />, <span key="x" className="text-caption text-muted-foreground">n/a</span>, <span key="e" className="text-caption text-muted-foreground">n/a</span>,
        ]} />
      </div>
    </div>
  );
}

function Sel({ cls = "", disabled }: { cls?: string; disabled?: boolean }) {
  return (
    <Select value="a" onValueChange={noop} size="compact">
      <SelectTrigger aria-label="Select" className={`min-w-0 w-full ${cls}`} {...(disabled ? ({ disabled: true } as object) : {})} />
      <SelectContent><SelectItem index={0} value="a">Regular</SelectItem></SelectContent>
    </Select>
  );
}

function Tog({ v, cls = "", disabled }: { v: string; cls?: string; disabled?: boolean }) {
  return (
    <SegmentedControl
      aria-label="Toggle" mode="toggle" deselectable value={v} onChange={noop} disabled={disabled} className={cls}
      options={[{ value: "a", icon: <Bold />, label: "Bold" }, { value: "b", icon: <Italic />, label: "Italic" }]}
    />
  );
}

function Align() {
  return <AlignBox direction="row" justify="center" align="center" onChange={noop} />;
}
