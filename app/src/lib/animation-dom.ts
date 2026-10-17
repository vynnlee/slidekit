// 단계 애니메이션 모델(animation-model.ts, timeline.ts)과 살아 있는 DOM을 잇는 얇은 층. 재생 헤드는 data-shown과 data-away(값 포함)만 토글한다(iframe을 다시 만들지 않는다).
// 스크럽은 엔진 CSS가 만든 실제 CSSTransition을 pause하고 currentTime을 맞춘다(전환 프레임 정확, DOM 속성 변경 없음).
import { compress, rangeOf, type Range } from "../../../engine/anim-core";
import { ALL_VARS, emptySpec, normalize, parse, serialize, type StepSpec } from "./animation-model";
import type { Res } from "./timeline";

export type AnimRow = { el: HTMLElement; spec: StepSpec; range: Range };

/** 요소의 단계 값을 읽는다: 인라인 변수, 없으면 클래스가 정한 값(computed style, 문서 루트의 기본과 다를 때만) */
export function readSpec(el: Element): StepSpec {
  const h = el as HTMLElement, st = h.style, vars: Record<string, string | null> = {};
  let cs: CSSStyleDeclaration | null = null, root: CSSStyleDeclaration | null = null;
  for (const v of ALL_VARS) {
    let val = st.getPropertyValue(v).trim();
    if (!val) {
      try {
        const win = el.ownerDocument.defaultView;
        if (win) { cs ??= win.getComputedStyle(el); root ??= win.getComputedStyle(el.ownerDocument.documentElement); const c = cs.getPropertyValue(v).trim(); if (c && c !== root.getPropertyValue(v).trim()) val = c; }
      } catch { /* 문서 밖 요소 */ }
    }
    vars[v] = val || null;
  }
  return parse({ step: el.getAttribute("data-step"), stepOut: el.getAttribute("data-step-out"), effect: el.getAttribute("data-step-effect") }, vars);
}

/** 사양을 요소에 쓴다. 기존 별칭 data-step-effect는 변수로 바꿔 쓰므로 속성은 지운다 */
export function writeSpec(el: HTMLElement, raw: StepSpec) {
  const s = serialize(normalize(raw));
  for (const [name, v] of Object.entries(s.attrs)) { if (v === null) el.removeAttribute(name); else el.setAttribute(name, v); }
  el.removeAttribute("data-step-effect");
  for (const [name, v] of Object.entries(s.vars)) { if (v === null) el.style.removeProperty(name); else el.style.setProperty(name, v); }
}

const inNotes = (e: Element) => !!e.closest("aside[data-notes]");

/** 슬라이드의 단계가 있는 요소들(문서 순서). extra(선택한 요소)는 단계가 없어도 넣는다. withSpec=false면 시간과 효과 값을 읽지 않는다(재생 헤드와 배지는 번호만 쓴다) */
export function readSlide(slide: Element, extra?: Element | null, withSpec = true): AnimRow[] {
  const els = [...slide.querySelectorAll<HTMLElement>("[data-step],[data-step-out]")].filter((e) => !inNotes(e));
  if (extra && extra !== slide && slide.contains(extra) && !els.includes(extra as HTMLElement) && !inNotes(extra)) {
    els.push(extra as HTMLElement);
    els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }
  return els.map((el) => ({ el, spec: withSpec ? readSpec(el) : emptySpec(), range: rangeOf(el.getAttribute("data-step"), el.getAttribute("data-step-out")) }));
}

/** 쓰인 번호의 순위(엔진과 같은 압축). 단계 = 클릭 + 1 */
export const stepsOf = (rows: readonly AnimRow[]) => compress(rows.map((r) => r.range));
export const slideStepCount = (_slide: Element, rows: readonly AnimRow[]) => 1 + stepsOf(rows).numbers.length;
/** 슬라이드가 stepper(JS가 단계를 구동)이면 타임라인은 읽기 전용이다. 엔진이 data-stepper를 붙이는 안(결정 21) 전에는 표식이 없어 항상 false */
export const isStepper = (slide: Element) => slide.hasAttribute("data-stepper");

/** 모델 연산 결과 -> 바뀐 요소와 새 사양(Editor가 한 번에 쓰고 실행 취소 한 건) */
export function planEdit(rows: readonly AnimRow[], res: Res): [HTMLElement, StepSpec][] | null {
  return res.ok && res.changed.size ? [...res.changed].map(([i, s]) => [rows[i].el, s] as [HTMLElement, StepSpec]) : null;
}

/** 재생 헤드를 단계 k로: 보임 구간이면 data-shown, 등장 전이면 data-away="", 퇴장 뒤면 data-away="out"(엔진 CSS가 퇴장 변수로 그림). instant면 전환 없이 바로 */
export function applyPlayhead(slide: Element, k: number, rows: readonly AnimRow[], instant: boolean) {
  if (instant) slide.setAttribute("data-step-instant", "");
  const { stepOf } = stepsOf(rows);
  for (const { el, range } of rows) {
    if (range.n < 2 && range.m === null) continue;
    const a = stepOf(range.n), b = range.m === null ? Infinity : stepOf(range.m);
    const shown = k >= a && k < b;
    el.toggleAttribute("data-shown", shown);
    if (shown) el.removeAttribute("data-away"); else el.setAttribute("data-away", k >= b ? "out" : "");
  }
  if (instant) { void (slide as HTMLElement).offsetWidth; slide.removeAttribute("data-step-instant"); }
}

/** 편집 표시를 걷어 낸다(저장용 글자에 새지 않게 serializeSlide도 지운다) */
export function clearPlayhead(slide: Element) {
  for (const e of slide.querySelectorAll("[data-shown],[data-away]")) { e.removeAttribute("data-shown"); e.removeAttribute("data-away"); }
}

// ---- 스크럽(전환 프레임 정확) ----
export type Scrub = { slide: Element; click: number; anims: Animation[] };
/** 클릭 c의 시작 상태(단계 c)를 즉시 맞추고, 단계 c+1로 전환을 시작시킨 뒤 그 CSSTransition들을 멈춘다 */
export function scrubStart(slide: Element, click: number, rows: readonly AnimRow[]): Scrub {
  applyPlayhead(slide, click, rows, true);
  applyPlayhead(slide, click + 1, rows, false);
  const win = slide.ownerDocument.defaultView as (Window & { CSSTransition?: new () => Animation }) | null;
  const T = win?.CSSTransition;
  const anims = (slide as HTMLElement).getAnimations({ subtree: true }).filter((a) => { const tg = (a.effect as KeyframeEffect | null)?.target as Element | null | undefined; return !!T && a instanceof T && !!tg && (tg.hasAttribute("data-step") || tg.hasAttribute("data-step-out")); });
  for (const a of anims) a.pause();
  return { slide, click, anims };
}
export function scrubSet(s: Scrub, ms: number) { for (const a of s.anims) a.currentTime = ms; }
/** 전환을 걷어 내고 k단계의 정상 상태를 즉시 복원한다 */
export function scrubEnd(s: Scrub, k: number, rows: readonly AnimRow[]) {
  for (const a of s.anims) a.cancel();
  applyPlayhead(s.slide, k, rows, true);
}
