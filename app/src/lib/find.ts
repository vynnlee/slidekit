// 덱 전체 찾기와 바꾸기(Cmd+F). 슬라이드 글자(units의 html)를 DOM으로 읽어 텍스트 노드에서만 찾고 바꾸므로 태그와 속성은 건드리지 않는다.
// 바꾸면 텍스트 노드의 글자만 바뀌어 인라인 서식(strong, em 등)이 보존된다. 일치는 텍스트 노드 하나 안에서만 잡는다(서식 경계를 넘는 글은 찾지 않는다).
import type { Unit } from "@/lib/deck-source";
import { pathOf, type PathMemo } from "@/lib/deck-source";

export type FindOpts = { matchCase?: boolean; notes?: boolean };
export type Match = {
  slide: number; // units 안의 번호(0부터)
  path: string; // 슬라이드 루트에서 요소까지(deck-source의 pathOf)
  node: number; // 요소 안에서 이 일치가 든 텍스트 노드의 번호
  at: number; // 텍스트 노드 안에서의 시작 위치
  inNotes: boolean;
  context: string; // 앞뒤 조금을 포함한 글(목록 표시용)
};

const SKIP = "script, style, template";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rx = (q: string, o: FindOpts) => new RegExp(esc(q), o.matchCase ? "g" : "gi");

function textNodes(root: Element, o: FindOpts) {
  const out: { n: Text; el: Element; k: number; notes: boolean }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const perEl = new Map<Element, number>();
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const el = n.parentElement;
    if (!el || el.closest(SKIP)) continue;
    const notes = !!el.closest("aside[data-notes]");
    if (notes && !o.notes) continue;
    const k = perEl.get(el) ?? 0;
    perEl.set(el, k + 1);
    out.push({ n, el, k, notes });
  }
  return out;
}

function parse(html: string): Element {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as Element;
}

/** 모든 슬라이드에서 일치 목록을 문서 순서로 돌려준다. */
export function findInUnits(units: Unit[], query: string, o: FindOpts = {}): Match[] {
  if (!query) return [];
  const out: Match[] = [];
  units.forEach((u, slide) => {
    const root = parse(u.html);
    if (!root) return;
    const memo: PathMemo = new Map();
    for (const { n, el, k, notes } of textNodes(root, o)) {
      const text = n.data;
      for (const m of text.matchAll(rx(query, o))) {
        const at = m.index!;
        out.push({ slide, path: pathOf(root, el, memo), node: k, at, inNotes: notes, context: text.slice(Math.max(0, at - 12), at + query.length + 12).replace(/\s+/g, " ") });
      }
    }
  });
  return out;
}

/** 일치를 바꾼 새 units. only가 있으면 그 일치 하나만(findInUnits의 결과 중 하나), 없으면 모두. 바뀐 슬라이드만 새 html을 갖는다. */
export function replaceInUnits(units: Unit[], query: string, repl: string, o: FindOpts = {}, only?: Match): Unit[] {
  if (!query) return units;
  const bySlide = new Set(only ? [only.slide] : units.map((_, i) => i));
  return units.map((u, slide) => {
    if (!bySlide.has(slide)) return u;
    const root = parse(u.html);
    if (!root) return u;
    let changed = false;
    for (const { n, el, k } of textNodes(root, o)) {
      if (only) {
        if (pathOf(root, el) !== only.path || k !== only.node) continue;
        n.data = n.data.replace(rx(query, o), (m, off: number) => (off === only.at ? (changed = true, repl) : m));
      } else {
        const next = n.data.replace(rx(query, o), () => repl);
        if (next !== n.data) { n.data = next; changed = true; }
      }
    }
    return changed ? { ...u, html: serialize(root) } : u;
  });
}

// 편집기의 serializeSlide와 같은 규칙으로 되돌린다(boolean 속성 data-notes는 =""를 뺀다).
function serialize(root: Element) {
  return root.outerHTML.replace(/(<aside\b[^>]*\sdata-notes)=""/g, "$1");
}
