import { useEffect, useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDown, ArrowRight, Blend, CaseLower, CaseSensitive, CaseUpper, ALargeSmall, Droplets, Expand, EyeOff, Frame, Layers as LayersIcon,
  Minus, Plus, RotateCw, Shrink, Square, SquareRoundCorner, Strikethrough, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart,
  Underline, WrapText, MoveHorizontal, ListCollapse, Space, BetweenHorizontalStart, BetweenVerticalStart, Type,
} from "lucide-react";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { DropdownMenu, DropdownTrigger, DropdownContent } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { NumberField } from "@/components/ui/number-field";
import { ColorField } from "@/components/ui/color-field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { InspectorSection } from "@/components/ui/inspector-section";
import { SidesField } from "@/components/ui/sides-field";
import { AlignBox } from "@/components/ui/align-box";
import { textual } from "./Canvas";
import type { Comment } from "@/lib/deck";

type Items = readonly (readonly [string, string])[];

const KINDS: Items = [["cover", "Cover"], ["chapter", "Chapter"], ["content", "Content"], ["end", "End"]];
const WEIGHTS: Items = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]];
const DISPLAYS: Items = [["block", "Block"], ["flex", "Flex"], ["grid", "Grid"], ["inline-block", "Inline"], ["none", "None"]];
const POSITIONS: Items = [["static", "Static"], ["relative", "Relative"], ["absolute", "Absolute"]];
const BLENDS: Items = [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["difference", "Difference"]];
const BORDER_STYLES: Items = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];

const px = (v: string) => parseFloat(v) || 0;
const num = (n: number) => String(Math.round(n * 100) / 100);

function Pick({ value, items, onChange, label }: { value: string; items: Items; onChange(v: string): void; label: string }) {
  const list = items.some(([v]) => v === value) ? items : [...items, [value, value] as const];
  return (
    <Select value={value} onValueChange={onChange} size="compact">
      <SelectTrigger aria-label={label} />
      <SelectContent>
        {list.map(([v, l], i) => <SelectItem key={v} index={i} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const icon = (I: typeof Square) => <I />;
const opt = (value: string, I: typeof Square, label: string): SegmentedOption => ({ value, icon: icon(I), label });

function Toggle({ on, label, I, onClick }: { on: boolean; label: string; I: typeof Square; onClick(): void }) {
  return (
    <Tooltip content={label} side="top">
      <Button aria-label={label} aria-pressed={on} variant={on ? "secondary" : "ghost"} size="icon-compact" onClick={onClick}><I /></Button>
    </Tooltip>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

type Props = {
  sel: Element | null;
  slide: HTMLElement | null;
  selId: number; // 선택이 바뀔 때마다 늘어 입력값을 다시 읽는다
  tab: string;
  onTab(t: string): void;
  comments: Comment[];
  onJump(c: Comment): void;
  onStyle(prop: string, value: string): void;
  onAttr(name: string, value: string | null): void;
  onSlideStyle(prop: string, value: string): void;
  onScrub(on: boolean): void;
};

const SHADOW = /^(rgba?\([^)]*\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?$/i;

export function Inspector(p: Props) {
  const el = p.sel as HTMLElement | null;
  const [, bump] = useState(0);
  useEffect(() => bump((n) => n + 1), [el, p.selId]);
  const [fxMenu, setFxMenu] = useState(false);

  const win = el?.ownerDocument.defaultView ?? null;
  const cs = el && win ? win.getComputedStyle(el) : null;
  const parent = el?.parentElement && win ? win.getComputedStyle(el.parentElement) : null;
  const inl = (prop: string) => el?.style.getPropertyValue(prop) ?? "";
  const val = (prop: string) => inl(prop) || cs?.getPropertyValue(prop) || "";
  const set = (prop: string, v: string) => { p.onStyle(prop, v); bump((n) => n + 1); };
  const scrub = { onScrubStart: () => p.onScrub(true), onScrubEnd: () => p.onScrub(false) };

  // 계산값 그대로 쓰는 일반 숫자 필드
  const n = (prop: string, label: ReactNode, aria: string, o: { unit?: string; step?: number; min?: number; max?: number } = {}) => (
    <NumberField label={label} aria-label={aria} value={val(prop)} muted={!inl(prop)} onChange={(v) => set(prop, v)} {...scrub} {...o} />
  );

  const isText = !!el && textual(el);
  const isMedia = !!el && (el.tagName === "IMG" || el instanceof SVGElement);
  const container = !!el && !isText && !isMedia;
  const display = val("display");
  const flex = display === "flex" || display === "inline-flex";
  const grid = display === "grid";
  const parentFlexRow = !!parent && parent.display.includes("flex") && !parent.flexDirection.startsWith("column");
  const parentFlexCol = !!parent && parent.display.includes("flex") && parent.flexDirection.startsWith("column");
  const parentGrid = parent?.display === "grid";

  // 정렬 바: 부모 display에 따라 쓰는 속성이 다르다
  const alignH = (where: "start" | "center" | "end") => {
    if (parentFlexRow) {
      set("margin-left", where === "start" ? "0" : "auto"); set("margin-right", where === "end" ? "0" : "auto");
      if (where === "center") { set("margin-left", "auto"); set("margin-right", "auto"); }
    } else if (parentFlexCol || parentGrid) set(parentGrid ? "justify-self" : "align-self", where === "start" ? "flex-start" : where === "end" ? "flex-end" : "center");
    else {
      set("margin-left", where === "start" ? "0" : "auto"); set("margin-right", where === "end" ? "0" : "auto");
      if (where === "center") { set("margin-left", "auto"); set("margin-right", "auto"); }
      if (isText) set("text-align", where === "start" ? "left" : where === "end" ? "right" : "center");
    }
  };
  const alignV = (where: "start" | "center" | "end") => {
    if (parentFlexRow || parentGrid) set("align-self", where === "start" ? "flex-start" : where === "end" ? "flex-end" : "center");
    else if (parentFlexCol) { set("margin-top", where === "start" ? "0" : "auto"); set("margin-bottom", where === "end" ? "0" : "auto"); if (where === "center") { set("margin-top", "auto"); set("margin-bottom", "auto"); } }
  };
  const canV = parentFlexRow || parentFlexCol || parentGrid;

  // 크기 모드: Fixed, Hug, Fill
  const mode = (axis: "width" | "height") => {
    const v = inl(axis);
    if (v === "fit-content" || v === "max-content") return "hug";
    if (v === "100%" || (axis === "width" ? parentFlexRow : parentFlexCol) && inl("flex").startsWith("1 1")) return "fill";
    return "fixed";
  };
  const setMode = (axis: "width" | "height", m: string) => {
    const main = axis === "width" ? parentFlexRow : parentFlexCol;
    if (m === "fixed") { set("flex", ""); set(axis, Math.round(px(cs?.getPropertyValue(axis) ?? "0")) + "px"); }
    else if (m === "hug") { set("flex", ""); set(axis, "fit-content"); }
    else if (main) { set(axis, ""); set("flex", "1 1 0"); }
    else set(axis, "100%");
  };
  const MODES = [opt("fixed", Square, "Fixed"), opt("hug", Shrink, "Hug"), opt("fill", Expand, "Fill")];

  const side4 = (prop: string) => ({
    top: val(`${prop}-top`), right: val(`${prop}-right`), bottom: val(`${prop}-bottom`), left: val(`${prop}-left`),
  });
  const setSides = (prop: string) => (sides: ("top" | "right" | "bottom" | "left")[], v: string) => sides.forEach((s) => set(`${prop}-${s}`, v));

  // 텍스트
  const fs = px(val("font-size")) || 16;
  const families = (() => {
    const out = new Set<string>();
    if (p.slide && win) p.slide.querySelectorAll("*").forEach((e, i) => { if (i < 300) out.add(win.getComputedStyle(e).fontFamily); });
    if (cs) out.add(cs.fontFamily);
    return [...out].filter(Boolean).map((f) => [f, f.split(",")[0].replace(/["']/g, "").trim()] as const);
  })();
  const lh = inl("line-height") && !/px|%|em/.test(inl("line-height")) ? inl("line-height") : num(px(val("line-height")) / fs);
  const ls = val("letter-spacing") === "normal" ? "0" : num((px(val("letter-spacing")) / fs) * 100);
  const textLine = val("text-decoration-line");

  // Fill, Stroke, Effects
  const bg = val("background-color");
  const hasFill = !!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
  const bw = px(val("border-top-width")), hasStroke = bw > 0 && val("border-top-style") !== "none";
  const shadowRaw = val("box-shadow");
  const shadow = SHADOW.exec(shadowRaw);
  const hasShadow = shadowRaw !== "none" && !!shadowRaw;
  const layerBlur = /blur\(([\d.]+)px\)/.exec(val("filter"))?.[1];
  const bgBlur = /blur\(([\d.]+)px\)/.exec(val("backdrop-filter"))?.[1];
  const setShadow = (i: number, v: string) => {
    const s = shadow ?? SHADOW.exec("rgba(0, 0, 0, 0.25) 0px 4px 8px 0px")!;
    const f = [s[2], s[3], s[4], s[5] ?? "0"].map(px);
    let color = s[1];
    if (i < 4) f[i] = px(v); else color = v;
    set("box-shadow", `${color} ${f.map((x) => x + "px").join(" ")}`);
  };

  const kind = p.slide?.getAttribute("data-slide") ?? "content";
  const steps = p.slide?.getAttribute("data-steps") ?? "";

  return (
    <Tabs value={p.tab} onValueChange={p.onTab}>
      <TabsList>
        <TabItem value="props" label="Design" />
        <TabItem value="comments" label={`Comments${p.comments.length ? " " + p.comments.length : ""}`} />
      </TabsList>
      <TabPanel value="props">
        {!el ? (
          <div className="-mx-3 flex flex-col pt-1" key="slide">
            <InspectorSection id="slide" title="Slide">
              <Grid>
                <div className="col-span-2"><Pick label="Type" value={KINDS.some(([k]) => k === kind) ? kind : "content"} items={KINDS} onChange={(v) => p.onAttr("data-slide", v)} /></div>
                <div className="col-span-2"><Field aria-label="Chapter title" placeholder="Chapter title" defaultValue={p.slide?.getAttribute("data-title") ?? ""} onChange={(e) => p.onAttr("data-title", e.target.value || null)} /></div>
                <div className="col-span-2">
                  <NumberField label={<Frame />} aria-label="Steps" unit="" min={1} step={1} value={steps || "1"} muted={!steps}
                    onChange={(v) => p.onAttr("data-steps", +v > 1 ? String(Math.round(+v)) : null)} />
                </div>
              </Grid>
            </InspectorSection>
            <InspectorSection id="slide-bg" title="Background">
              <ColorField aria-label="Background" allowNone
                value={p.slide?.style.getPropertyValue("background-color") ?? ""}
                onChange={(v) => p.onSlideStyle("background-color", v)} />
            </InspectorSection>
          </div>
        ) : (
          <div className="-mx-3 flex flex-col pt-1" key={p.selId}>
            <InspectorSection id="align" title="Align">
              <div className="flex gap-0.5">
                {([["Align left", AlignStartVertical, () => alignH("start")], ["Align horizontal center", AlignCenterVertical, () => alignH("center")], ["Align right", AlignEndVertical, () => alignH("end")],
                  ["Align top", AlignStartHorizontal, () => alignV("start")], ["Align vertical center", AlignCenterHorizontal, () => alignV("center")], ["Align bottom", AlignEndHorizontal, () => alignV("end")]] as const).map(([l, I, f], i) => (
                  <Tooltip key={l} content={l} side="top">
                    <Button aria-label={l} variant="ghost" size="icon-compact" className="flex-1" disabled={i > 2 && !canV} onClick={f}><I /></Button>
                  </Tooltip>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection id="layout" title="Layout">
              <Pick label="Display" value={display} items={DISPLAYS} onChange={(v) => set("display", v)} />
              <Grid>
                {n("width", "W", "Width", { min: 0 })}
                {n("height", "H", "Height", { min: 0 })}
                <SegmentedControl aria-label="Width mode" value={mode("width")} onChange={(m) => setMode("width", m)} options={MODES} />
                <SegmentedControl aria-label="Height mode" value={mode("height")} onChange={(m) => setMode("height", m)} options={MODES} />
              </Grid>
              {(flex || grid) && (
                <Grid>
                  {flex && (
                    <div className="flex items-center gap-1">
                      <SegmentedControl aria-label="Direction" className="flex-1" value={val("flex-direction").startsWith("column") ? "column" : "row"}
                        onChange={(v) => set("flex-direction", v)} options={[opt("row", ArrowRight, "Row"), opt("column", ArrowDown, "Column")]} />
                      <Toggle on={val("flex-wrap") === "wrap"} label="Wrap" I={WrapText} onClick={() => set("flex-wrap", val("flex-wrap") === "wrap" ? "nowrap" : "wrap")} />
                    </div>
                  )}
                  {flex && <AlignBox direction={val("flex-direction").startsWith("column") ? "column" : "row"} justify={val("justify-content")} align={val("align-items")}
                    onChange={(j, a) => { set("justify-content", j); set("align-items", a); }} />}
                  {n("gap", flex && val("flex-direction").startsWith("column") ? <BetweenVerticalStart /> : <BetweenHorizontalStart />, "Gap", { min: 0 })}
                </Grid>
              )}
              <span className="text-caption text-muted-foreground">Padding</span>
              <SidesField label="Padding" values={side4("padding")} onChange={setSides("padding")} />
              <span className="text-caption text-muted-foreground">Margin</span>
              <SidesField label="Margin" values={side4("margin")} onChange={setSides("margin")} />
              <div className="flex items-center">
                <Switch label="Clip content" checked={val("overflow") === "hidden"} onToggle={() => set("overflow", val("overflow") === "hidden" ? "visible" : "hidden")} />
              </div>
            </InspectorSection>

            <InspectorSection id="position" title="Position" defaultOpen={false}>
              <Pick label="Position" value={val("position")} items={POSITIONS} onChange={(v) => set("position", v)} />
              <Grid>
                {val("position") !== "static" && n("left", "X", "X")}
                {val("position") !== "static" && n("top", "Y", "Y")}
                <NumberField label={<RotateCw />} aria-label="Rotation" unit="" step={1} min={-360} max={360} value={String(parseFloat(val("rotate")) || 0)} muted={!inl("rotate")}
                  onChange={(v) => set("rotate", +v ? `${v}deg` : "")} {...scrub} />
                {n("z-index", "Z", "Z-index", { unit: "" })}
              </Grid>
            </InspectorSection>

            <InspectorSection id="appearance" title="Appearance">
              <Grid>
                <NumberField label={<Blend />} aria-label="Opacity" unit="" min={0} max={100} value={num(+val("opacity") * 100)} muted={!inl("opacity")}
                  onChange={(v) => set("opacity", num(+v / 100))} {...scrub} />
                <NumberField label={<SquareRoundCorner />} aria-label="Corner radius" min={0} value={val("border-top-left-radius")} muted={!inl("border-radius") && !inl("border-top-left-radius")}
                  onChange={(v) => set("border-radius", v)} {...scrub} />
              </Grid>
              <Pick label="Blend mode" value={val("mix-blend-mode")} items={BLENDS} onChange={(v) => set("mix-blend-mode", v)} />
            </InspectorSection>

            {isText && (
              <InspectorSection id="typography" title="Typography">
                <Pick label="Font" value={cs?.fontFamily ?? ""} items={families} onChange={(v) => set("font-family", v)} />
                <Grid>
                  <Pick label="Weight" value={WEIGHTS.some(([w]) => w === val("font-weight")) ? val("font-weight") : String(Math.round(+val("font-weight") / 100) * 100)} items={WEIGHTS} onChange={(v) => set("font-weight", v)} />
                  {n("font-size", <CaseSensitive />, "Font size", { min: 1, max: 400 })}
                  <NumberField label={<ListCollapse />} aria-label="Line height" unit="" step={0.05} min={0} value={lh} muted={!inl("line-height")} onChange={(v) => set("line-height", v)} {...scrub} />
                  <NumberField label={<Space />} aria-label="Letter spacing" unit="" step={0.5} value={ls} muted={!inl("letter-spacing")} onChange={(v) => set("letter-spacing", `${num(+v / 100)}em`)} {...scrub} />
                </Grid>
                <Grid>
                  <SegmentedControl aria-label="Text align" value={["start", "left"].includes(val("text-align")) ? "left" : val("text-align").replace("end", "right")} onChange={(v) => set("text-align", v)}
                    options={[opt("left", TextAlignStart, "Align left"), opt("center", TextAlignCenter, "Align center"), opt("right", TextAlignEnd, "Align right"), opt("justify", TextAlignJustify, "Justify")]} />
                  <div className="flex gap-0.5">
                    <Toggle on={textLine.includes("underline")} label="Underline" I={Underline} onClick={() => set("text-decoration-line", textLine.includes("underline") ? "none" : "underline")} />
                    <Toggle on={textLine.includes("line-through")} label="Strikethrough" I={Strikethrough} onClick={() => set("text-decoration-line", textLine.includes("line-through") ? "none" : "line-through")} />
                  </div>
                </Grid>
                <SegmentedControl aria-label="Text case" value={val("text-transform")} onChange={(v) => set("text-transform", v)}
                  options={[opt("none", CaseSensitive, "None"), opt("uppercase", CaseUpper, "Uppercase"), opt("lowercase", CaseLower, "Lowercase"), opt("capitalize", ALargeSmall, "Capitalize")]} />
              </InspectorSection>
            )}

            <InspectorSection id="fill" title="Fill" action={!hasFill && !isMedia ? (
              <Tooltip content="Add fill" side="top"><Button aria-label="Add fill" variant="ghost" size="icon-compact" onClick={() => set("background-color", "#ffffff")}><Plus /></Button></Tooltip>) : undefined}>
              {(isText || container) && (
                <div className="flex items-center gap-1">
                  <span className="w-4 shrink-0 text-muted-foreground [&_svg]:size-3.5"><Type /></span>
                  <div className="min-w-0 flex-1"><ColorField aria-label="Text color" value={val("color")} onChange={(v) => set("color", v)} /></div>
                </div>
              )}
              {hasFill && (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1"><ColorField aria-label="Fill" value={bg} onChange={(v) => set("background-color", v)} /></div>
                  <Tooltip content="Remove fill" side="top"><Button aria-label="Remove fill" variant="ghost" size="icon-compact" onClick={() => set("background-color", "transparent")}><Minus /></Button></Tooltip>
                </div>
              )}
            </InspectorSection>

            <InspectorSection id="stroke" title="Stroke" action={!hasStroke ? (
              <Tooltip content="Add stroke" side="top"><Button aria-label="Add stroke" variant="ghost" size="icon-compact" onClick={() => set("border", "1px solid #000000")}><Plus /></Button></Tooltip>) : undefined}>
              {hasStroke && (
                <>
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1"><ColorField aria-label="Stroke color" value={val("border-top-color")} onChange={(v) => set("border-color", v)} /></div>
                    <Tooltip content="Remove stroke" side="top"><Button aria-label="Remove stroke" variant="ghost" size="icon-compact" onClick={() => set("border", "none")}><Minus /></Button></Tooltip>
                  </div>
                  <Grid>
                    {n("border-top-width", <MoveHorizontal />, "Stroke width", { min: 0 })}
                    <Pick label="Stroke style" value={val("border-top-style")} items={BORDER_STYLES} onChange={(v) => set("border-style", v)} />
                  </Grid>
                </>
              )}
            </InspectorSection>

            <InspectorSection id="effects" title="Effects" action={(
              <DropdownMenu open={fxMenu} onOpenChange={setFxMenu} size="compact">
                <DropdownTrigger render={<Button aria-label="Add effect" variant="ghost" size="icon-compact"><Plus /></Button>} />
                <DropdownContent align="end" side="bottom">
                  <MenuItem index={0} icon={LayersIcon} label="Drop shadow" onSelect={() => set("box-shadow", "0px 4px 8px 0px rgba(0, 0, 0, 0.25)")} />
                  <MenuItem index={1} icon={Droplets} label="Layer blur" onSelect={() => set("filter", "blur(4px)")} />
                  <MenuItem index={2} icon={Droplets} label="Background blur" onSelect={() => set("backdrop-filter", "blur(8px)")} />
                </DropdownContent>
              </DropdownMenu>
            )}>
              {hasShadow && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-caption text-muted-foreground">Drop shadow</span>
                    <Tooltip content="Remove effect" side="top"><Button aria-label="Remove drop shadow" variant="ghost" size="icon-compact" onClick={() => set("box-shadow", "none")}><Minus /></Button></Tooltip>
                  </div>
                  {shadow ? (
                    <>
                      <Grid>
                        <NumberField label="X" aria-label="Shadow X" value={shadow[2] + "px"} onChange={(v) => setShadow(0, v)} {...scrub} />
                        <NumberField label="Y" aria-label="Shadow Y" value={shadow[3] + "px"} onChange={(v) => setShadow(1, v)} {...scrub} />
                        <NumberField label="B" aria-label="Shadow blur" min={0} value={shadow[4] + "px"} onChange={(v) => setShadow(2, v)} {...scrub} />
                        <NumberField label="S" aria-label="Shadow spread" value={(shadow[5] ?? "0") + "px"} onChange={(v) => setShadow(3, v)} {...scrub} />
                      </Grid>
                      <ColorField aria-label="Shadow color" value={shadow[1]} onChange={(v) => setShadow(4, v)} />
                    </>
                  ) : <span className="text-caption text-muted-foreground">Custom shadow</span>}
                </>
              )}
              {layerBlur !== undefined && (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1"><NumberField label={<Droplets />} aria-label="Layer blur" min={0} value={layerBlur + "px"} onChange={(v) => set("filter", `blur(${px(v)}px)`)} {...scrub} /></div>
                  <Tooltip content="Remove effect" side="top"><Button aria-label="Remove layer blur" variant="ghost" size="icon-compact" onClick={() => set("filter", "none")}><Minus /></Button></Tooltip>
                </div>
              )}
              {bgBlur !== undefined && (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1"><NumberField label={<EyeOff />} aria-label="Background blur" min={0} value={bgBlur + "px"} onChange={(v) => set("backdrop-filter", `blur(${px(v)}px)`)} {...scrub} /></div>
                  <Tooltip content="Remove effect" side="top"><Button aria-label="Remove background blur" variant="ghost" size="icon-compact" onClick={() => set("backdrop-filter", "none")}><Minus /></Button></Tooltip>
                </div>
              )}
            </InspectorSection>
          </div>
        )}
      </TabPanel>
      <TabPanel value="comments">
        <div className="flex flex-col gap-2 pt-3">
          {p.comments.length === 0 && <p className="text-caption text-muted-foreground">Select an element and leave a comment</p>}
          {p.comments.map((c) => (
            <button key={c.id} onClick={() => p.onJump(c)} className="flex flex-col gap-0.5 rounded-lg bg-hover p-2 text-left">
              <span className="truncate text-micro text-muted-foreground">{c.slideDeleted ? "Slide deleted" : c.slide} {c.excerpt}</span>
              <span className="whitespace-pre-wrap text-body">{c.text}</span>
              {c.reply && <span className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 text-body text-muted-foreground">{c.reply}</span>}
              {!c.reply && c.status === "open" && <span className="text-micro text-muted-foreground">Waiting for a reply</span>}
            </button>
          ))}
        </div>
      </TabPanel>
    </Tabs>
  );
}
