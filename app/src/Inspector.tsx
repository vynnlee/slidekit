import { useEffect, useState } from "react";
import { Field } from "@/components/ui/field";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabItem, TabPanel } from "@/components/ui/tabs";
import { textual } from "./Canvas";
import type { Comment } from "@/lib/deck";

const hex = (rgb: string) => {
  const m = rgb.match(/\d+(\.\d+)?/g);
  return m ? "#" + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("") : "#ffffff";
};

const KINDS = [["cover", "표지"], ["chapter", "장 표지"], ["content", "본문"], ["end", "마지막"]] as const;
const WEIGHTS = [["400", "보통"], ["500", "중간"], ["700", "굵게"]] as const;
const ALIGNS = [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-caption text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Pick({ value, items, onChange }: { value: string; items: readonly (readonly [string, string])[]; onChange(v: string): void }) {
  return (
    <Select value={value} onValueChange={onChange} size="compact">
      <SelectTrigger />
      <SelectContent>
        {items.map(([v, l], i) => <SelectItem key={v} index={i} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
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
};

export function Inspector(p: Props) {
  const el = p.sel && !(p.sel instanceof SVGElement) ? (p.sel as HTMLElement) : null;
  const [cs, setCs] = useState({ size: "", weight: "400", align: "left", color: "#ffffff" });
  useEffect(() => {
    if (!el) return;
    const c = el.ownerDocument.defaultView!.getComputedStyle(el);
    setCs({
      size: String(Math.round(parseFloat(c.fontSize))),
      weight: ["400", "500", "700"].includes(c.fontWeight) ? c.fontWeight : +c.fontWeight >= 600 ? "700" : "400",
      align: c.textAlign === "start" ? "left" : c.textAlign,
      color: hex(c.color),
    });
  }, [el, p.selId]);
  const set = (k: keyof typeof cs, prop: string, v: string) => {
    setCs((s) => ({ ...s, [k]: v }));
    p.onStyle(prop, k === "size" ? v + "px" : v);
  };

  const kind = p.slide?.getAttribute("data-slide") ?? "content";

  return (
    <Tabs value={p.tab} onValueChange={p.onTab}>
      <TabsList>
        <TabItem value="props" label="속성" />
        <TabItem value="comments" label={`코멘트${p.comments.length ? " " + p.comments.length : ""}`} />
      </TabsList>
      <TabPanel value="props">
        <div className="flex flex-col gap-2 pt-3" key={p.selId}>
          {el && textual(el) && (
            <>
              <Row label="크기"><Field type="number" min={8} max={400} value={cs.size} onChange={(e) => e.target.value && set("size", "font-size", e.target.value)} /></Row>
              <Row label="굵기"><Pick value={cs.weight} items={WEIGHTS} onChange={(v) => set("weight", "font-weight", v)} /></Row>
              <Row label="정렬"><Pick value={cs.align} items={ALIGNS} onChange={(v) => set("align", "text-align", v)} /></Row>
              <Row label="색">
                <div className="flex items-center gap-1">
                  <input type="color" value={cs.color} onChange={(e) => set("color", "color", e.target.value)}
                    className="h-7 w-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />
                  <Field value={cs.color} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) ? set("color", "color", e.target.value) : setCs((s) => ({ ...s, color: e.target.value }))} />
                </div>
              </Row>
              <div className="my-1 h-px bg-border/60" />
            </>
          )}
          <Row label="종류"><Pick value={KINDS.some(([k]) => k === kind) ? kind : "content"} items={KINDS} onChange={(v) => p.onAttr("data-slide", v)} /></Row>
          <Row label="장 제목"><Field defaultValue={p.slide?.getAttribute("data-title") ?? ""} onChange={(e) => p.onAttr("data-title", e.target.value || null)} /></Row>
        </div>
      </TabPanel>
      <TabPanel value="comments">
        <div className="flex flex-col gap-2 pt-3">
          {p.comments.length === 0 && <p className="text-caption text-muted-foreground">요소를 선택하고 코멘트를 남기세요</p>}
          {p.comments.map((c) => (
            <button key={c.id} onClick={() => p.onJump(c)} className="flex flex-col gap-0.5 rounded-lg bg-hover p-2 text-left">
              <span className="truncate text-micro text-muted-foreground">{c.slide} {c.excerpt}</span>
              <span className="whitespace-pre-wrap text-body">{c.text}</span>
              {c.reply && <span className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 text-body text-muted-foreground">{c.reply}</span>}
              {!c.reply && c.status === "open" && <span className="text-micro text-muted-foreground">답 기다리는 중</span>}
            </button>
          ))}
        </div>
      </TabPanel>
    </Tabs>
  );
}
