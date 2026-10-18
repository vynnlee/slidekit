import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDown, ArrowRight, Blend, CaseLower, CaseSensitive, CaseUpper, ALargeSmall, Droplets, Expand, EyeOff, Layers as LayersIcon,
  Minus, Plus, RotateCw, Shrink, Square, SquareRoundCorner, Strikethrough, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart,
  Underline, WrapText, Scan, Spline, Footprints, Ban, MoveHorizontal, ListCollapse, Space, BetweenHorizontalStart, BetweenVerticalStart, Type,
  Play, Link2, Unlink2, Columns3,
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
import { Card, CardGroup, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { textual } from "./Canvas";
import { iconOf, nameOf } from "./LayerTree";
import { readTranslate } from "@/lib/move";
import { TEXT_STYLES, currentTextStyle } from "@/lib/text-styles";
import { AnimationSection } from "./AnimationSection";
import { parseGradient, serializeGradient, type Gradient } from "@/lib/gradient";
import { GradientEditor } from "@/components/ui/gradient-editor";
import { TokensPanel } from "./TokensPanel";
import { CommentsPanel } from "./CommentsPanel";
import type { Comment } from "@/lib/deck";

type Items = readonly (readonly [string, string])[];

const KINDS: Items = [["cover", "Cover"], ["chapter", "Chapter"], ["content", "Content"], ["end", "End"]];
const WEIGHTS: Items = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]];
const DISPLAYS: Items = [["block", "Block"], ["flex", "Flex"], ["grid", "Grid"], ["inline", "Inline"], ["inline-block", "Inline block"], ["inline-flex", "Inline flex"], ["none", "None"]];
const POSITIONS: Items = [["static", "Static"], ["relative", "Relative"], ["absolute", "Absolute"]];
const BLENDS: Items = [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["difference", "Difference"]];
const FITS: Items = [["fill", "Fill"], ["contain", "Contain"], ["cover", "Cover"], ["none", "None"]];
const OBJECT_POSITIONS: Items = [["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]];
const POSITION_OF: Record<string, string> = { "50% 50%": "center", "50% 0%": "top", "50% 100%": "bottom", "0% 50%": "left", "100% 50%": "right" };
const BORDER_STYLES: Items = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];

// 클래스나 인라인이 이 축의 크기를 정했는지 알아보려고 auto로 바꿔 재 본다(재고 나서 style 속성은 원래대로 돌린다).
const isAuto = (el: HTMLElement, axis: "width" | "height") => {
  if (el.style.getPropertyValue(axis)) return false;
  const orig = el.getAttribute("style"), before = el.getBoundingClientRect()[axis];
  el.style.setProperty(axis, "auto", "important");
  const after = el.getBoundingClientRect()[axis];
  if (orig === null) el.removeAttribute("style"); else el.setAttribute("style", orig);
  return Math.abs(after - before) < 0.5;
};

// 슬라이드 루트 아래 몇 단계인지(최상위 요소는 1). 선택 규칙 검증에 쓴다.
const depthOf = (el: Element, root: Element | null) => { let d = 0; for (let n: Element | null = el; n && n !== root; n = n.parentElement) d++; return d; };

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
  return <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">{children}</div>;
}

type Props = {
  sel: Element | null;
  slide: HTMLElement | null;
  selId: number; // 선택이 바뀔 때마다 늘어 입력값을 다시 읽는다
  tab: string;
  onTab(t: string): void;
  comments: Comment[];
  onJump(c: Comment): void;
  channel: boolean | null;
  more: Element[]; // 다중 선택의 나머지(같은 부모). 편집은 모두에 적용된다
  onAlignGroup(axis: "h" | "v", where: "start" | "center" | "end"): void; // 묶음 전체의 상자를 기준으로 정렬
  onResolve(c: Comment, resolved: boolean): void;
  onTrust?(c: Comment): void;
  onRemove?(c: Comment): void;
  onImageFile(file: File): void; // 선택한 이미지의 src를 고른 파일로 바꾼다
  onRevert?(c: Comment, undo?: boolean): void;
  folder?: string; // 영역 코멘트의 이미지를 불러올 덱 폴더
  onSendAll?(): void;
  onResolveReplied?(): void;
  /** 코멘트 모드를 켠다(빈 패널의 Start commenting) */
  onStartComment?(): void;
  onStyle(prop: string, value: string): void;
  onAnim(edits: [HTMLElement, import("@/lib/animation-model").StepSpec][], key?: string): void; // 단계 사양을 쓴다(실행 취소 한 건)
  onStyles(map: Record<string, string>): void; // 여러 속성을 한 번에(실행 취소 한 건)
  onAttr(name: string, value: string | null): void;
  onElAttr(name: string, value: string | null): void;
  onShowLayers(): void;
  prefix: string;
  onPrefixChange(next: string): void;
  canvasDoc: Document | null;
  onSlideStyle(prop: string, value: string): void;
  onScrub(on: boolean): void;
};

type Shadow = { color: string; x: number; y: number; b: number; s: number; inset: boolean };
const SH = /^(?:(inset)\s+)?(rgba?\([^)]*\)|#[0-9a-f]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?(?:\s+(inset))?$/i;
const splitTop = (v: string) => {
  const out: string[] = []; let d = 0, cur = "";
  for (const c of v) { if (c === "(") d++; if (c === ")") d--; if (c === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c; }
  out.push(cur.trim());
  return out;
};
// 모두 읽을 수 있을 때만 목록을 돌려준다(그렇지 않으면 null)
const parseShadows = (raw: string): Shadow[] | null => {
  if (!raw || raw === "none") return [];
  const out: Shadow[] = [];
  for (const part of splitTop(raw)) {
    const m = SH.exec(part);
    if (!m) return null;
    out.push({ color: m[2], x: +m[3], y: +m[4], b: +m[5], s: +(m[6] ?? 0), inset: !!(m[1] || m[7]) });
  }
  return out;
};
const fmtShadow = (s: Shadow) => `${s.color} ${s.x}px ${s.y}px ${s.b}px ${s.s}px${s.inset ? " inset" : ""}`;
const SIDES = ["top", "right", "bottom", "left"] as const;
export function Inspector(p: Props) {
  const el = p.sel as HTMLElement | null;
  const [, bump] = useState(0);
  useEffect(() => bump((n) => n + 1), [el, p.selId]);
  // 비율 잠금(편집기 세션 상태, 문서에 저장하지 않는다): 잠글 때의 가로세로 비율을 기억하고 선택이 바뀌면 풀린다.
  const [lock, setLock] = useState<number | null>(null);
  useEffect(() => setLock(null), [el, p.selId]);
  const [fxMenu, setFxMenu] = useState(false);
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [sidesOpen, setSidesOpen] = useState(false);

  const win = el?.ownerDocument.defaultView ?? null;
  const cs = el && win ? win.getComputedStyle(el) : null;
  const parent = el?.parentElement && win ? win.getComputedStyle(el.parentElement) : null;
  const inl = (prop: string) => el?.style.getPropertyValue(prop) ?? "";
  // 인라인 값이 var()이면 숫자 칸이 읽을 수 있게 계산값을 보인다(색 칸은 var()를 직접 읽는다)
  const val = (prop: string) => { const v = inl(prop); return v && (!/var\(/.test(v) || /color|background-image|shadow/.test(prop)) ? v : cs?.getPropertyValue(prop) || v; };
  const set = (prop: string, v: string) => { p.onStyle(prop, v); bump((n) => n + 1); };
  const multi = p.more.length > 0;
  const imgInput = useRef<HTMLInputElement>(null);
  // 다중 선택에서 대표와 값이 다른 요소가 있으면 Mixed로 보인다
  const mixedOf = (prop: string) => multi && !!win && p.more.some((m) => ((m as HTMLElement).style.getPropertyValue(prop) || win.getComputedStyle(m).getPropertyValue(prop)) !== val(prop));
  const scrub = { onScrubStart: () => p.onScrub(true), onScrubEnd: () => p.onScrub(false) };

  // 계산값 그대로 쓰는 일반 숫자 필드
  const n = (prop: string, label: ReactNode, aria: string, { on, show, ...o }: { unit?: string; step?: number; min?: number; max?: number; on?: (v: string) => void; show?: string } = {}) => (
    <NumberField label={label} aria-label={aria} value={show ?? val(prop)} mixed={mixedOf(prop)} muted={!inl(prop)} dirty={!!inl(prop)} onReset={() => set(prop, "")} onChange={(v) => (on ? on(v) : set(prop, v))} {...scrub} {...o} />
  );

  // 글자 색 대비를 재는 배경: 슬라이드(없으면 문서 body)의 불투명한 배경색
  const slideBg = (() => {
    for (const n of [p.slide, p.slide?.ownerDocument.body]) {
      const c = n && win ? win.getComputedStyle(n).backgroundColor : "";
      if (c && c !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return "#000000";
  })();
  const slideGrad = parseGradient(p.slide?.style.getPropertyValue("background-image") ?? "");
  const [tx, ty] = el ? readTranslate(el) : [0, 0];
  const setOffset = (x: number, y: number) => set("translate", !x && !y ? "" : `${x}px ${y}px`);
  const isText = !!el && textual(el);
  const SelIcon = el ? iconOf(el) : Square;
  const isMedia = !!el && (el.tagName === "IMG" || el instanceof SVGElement);
  const container = !!el && !isText && !isMedia;
  const display = val("display");
  const flex = display === "flex" || display === "inline-flex";
  const grid = display === "grid";
  const parentFlexRow = !!parent && parent.display.includes("flex") && !parent.flexDirection.startsWith("column");
  const parentFlexCol = !!parent && parent.display.includes("flex") && parent.flexDirection.startsWith("column");
  const parentGrid = parent?.display === "grid";

  // 정렬 바: 부모 display에 따라 쓰는 속성이 다르다. 효과가 없는 조합은 막고 이유를 툴팁에 쓴다.
  const parentFlex = parentFlexRow || parentFlexCol;
  const blockParent = !parentFlex && !parentGrid;
  const hHow = parentFlexRow ? "auto margins" : parentGrid ? "justify-self" : parentFlexCol ? "align-self" : isText ? "text-align" : "auto margins";
  const vHow = parentFlexCol ? "auto margins" : "align-self";
  const hOff = !multi && blockParent && !isText && !!el && isAuto(el, "width") ? "Set a width first, a full-width block has no room to move" : "";
  const vOff = !multi && blockParent ? "Needs a flex or grid parent" : "";
  const autoMargins = (side: "h" | "v", where: "start" | "center" | "end") => {
    const [a, b] = side === "h" ? ["margin-left", "margin-right"] : ["margin-top", "margin-bottom"];
    set(a, where === "start" ? "0" : "auto"); set(b, where === "end" ? "0" : "auto");
  };
  const alignH = (where: "start" | "center" | "end") => {
    if (multi) return p.onAlignGroup("h", where);
    if (parentFlexRow) autoMargins("h", where);
    else if (parentFlexCol || parentGrid) set(parentGrid ? "justify-self" : "align-self", where === "start" ? "flex-start" : where === "end" ? "flex-end" : "center");
    else if (isText) set("text-align", where === "start" ? "left" : where === "end" ? "right" : "center");
    else autoMargins("h", where);
  };
  const alignV = (where: "start" | "center" | "end") => {
    if (multi) return p.onAlignGroup("v", where);
    if (parentFlexCol) autoMargins("v", where);
    else if (parentFlexRow || parentGrid) set("align-self", where === "start" ? "flex-start" : where === "end" ? "flex-end" : "center");
  };

  // 열 수: 직접 쓴 repeat(N, ...)는 N, 계산값(트랙 크기 목록)은 트랙 개수
  const colCount = (v: string) => String(/^repeat\(\s*(\d+)/.exec(v)?.[1] ?? (v.split(/\s+/).filter((t) => t && t !== "none").length || 1));
  // 한 축을 바꾸면 잠긴 비율대로 다른 축도 함께 바꾼다(실행 취소 한 건). 잠기지 않았거나 Fill인 축이 있으면 그 축만 바꾼다(Hug인 축은 고정 크기가 된다).
  const setSize = (axis: "width" | "height", v: string) => {
    const other = axis === "width" ? "height" : "width", num = parseFloat(v);
    if (!lock || !Number.isFinite(num) || mode(other) === "fill" || mode(axis) === "fill") { set(axis, v); return; }
    const unit = v.replace(/^[\d.\s-]+/, "") || "px";
    const o = axis === "width" ? num / lock : num * lock;
    p.onStyles({ [axis]: v, [other]: `${Math.round(o * 100) / 100}${unit}` });
    bump((n) => n + 1);
  };
  // 크기 모드: Fixed, Hug, Fill
  const mode = (axis: "width" | "height") => {
    const v = inl(axis);
    if (v === "auto" || v === "fit-content" || v === "max-content") return "hug";
    if (v === "100%" || (axis === "width" ? parentFlexRow : parentFlexCol) && inl("flex").startsWith("1 1")) return "fill";
    if (!v) return el && isAuto(el, axis) ? "hug" : "fixed"; // 설정이 없으면 auto(내용 크기)이거나 클래스가 정한 크기다
    return "fixed";
  };
  const setMode = (axis: "width" | "height", m: string) => {
    const main = axis === "width" ? parentFlexRow : parentFlexCol;
    if (m === "fixed") { set("flex", ""); set(axis, Math.round(px(cs?.getPropertyValue(axis) ?? "0")) + "px"); }
    else if (m === "hug") { set("flex", ""); set(axis, "fit-content"); }
    else if (main) { set(axis, ""); set("flex", "1 1 0"); }
    else set(axis, "100%");
  };
  const modes = (axis: string) => [opt("fixed", Square, `Fixed ${axis}`), opt("hug", Shrink, "Hug contents"), opt("fill", Expand, "Fill container")];

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
  const hasStroke = SIDES.some((x) => px(val(`border-${x}-width`)) > 0 && val(`border-${x}-style`) !== "none");
  const bgImg = inl("background-image");
  const grad = parseGradient(bgImg);
  const setGrad = (g: Gradient) => set("background-image", serializeGradient(g));
  const hasFill = !!grad || (!!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent");
  const shadows = parseShadows(val("box-shadow"));
  const setShadows = (l: Shadow[]) => set("box-shadow", l.length ? l.map(fmtShadow).join(", ") : "none");
  const patchShadow = (i: number, patch: Partial<Shadow>) => shadows && setShadows(shadows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const layerBlur = /blur\(([\d.]+)px\)/.exec(val("filter"))?.[1];
  const bgBlur = /blur\(([\d.]+)px\)/.exec(val("backdrop-filter"))?.[1];

  const kind = p.slide?.getAttribute("data-slide") ?? "content";
  const openCount = p.comments.filter((c) => !c.resolved && c.status === "open").length;
  const bgNone = !p.slide?.style.getPropertyValue("background-color");
  const autoSteps = Math.max(1, ...[...(p.slide?.querySelectorAll("[data-step]") ?? [])].map((e) => parseInt(e.getAttribute("data-step") ?? "1", 10) || 1));

  return (
    <Tabs value={p.tab} onValueChange={p.onTab}>
      <TabsList>
        <TabItem value="props" label="Design" />
        <TabItem value="comments" label={`Comments${openCount ? " " + openCount : ""}`} />
      </TabsList>
      <TabPanel value="props">
        {!el ? (
          <div className="-mx-3 flex flex-col pt-1" key="slide">
            <InspectorSection id="slide" title="Slide">
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted-foreground">Type</span>
                <Pick label="Type" value={KINDS.some(([k]) => k === kind) ? kind : "content"} items={KINDS} onChange={(v) => p.onAttr("data-slide", v)} />
              </div>
              {kind === "chapter" && (
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-muted-foreground">Chapter title</span>
                  <Field aria-label="Chapter title" placeholder="Shown in the table of contents" defaultValue={p.slide?.getAttribute("data-title") ?? ""} onChange={(e) => p.onAttr("data-title", e.target.value || null)} />
                </div>
              )}
              {autoSteps > 1 && <span className="text-micro text-muted-foreground">{autoSteps - 1} {autoSteps > 2 ? "clicks" : "click"} (from animations)</span>}
            </InspectorSection>
            <InspectorSection id="slide-bg" title="Background">
              <SegmentedControl aria-label="Background type" value={slideGrad ? "linear" : "solid"}
                onChange={(v) => {
                  if (v === "solid") p.onSlideStyle("background-image", "");
                  else if (!slideGrad) p.onSlideStyle("background-image", serializeGradient({ angle: 180, stops: [{ color: p.slide?.style.getPropertyValue("background-color") || "#000000", pos: 0 }, { color: "#ffffff", pos: 100 }] }));
                }}
                options={[opt("solid", Square, "Solid"), opt("linear", Spline, "Linear gradient")]} />
              {slideGrad
                ? <GradientEditor label="Background gradient" value={slideGrad} onChange={(g) => p.onSlideStyle("background-image", serializeGradient(g))} onScrub={p.onScrub} />
                : <ColorField aria-label="Background" allowNone
                    className={bgNone ? "[&_input[aria-label$='opacity_percent']]:hidden" : undefined}
                    value={p.slide?.style.getPropertyValue("background-color") ?? ""}
                    onChange={(v) => p.onSlideStyle("background-color", v)} />}
            </InspectorSection>
            <TokensPanel prefix={p.prefix} onPrefixChange={p.onPrefixChange} canvas={p.canvasDoc} />
          </div>
        ) : (
          <div className="-mx-3 flex flex-col pt-1" key={p.selId}>
            <div className="px-4 pb-2">
              <Tooltip content="Show in Layers" side="top">
                <Button aria-label="Show in layers" data-depth={depthOf(el, p.slide)} variant="ghost" size="compact" leadingIcon={SelIcon} className="w-full justify-start" onClick={p.onShowLayers}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 truncate text-left">{multi ? `${p.more.length + 1} layers` : nameOf(el)}</span>
                    {!multi && <span className="shrink-0 rounded bg-surface-2 px-1 text-micro text-muted-foreground">{el.tagName.toLowerCase()}</span>}
                  </span>
                </Button>
              </Tooltip>
            </div>
            <InspectorSection id="align" title="Align">
              <div className="flex gap-0.5">
                {([["Align left", AlignStartVertical, () => alignH("start")], ["Align horizontal center", AlignCenterVertical, () => alignH("center")], ["Align right", AlignEndVertical, () => alignH("end")],
                  ["Align top", AlignStartHorizontal, () => alignV("start")], ["Align vertical center", AlignCenterHorizontal, () => alignV("center")], ["Align bottom", AlignEndHorizontal, () => alignV("end")]] as const).map(([l, I, f], i) => (
                  <Tooltip key={l} content={(i < 3 ? hOff : vOff) || `${l} (sets ${i < 3 ? hHow : vHow})`} side="top">
                    <span className="flex flex-1"><Button aria-label={l} variant="ghost" size="icon-compact" className="flex-1" disabled={!!(i < 3 ? hOff : vOff)} onClick={f}><I /></Button></span>
                  </Tooltip>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection id="layout" title="Layout">
              <Pick label="Display" value={display} items={DISPLAYS} onChange={(v) => set("display", v)} />
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1"><Grid>
                  {n("width", "W", "Width", { min: 0, on: (v) => setSize("width", v) })}
                  {n("height", "H", "Height", { min: 0, on: (v) => setSize("height", v) })}
                </Grid></div>
                <Tooltip content={lock ? "Unlock aspect ratio" : "Lock aspect ratio"} side="top">
                  <Button aria-label="Lock aspect ratio" aria-pressed={!!lock} variant={lock ? "secondary" : "ghost"} size="icon-compact" disabled={p.more.length > 0 || !el}
                    onClick={() => setLock(lock ? null : el && el.offsetHeight ? el.offsetWidth / el.offsetHeight : null)}>
                    {lock ? <Link2 /> : <Unlink2 />}
                  </Button>
                </Tooltip>
              </div>
              <Grid>
                <SegmentedControl aria-label="Width mode" value={mode("width")} onChange={(m) => setMode("width", m)} options={modes("width")} />
                <SegmentedControl aria-label="Height mode" value={mode("height")} onChange={(m) => setMode("height", m)} options={modes("height")} />
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
                  {grid && n("grid-template-columns", <span title="Columns" className="flex"><Columns3 /></span>, "Columns", { min: 1, max: 12, step: 1, unit: "", show: colCount(val("grid-template-columns")), on: (v) => { const c = Math.max(1, Math.min(12, Math.round(parseFloat(v)) || 1)); set("grid-template-columns", `repeat(${c}, 1fr)`); } })}
                  {n("gap", <span title="Gap" className="flex">{flex && val("flex-direction").startsWith("column") ? <BetweenVerticalStart /> : <BetweenHorizontalStart />}</span>, "Gap", { min: 0 })}
                </Grid>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted-foreground">Padding</span>
                <SidesField label="Padding" values={side4("padding")} onChange={setSides("padding")} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted-foreground">Margin</span>
                <SidesField label="Margin" values={side4("margin")} onChange={setSides("margin")} />
              </div>
              <div className="flex items-center">
                <Switch label="Clip content" checked={val("overflow") === "hidden"} onToggle={() => set("overflow", val("overflow") === "hidden" ? "visible" : "hidden")} />
              </div>
            </InspectorSection>

            <InspectorSection id="position" title="Position">
              <div className="flex flex-col gap-1">
                <span className="text-micro text-muted-foreground">Offset</span>
                <Grid>
                  <NumberField label="X" aria-label="Offset X" value={Number.isFinite(tx) ? `${tx}px` : ""} mixed={!Number.isFinite(tx)} muted={!inl("translate")} dirty={!!inl("translate")} onReset={() => set("translate", "")}
                    onChange={(v) => setOffset(px(v), Number.isFinite(ty) ? ty : 0)} {...scrub} />
                  <NumberField label="Y" aria-label="Offset Y" value={Number.isFinite(ty) ? `${ty}px` : ""} mixed={!Number.isFinite(ty)} muted={!inl("translate")} dirty={!!inl("translate")} onReset={() => set("translate", "")}
                    onChange={(v) => setOffset(Number.isFinite(tx) ? tx : 0, px(v))} {...scrub} />
                </Grid>
              </div>
              <Pick label="Position" value={val("position")} items={POSITIONS} onChange={(v) => set("position", v)} />
              <Grid>
                {val("position") !== "static" && n("left", "X", "X")}
                {val("position") !== "static" && n("top", "Y", "Y")}
                <NumberField label={<RotateCw />} aria-label="Rotation" unit="" step={1} min={-360} max={360} value={String(parseFloat(val("rotate")) || 0)} muted={!inl("rotate")}
                  onChange={(v) => set("rotate", +v ? `${v}deg` : "")} {...scrub} />
                {n("z-index", "Z", "Z-index", { unit: "" })}
              </Grid>
            </InspectorSection>

            <InspectorSection id="appearance" title="Appearance" action={(
              <Toggle on={radiusOpen} label="Individual corners" I={Scan} onClick={() => setRadiusOpen((v) => !v)} />)}>
              <Grid>
                <NumberField label={<Blend />} aria-label="Opacity" unit="" suffix="%" min={0} max={100} value={num(+val("opacity") * 100)} muted={!inl("opacity")}
                  dirty={!!inl("opacity")} onReset={() => set("opacity", "")} onChange={(v) => set("opacity", num(+v / 100))} {...scrub} />
                {!radiusOpen && (
                  <NumberField label={<SquareRoundCorner />} aria-label="Corner radius" min={0} value={val("border-top-left-radius")} muted={!inl("border-radius") && !inl("border-top-left-radius")}
                    dirty={!!inl("border-radius") || !!inl("border-top-left-radius")}
                    onReset={() => { set("border-radius", ""); ["top-left", "top-right", "bottom-left", "bottom-right"].forEach((c) => set(`border-${c}-radius`, "")); }}
                    onChange={(v) => set("border-radius", v)} {...scrub} />
                )}
                {radiusOpen && ([["TL", "top-left", "Top left"], ["TR", "top-right", "Top right"], ["BL", "bottom-left", "Bottom left"], ["BR", "bottom-right", "Bottom right"]] as const).map(([l, c, name]) => (
                  <NumberField key={c} label={l} aria-label={`${name} radius`} min={0} value={val(`border-${c}-radius`)} muted={!inl(`border-${c}-radius`) && !inl("border-radius")}
                    onChange={(v) => set(`border-${c}-radius`, v)} {...scrub} />
                ))}
              </Grid>
              <Pick label="Blend mode" value={val("mix-blend-mode")} items={BLENDS} onChange={(v) => set("mix-blend-mode", v)} />
            </InspectorSection>

            <InspectorSection id="animation" title="Animation">
              <AnimationSection els={[el, ...p.more] as HTMLElement[]} slide={p.slide as HTMLElement | null} onAnim={p.onAnim} />
            </InspectorSection>

            {el.tagName === "IMG" && (
              <InspectorSection id="image" title="Image">
                <input ref={imgInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Choose image file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) p.onImageFile(f); }} />
                <Button variant="secondary" size="compact" className="w-full" onClick={() => imgInput.current?.click()}>Replace image...</Button>
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-muted-foreground">Fit</span>
                  <Pick label="Image fit" value={val("object-fit")} items={FITS} onChange={(v) => set("object-fit", v)} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-muted-foreground">Position</span>
                  <Pick label="Image position" value={POSITION_OF[val("object-position")] ?? "center"} items={OBJECT_POSITIONS} onChange={(v) => set("object-position", v)} />
                </div>
              </InspectorSection>
            )}

            {isText && (
              <InspectorSection id="typography" title="Typography">
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-muted-foreground">Text style</span>
                  <Pick label="Text style" value={currentTextStyle(inl)?.id ?? (TEXT_STYLES.some((t) => Object.keys(t.props).some((k) => inl(k))) ? "custom" : "none")}
                    items={[["none", "None"], ...TEXT_STYLES.map((t) => [t.id, t.label] as const), ["custom", "Custom"]]}
                    onChange={(v) => { const t = TEXT_STYLES.find((x) => x.id === v); if (t) { p.onStyles(t.props); bump((n) => n + 1); } }} />
                </div>
                <Pick label="Font" value={cs?.fontFamily ?? ""} items={families} onChange={(v) => set("font-family", v)} />
                <Pick label="Weight" value={WEIGHTS.some(([w]) => w === val("font-weight")) ? val("font-weight") : String(Math.round(+val("font-weight") / 100) * 100)} items={WEIGHTS} onChange={(v) => set("font-weight", v)} />
                <Grid>
                  {n("font-size", <ALargeSmall />, "Font size", { min: 1, max: 400 })}
                  <NumberField label={<ListCollapse />} aria-label="Line height" unit="" step={0.05} min={0} value={lh} muted={!inl("line-height")} dirty={!!inl("line-height")} onReset={() => set("line-height", "")} onChange={(v) => set("line-height", v)} {...scrub} />
                  <NumberField label={<Space />} aria-label="Letter spacing" unit="" suffix="%" step={0.5} value={ls} muted={!inl("letter-spacing")} dirty={!!inl("letter-spacing")} onReset={() => set("letter-spacing", "")} onChange={(v) => set("letter-spacing", `${num(+v / 100)}em`)} {...scrub} />
                  <div className="flex items-center gap-0.5">
                    <Toggle on={textLine.includes("underline")} label="Underline" I={Underline} onClick={() => set("text-decoration-line", textLine.includes("underline") ? "none" : "underline")} />
                    <Toggle on={textLine.includes("line-through")} label="Strikethrough" I={Strikethrough} onClick={() => set("text-decoration-line", textLine.includes("line-through") ? "none" : "line-through")} />
                  </div>
                </Grid>
                <Grid>
                  <SegmentedControl aria-label="Text align" value={["start", "left"].includes(val("text-align")) ? "left" : val("text-align").replace("end", "right")} onChange={(v) => set("text-align", v)}
                    options={[opt("left", TextAlignStart, "Text align left"), opt("center", TextAlignCenter, "Text align center"), opt("right", TextAlignEnd, "Text align right"), opt("justify", TextAlignJustify, "Justify text")]} />
                  <SegmentedControl aria-label="Text case" value={val("text-transform")} onChange={(v) => set("text-transform", v)}
                    options={[opt("none", Ban, "No case change"), opt("uppercase", CaseUpper, "Uppercase"), opt("lowercase", CaseLower, "Lowercase"), opt("capitalize", CaseSensitive, "Capitalize")]} />
                </Grid>
              </InspectorSection>
            )}

            {!isMedia && (
            <InspectorSection id="fill" title="Fill" action={!hasFill ? (
              <Tooltip content="Add fill" side="top"><Button aria-label="Add fill" variant="ghost" size="icon-compact" onClick={() => set("background-color", "#ffffff")}><Plus /></Button></Tooltip>) : undefined}>
              {(isText || container) && (
                <div className="flex flex-col gap-1">
                  <span className="text-micro text-muted-foreground">Text color</span>
                  <ColorField aria-label="Text color" value={val("color")} onChange={(v) => set("color", v)} contrastBg={slideBg} />
                </div>
              )}
              {hasFill && (
                <>
                  <div className="flex items-center gap-1">
                    <SegmentedControl aria-label="Fill type" className="flex-1" value={grad ? "linear" : "solid"}
                      onChange={(v) => {
                        if (v === "solid") set("background-image", "");
                        else if (!grad) setGrad({ angle: 180, stops: [{ color: hasFill && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff", pos: 0 }, { color: "#000000", pos: 100 }] });
                      }}
                      options={[opt("solid", Square, "Solid"), opt("linear", Spline, "Linear gradient")]} />
                    <Tooltip content="Remove fill" side="top"><Button aria-label="Remove fill" variant="ghost" size="icon-compact" onClick={() => { set("background-image", ""); set("background-color", "transparent"); }}><Minus /></Button></Tooltip>
                  </div>
                  {!grad && <ColorField aria-label="Fill" value={bg} onChange={(v) => set("background-color", v)} />}
                  {grad && <GradientEditor label="Fill gradient" value={grad} onChange={setGrad} onScrub={p.onScrub} />}
                </>
              )}
            </InspectorSection>
            )}

            <InspectorSection id="stroke" title="Stroke" action={!hasStroke ? (
              <Tooltip content="Add stroke" side="top"><Button aria-label="Add stroke" variant="ghost" size="icon-compact" onClick={() => set("border", "1px solid #000000")}><Plus /></Button></Tooltip>) : (
              <Toggle on={sidesOpen} label="Individual sides" I={Scan} onClick={() => setSidesOpen((v) => !v)} />)}>
              {hasStroke && (
                <>
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1"><ColorField aria-label="Stroke color" value={val("border-top-color")} onChange={(v) => set("border-color", v)} /></div>
                    <Tooltip content="Remove stroke" side="top"><Button aria-label="Remove stroke" variant="ghost" size="icon-compact" onClick={() => set("border", "none")}><Minus /></Button></Tooltip>
                  </div>
                  {!sidesOpen ? (
                    <Grid>
                      {n("border-top-width", <MoveHorizontal />, "Stroke width", { min: 0 })}
                      <Pick label="Stroke style" value={val("border-top-style")} items={BORDER_STYLES} onChange={(v) => set("border-style", v)} />
                    </Grid>
                  ) : SIDES.map((x) => (
                    <Grid key={x}>
                      {n(`border-${x}-width`, x[0].toUpperCase(), `${x} stroke width`, { min: 0 })}
                      <Pick label={`${x} stroke style`} value={val(`border-${x}-style`) === "none" ? "solid" : val(`border-${x}-style`)} items={BORDER_STYLES} onChange={(v) => set(`border-${x}-style`, v)} />
                    </Grid>
                  ))}
                </>
              )}
            </InspectorSection>

            <InspectorSection id="effects" title="Effects" action={(
              <DropdownMenu open={fxMenu} onOpenChange={setFxMenu} size="compact">
                <DropdownTrigger render={<Button aria-label="Add effect" variant="ghost" size="icon-compact"><Plus /></Button>} />
                <DropdownContent align="end" side="bottom">
                  <MenuItem index={0} icon={LayersIcon} label="Drop shadow" onSelect={() => setShadows([...(shadows ?? []), { color: "rgba(0, 0, 0, 0.25)", x: 0, y: 4, b: 8, s: 0, inset: false }])} />
                  <MenuItem index={1} icon={LayersIcon} label="Inner shadow" onSelect={() => setShadows([...(shadows ?? []), { color: "rgba(0, 0, 0, 0.25)", x: 0, y: 4, b: 8, s: 0, inset: true }])} />
                  <MenuItem index={2} icon={Droplets} label="Layer blur" onSelect={() => set("filter", "blur(4px)")} />
                  <MenuItem index={3} icon={Droplets} label="Background blur" onSelect={() => set("backdrop-filter", "blur(8px)")} />
                </DropdownContent>
              </DropdownMenu>
            )}>
              {shadows === null && (
                <div className="flex items-center justify-between">
                  <span className="text-caption text-muted-foreground">Custom shadow</span>
                  <Tooltip content="Remove effect" side="top"><Button aria-label="Remove shadow" variant="ghost" size="icon-compact" onClick={() => set("box-shadow", "none")}><Minus /></Button></Tooltip>
                </div>
              )}
              {shadows?.map((sh, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-caption text-muted-foreground">{sh.inset ? "Inner shadow" : "Drop shadow"}</span>
                    <Tooltip content="Remove effect" side="top"><Button aria-label={`Remove shadow ${i + 1}`} variant="ghost" size="icon-compact" onClick={() => setShadows(shadows.filter((_, k) => k !== i))}><Minus /></Button></Tooltip>
                  </div>
                  <Grid>
                    <NumberField label="X" aria-label={`Shadow ${i + 1} X`} value={sh.x + "px"} onChange={(v) => patchShadow(i, { x: px(v) })} {...scrub} />
                    <NumberField label="Y" aria-label={`Shadow ${i + 1} Y`} value={sh.y + "px"} onChange={(v) => patchShadow(i, { y: px(v) })} {...scrub} />
                    <NumberField label="B" aria-label={`Shadow ${i + 1} blur`} min={0} value={sh.b + "px"} onChange={(v) => patchShadow(i, { b: px(v) })} {...scrub} />
                    <NumberField label="S" aria-label={`Shadow ${i + 1} spread`} value={sh.s + "px"} onChange={(v) => patchShadow(i, { s: px(v) })} {...scrub} />
                  </Grid>
                  <ColorField aria-label={`Shadow ${i + 1} color`} value={sh.color} onChange={(v) => patchShadow(i, { color: v })} />
                </div>
              ))}
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
        <CommentsPanel folder={p.folder} comments={p.comments} channel={p.channel} onJump={p.onJump} onResolve={p.onResolve} onTrust={p.onTrust} onRemove={p.onRemove} onRevert={p.onRevert} onSendAll={p.onSendAll} onResolveReplied={p.onResolveReplied} onStartComment={p.onStartComment} />
      </TabPanel>
    </Tabs>
  );
}
