// 단계 애니메이션 모델(animation-model.ts)과 살아 있는 DOM을 잇는 얇은 층. 재생 헤드는 data-shown과 data-away 속성만 토글한다(iframe을 다시 만들지 않는다).
import { AWAY_VAR, DELAY_VAR, MS_VAR, hasAnimation, normalize, parse, serialize, stepCount, visibleAt, type StepSpec } from "./animation-model";

const VARS = [...Object.values(AWAY_VAR), MS_VAR, DELAY_VAR];
export type AnimRow = { el: HTMLElement; spec: StepSpec };

export function readSpec(el: Element): StepSpec {
  const st = (el as HTMLElement).style, vars: Record<string, string | null> = {};
  for (const v of VARS) vars[v] = st.getPropertyValue(v) || null;
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

/** 슬라이드의 단계가 있는 요소들(문서 순서). extra(선택한 요소)는 단계가 없어도 줄에 넣는다 */
export function readSlide(slide: Element, extra?: Element | null): AnimRow[] {
  const els = [...slide.querySelectorAll<HTMLElement>("[data-step],[data-step-out]")].filter((e) => !inNotes(e));
  if (extra && extra !== slide && slide.contains(extra) && !els.includes(extra as HTMLElement) && !inNotes(extra)) {
    els.push(extra as HTMLElement);
    els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }
  return els.map((el) => ({ el, spec: readSpec(el) }));
}

export const slideStepCount = (slide: Element, rows: readonly AnimRow[]) => stepCount(rows.map((r) => r.spec), parseInt(slide.getAttribute("data-steps") ?? "1", 10) || 1);

/** 재생 헤드를 단계 k로: 보임 구간이면 data-shown(보임), 아니면 data-away(벗어남). instant면 전환 없이 바로 맞춘다 */
export function applyPlayhead(slide: Element, k: number, rows: readonly AnimRow[], instant: boolean) {
  if (instant) slide.setAttribute("data-step-instant", "");
  for (const { el, spec } of rows) {
    if (!hasAnimation(spec)) continue;
    const vis = visibleAt(spec, k);
    el.toggleAttribute("data-shown", vis);
    el.toggleAttribute("data-away", !vis);
  }
  if (instant) { void (slide as HTMLElement).offsetWidth; slide.removeAttribute("data-step-instant"); }
}

/** 편집 표시를 걷어 낸다(저장용 글자에 새지 않게 serializeSlide도 지운다) */
export function clearPlayhead(slide: Element) {
  for (const e of slide.querySelectorAll("[data-shown],[data-away]")) { e.removeAttribute("data-shown"); e.removeAttribute("data-away"); }
}
