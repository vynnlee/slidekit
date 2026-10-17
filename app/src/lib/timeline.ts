// 타임라인 편집의 순수 모델(spec/ANIMATION.md v2 3.9, /tmp/slidekit-anim-ux2/DESIGN.md). 막대 = (요소, in|out): 클릭 순위, 시작(지연 ms), 길이(ms).
// 계산은 engine/anim-core.ts의 analyze를 쓰고(중복 구현 없음), 여기서는 편집 연산(막대 시간, 구역 이동, 추가, 삭제, 효과)과 스냅 후보만 둔다.
// 모든 연산은 StepSpec 배열(요소 순서)을 받아 바뀐 요소만 돌려준다: 손대지 않은 요소는 다시 쓰이지 않는다. 시작 관계(With/After)는 저장하지 않고 숫자만 쓴다.
import { analyze, DEFAULT_MS, MAX_MS, type Analysis, type StepEl } from "../../../engine/anim-core";
import { AWAY_KEYS, QUICK, cloneSpec, emptySpec, freezeOut, kindKeys, normalize, specEqual, type StepSpec } from "./animation-model";

export type Kind = "in" | "out";
export type Bar = { id: string; el: number; kind: Kind; click: number; step: number; start: number; len: number; end: number; issues: { code: string; attr: string; value: string }[] };
export type Click = { click: number; step: number; length: number; bars: Bar[] };
export type Timeline = { clicks: Click[]; numbers: number[]; bars: Bar[]; an: Analysis };
export type Res = { ok: true; changed: Map<number, StepSpec> } | { ok: false; reason: string };
/** 놓을 곳: 있는 클릭 구역, 또는 새 구역(gap = 앞 구역 순위, 0이면 맨 앞, 구역 수면 맨 뒤) */
export type Target = { click: number } | { gap: number };

export const barId = (el: number, kind: Kind) => `${el}:${kind}`;
const t = (n: number | null, unit = "ms") => (n === null ? null : `${n}${unit}`);
/** StepSpec을 anim-core가 읽는 문자열 요소로 바꾼다 */
export const toStepEl = (s: StepSpec): StepEl => ({ step: s.in === null ? null : String(s.in), stepOut: s.out === null ? null : String(s.out), ms: t(s.ms), delay: t(s.delay), outMs: t(s.outMs), outDelay: t(s.outDelay) });

export function timelineFromEls(els: readonly StepEl[]): Timeline {
  const an = analyze(els);
  const bars: Bar[] = an.entries.map((e) => ({ id: barId(e.el, e.kind), el: e.el, kind: e.kind, click: e.click, step: e.step, start: e.start, len: e.len, end: e.end, issues: e.issues }));
  const clicks: Click[] = an.numbers.map((step, i) => ({ click: i + 1, step, length: an.clickLength[i], bars: [] }));
  for (const b of bars) clicks[b.click - 1].bars.push(b);
  return { clicks, numbers: an.numbers, bars, an };
}
export const timelineOf = (specs: readonly StepSpec[]) => timelineFromEls(specs.map(toStepEl));
export const barOf = (tl: Timeline, el: number, kind: Kind) => tl.bars.find((b) => b.el === el && b.kind === kind) ?? null;
/** 같은 구역에서 바로 위(표시 순서) 막대 */
export const aboveOf = (c: Click, bar: Bar): Bar | null => { const i = c.bars.findIndex((b) => b.id === bar.id); return i > 0 ? c.bars[i - 1] : null; };

const clampT = (n: number) => Math.min(MAX_MS, Math.max(0, Math.round(n)));

/** 놓을 곳의 번호. 새 구역은 이웃 번호 사이의 정수를 쓰고, 없을 때만 뒤 번호를 한 칸씩 민다(shiftFrom: 이 번호 이상을 +1) */
function stepFor(tl: Timeline, target: Target): { step: number; shiftFrom: number | null } | null {
  const nums = tl.numbers;
  if ("click" in target) { const n = nums[target.click - 1]; return n === undefined ? null : { step: n, shiftFrom: null }; }
  const g = Math.max(0, Math.min(nums.length, target.gap));
  const lower = g === 0 ? 1 : nums[g - 1], upper = g === nums.length ? Infinity : nums[g];
  const lo = Math.max(lower + 1, 2);
  if (lo < upper) return { step: lo, shiftFrom: null };
  return { step: upper, shiftFrom: upper };
}
const shift = (specs: StepSpec[], from: number) => specs.forEach((s) => { if (s.in !== null && s.in >= from) s.in += 1; if (s.out !== null && s.out >= from) s.out += 1; });

/** 검증 후 바뀐 요소만 모은다. 퇴장은 항상 자기 등장 뒤(번호 비교 = 순위 비교) */
function finish(orig: readonly StepSpec[], next: StepSpec[]): Res {
  const changed = new Map<number, StepSpec>();
  for (let i = 0; i < next.length; i++) {
    const s = next[i];
    if (s.in !== null && s.out !== null && s.out <= s.in) return { ok: false, reason: "Out must come after In" };
    if (!specEqual(s, orig[i])) changed.set(i, normalize(s));
  }
  return { ok: true, changed };
}
const copy = (specs: readonly StepSpec[]) => specs.map(cloneSpec);
const barSpec = (specs: readonly StepSpec[], b: { el: number }) => specs[b.el];

/** 새 애니메이션: In은 기본이 맨 뒤의 새 클릭(자기 Out이 있으면 그 앞), Out은 맨 뒤의 새 클릭 */
export function addBar(specs: readonly StepSpec[], el: number, kind: Kind, target?: Target): Res {
  const tl = timelineOf(specs), next = copy(specs), s = next[el];
  if (!s) return { ok: false, reason: "No such element" };
  const k = kindKeys(kind);
  if (s[k.step] !== null) return { ok: false, reason: kind === "in" ? "Already has an In" : "Already has an Out" };
  let tg = target;
  if (!tg) { const out = kind === "in" && s.out !== null ? barOf(tl, el, "out") : null; tg = { gap: out ? out.click - 1 : tl.clicks.length }; }
  const f = stepFor(tl, tg);
  if (!f) return { ok: false, reason: "No such click" };
  if (f.shiftFrom !== null) shift(next, f.shiftFrom);
  s[k.step] = f.step;
  return finish(specs, next);
}

/** 막대 시간: start(지연)와 len(시간)을 ms로. 등장 막대를 고칠 때 퇴장이 따라가던 값은 먼저 굳혀 퇴장이 안 바뀌게 한다 */
export function setBarTime(specs: readonly StepSpec[], bar: Pick<Bar, "el" | "kind">, v: { start?: number; len?: number }): Res {
  const cur = barOf(timelineOf(specs), bar.el, bar.kind);
  if (cur && (v.start === undefined || clampT(v.start) === cur.start) && (v.len === undefined || clampT(v.len) === cur.len)) return { ok: true, changed: new Map() }; // 같은 값이면 아무것도 쓰지 않는다
  const next = copy(specs);
  if (bar.kind === "in") next[bar.el] = freezeOut(next[bar.el]);
  const s = next[bar.el], k = kindKeys(bar.kind);
  if (v.start !== undefined) s[k.delay] = clampT(v.start);
  if (v.len !== undefined) s[k.ms] = clampT(v.len);
  return finish(specs, next);
}

/** 다른 구역으로(있는 구역 또는 새 구역). 지연과 시간은 그대로 */
export function moveToClick(specs: readonly StepSpec[], bar: Pick<Bar, "el" | "kind">, target: Target): Res {
  const tl = timelineOf(specs), next = copy(specs);
  const f = stepFor(tl, target);
  if (!f) return { ok: false, reason: "No such click" };
  if (f.shiftFrom !== null) shift(next, f.shiftFrom);
  next[bar.el][kindKeys(bar.kind).step] = f.step;
  return finish(specs, next);
}

/** 효과(Fade, Rise, Slide, Scale, Blur): 등장은 --sk-away-*, 퇴장은 --sk-out-* 값을 채운다 */
export function setEffect(specs: readonly StepSpec[], bar: Pick<Bar, "el" | "kind">, id: string): Res {
  const q = QUICK.find((x) => x[0] === id);
  if (!q) return { ok: false, reason: "Unknown effect" };
  const next = copy(specs);
  if (bar.kind === "in") next[bar.el] = freezeOut(next[bar.el]);
  const s = next[bar.el], k = kindKeys(bar.kind);
  s[k.away] = { ...q[2] };
  return finish(specs, next);
}

/** 벗어난 상태 값 하나(Custom 쪽이 아니라 인스펙터 확장용) */
export function setAwayValue(specs: readonly StepSpec[], bar: Pick<Bar, "el" | "kind">, key: (typeof AWAY_KEYS)[number], value: string): Res {
  const next = copy(specs);
  if (bar.kind === "in") next[bar.el] = freezeOut(next[bar.el]);
  const s = next[bar.el], k = kindKeys(bar.kind);
  s[k.away] = { ...s[k.away], [key]: value };
  return finish(specs, next);
}

/** 삭제. 등장을 지우고 퇴장이 남으면 퇴장이 따라가던 값을 굳힌 뒤 등장 값을 비운다. 둘 다 없어지면 요소의 단계 값이 모두 사라진다 */
export function removeBar(specs: readonly StepSpec[], bar: Pick<Bar, "el" | "kind">): Res {
  const next = copy(specs);
  let s = next[bar.el];
  if (bar.kind === "in") {
    s = freezeOut(s); s.in = null; s.ms = null; s.delay = null; s.away = {};
  } else { s.out = null; s.outMs = null; s.outDelay = null; s.outAway = {}; }
  if (s.in === null && s.out === null) s = emptySpec();
  next[bar.el] = s;
  return finish(specs, next);
}

/** 연산 여럿을 차례로 적용해 하나의 결과로 합친다(구역 이동 + 시간 변경 같은 한 번의 끌기) */
export function compose(specs: readonly StepSpec[], ...fns: ((s: StepSpec[]) => Res)[]): Res {
  let cur = specs.map(cloneSpec);
  for (const f of fns) { const r = f(cur); if (!r.ok) return r; cur = cur.map((s, i) => r.changed.get(i) ?? s); }
  const changed = new Map<number, StepSpec>();
  cur.forEach((s, i) => { if (!specEqual(s, specs[i])) changed.set(i, normalize(s)); });
  return { ok: true, changed };
}

// ---- 표시 도우미 ----
export type Relation = "click" | "with" | "after" | "delay";
/** 위 막대와의 관계(저장하지 않고 숫자에서 유도): 같은 시작 = with, 위 막대 끝에 붙음 = after, 클릭 즉시 = click */
export function relationOf(bar: Pick<Bar, "start">, above: Pick<Bar, "start" | "end"> | null): Relation {
  if (above && bar.start === above.start) return "with";
  if (above && bar.start === above.end) return "after";
  return bar.start === 0 ? "click" : "delay";
}
export type SnapTarget = { t: number; kind: "click" | "with" | "after"; ref: Bar | null };
/** 같은 구역 안의 자석 후보: 0(클릭), 다른 막대의 시작(with), 다른 막대의 끝(after) */
export function snapTargets(c: Click, self: Pick<Bar, "id">): SnapTarget[] {
  const out: SnapTarget[] = [{ t: 0, kind: "click", ref: null }];
  for (const b of c.bars) { if (b.id === self.id) continue; out.push({ t: b.start, kind: "with", ref: b }, { t: b.end, kind: "after", ref: b }); }
  return out;
}
/** 값을 격자(기본 50ms)에 맞추고, 후보가 threshold(ms) 안이면 후보로 당긴다 */
export function snap(ms: number, targets: readonly SnapTarget[], threshold: number, grid = 50): { ms: number; hit: SnapTarget | null } {
  let best: SnapTarget | null = null, d = threshold + 1;
  for (const g of targets) { const x = Math.abs(g.t - ms); if (x < d) { d = x; best = g; } }
  if (best && d <= threshold) return { ms: best.t, hit: best };
  return { ms: grid > 0 ? Math.round(ms / grid) * grid : Math.round(ms), hit: null };
}
export { DEFAULT_MS, MAX_MS };
