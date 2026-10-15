// 단계 애니메이션의 순수 모델(spec/ANIMATION.md). DOM과 React에 의존하지 않는다: 요소 하나의 단계 사양(StepSpec), 보임 구간, 편집 연산,
// 속성과 CSS 변수로의 직렬화와 파싱. 파일에는 data-step, data-step-out, 인라인 style의 --sk-away-*, --sk-step-ms, --sk-step-delay만 남는다.
// 이름 있는 효과(Fade 등)는 저장하지 않고 변수 값을 채우는 빠른 선택일 뿐이다.

export type Away = { opacity: string; x: string; y: string; scale: string; blur: string };
export type StepSpec = {
  /** 등장 단계(2 이상). null이면 처음부터 보인다 */
  in: number | null;
  /** 퇴장 단계(2 이상이고 등장보다 큼). null이면 끝까지 보인다 */
  out: number | null;
  /** 전환 시간(ms). null이면 기본 */
  ms: number | null;
  /** 같은 단계 안에서 늦추는 시간(ms). null이면 0 */
  delay: number | null;
  /** 기본과 다른 벗어난 상태 값만 담는다 */
  away: Partial<Away>;
};

export const DEFAULT_AWAY: Away = { opacity: "0", x: "0px", y: "20px", scale: "1", blur: "0px" };
export const DEFAULT_MS = 360;
export const AWAY_KEYS = ["opacity", "x", "y", "scale", "blur"] as const;
export const AWAY_VAR: Record<keyof Away, string> = {
  opacity: "--sk-away-opacity", x: "--sk-away-x", y: "--sk-away-y", scale: "--sk-away-scale", blur: "--sk-away-blur",
};
export const MS_VAR = "--sk-step-ms";
export const DELAY_VAR = "--sk-step-delay";

/** 빠른 선택(Quick): 이름은 화면에만 있고 누르면 이 값이 변수로 채워진다 */
export const QUICK: readonly (readonly [id: string, label: string, away: Away])[] = [
  ["fade", "Fade", { opacity: "0", x: "0px", y: "0px", scale: "1", blur: "0px" }],
  ["rise", "Rise", { opacity: "0", x: "0px", y: "20px", scale: "1", blur: "0px" }],
  ["slide", "Slide", { opacity: "0", x: "-32px", y: "0px", scale: "1", blur: "0px" }],
  ["scale", "Scale", { opacity: "0", x: "0px", y: "0px", scale: "0.92", blur: "0px" }],
  ["blur", "Blur", { opacity: "0", x: "0px", y: "0px", scale: "1", blur: "12px" }],
];

/** 기존 data-step-effect 별칭이 뜻하는 값(none은 전환 시간 0) */
export const ALIAS: Record<string, { away?: Away; ms?: number }> = {
  rise: { away: QUICK[1][2] }, fade: { away: QUICK[0][2] }, left: { away: QUICK[2][2] }, scale: { away: QUICK[3][2] }, blur: { away: QUICK[4][2] }, none: { ms: 0 },
};

export const emptySpec = (): StepSpec => ({ in: null, out: null, ms: null, delay: null, away: {} });
export const cloneSpec = (s: StepSpec): StepSpec => ({ ...s, away: { ...s.away } });
export const hasAnimation = (s: StepSpec) => s.in !== null || s.out !== null;

const stepNum = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && Math.floor(n) === n && n >= 2 ? n : null);

/** 불변식을 맞춘다: in과 out은 2 이상의 정수이고 out은 in(없으면 1)보다 크다. 어긋나면 out을 버린다. */
export function normalize(s: StepSpec): StepSpec {
  const inn = stepNum(s.in), out0 = stepNum(s.out);
  const out = out0 !== null && out0 > (inn ?? 1) ? out0 : null;
  const away: Partial<Away> = {};
  for (const k of AWAY_KEYS) { const v = s.away[k]; if (v !== undefined && v !== DEFAULT_AWAY[k]) away[k] = v; }
  const ms = s.ms !== null && Number.isFinite(s.ms) && s.ms >= 0 && s.ms !== DEFAULT_MS ? Math.round(s.ms) : null;
  const delay = s.delay !== null && Number.isFinite(s.delay) && s.delay > 0 ? Math.round(s.delay) : null;
  return { in: inn, out, ms, delay, away };
}

/** 단계 k에서 보이는가(N ≤ k < M) */
export const visibleAt = (s: StepSpec, k: number) => k >= (s.in ?? 1) && (s.out === null || k < s.out);

/** 슬라이드의 단계 수: data-steps와 모든 등장과 퇴장 값 중 가장 큰 수(퇴장 M도 단계에 든다) */
export function stepCount(specs: readonly StepSpec[], dataSteps = 1): number {
  let n = Math.max(1, Math.floor(dataSteps) || 1);
  for (const s of specs) { if (s.in !== null) n = Math.max(n, s.in); if (s.out !== null) n = Math.max(n, s.out); }
  return n;
}

// ---- 편집 연산 ----
/** 등장 단계를 옮긴다(1 이하는 등장 없음). 퇴장이 같거나 앞서면 퇴장도 한 단계 뒤로 밀어 보이는 구간을 지킨다 */
export function setIn(s: StepSpec, n: number | null): StepSpec {
  const inn = n === null || n < 2 ? null : Math.round(n);
  const t = { ...cloneSpec(s), in: inn };
  if (t.out !== null && t.out <= (inn ?? 1)) t.out = (inn ?? 1) + 1;
  return normalize(t);
}
/** 퇴장 단계를 옮긴다(null이거나 등장 이하면 퇴장 없음) */
export function setOut(s: StepSpec, m: number | null): StepSpec {
  return normalize({ ...cloneSpec(s), out: m === null ? null : Math.round(m) });
}
/** 몸통 이동: 등장과 퇴장을 같은 간격으로 옮긴다. 가장 이른 값이 2 아래로 내려가지 않게 자른다 */
export function shift(s: StepSpec, delta: number): StepSpec {
  const d = Math.round(delta);
  const low = s.in !== null ? 2 - s.in : s.out !== null ? 2 - s.out : -Infinity;
  const dd = Math.max(low, d);
  return normalize({ ...cloneSpec(s), in: s.in === null ? null : s.in + dd, out: s.out === null ? null : s.out + dd });
}
/** 퇴장만 지운다 */
export const clearOut = (s: StepSpec): StepSpec => normalize({ ...cloneSpec(s), out: null });
/** 단계 속성을 모두 지운다(요소는 처음부터 끝까지 보인다). 시간 변수도 비운다 */
export const clearAll = (s: StepSpec): StepSpec => normalize({ ...emptySpec(), away: {} });
/** 빠른 선택: 벗어난 상태 값을 채운다 */
export function applyQuick(s: StepSpec, id: string): StepSpec {
  const q = QUICK.find((x) => x[0] === id);
  return q ? normalize({ ...cloneSpec(s), away: { ...q[2] } }) : s;
}
/** 지금 벗어난 상태 값이 어느 빠른 선택과 같은가(없으면 null) */
export function matchQuick(s: StepSpec): string | null {
  const full = awayOf(s);
  const hit = QUICK.find(([, , a]) => AWAY_KEYS.every((k) => a[k] === full[k]));
  return hit ? hit[0] : null;
}
export const awayOf = (s: StepSpec): Away => ({ ...DEFAULT_AWAY, ...s.away });
export const setAway = (s: StepSpec, k: keyof Away, v: string): StepSpec => normalize({ ...cloneSpec(s), away: { ...s.away, [k]: v } });
export const setMs = (s: StepSpec, ms: number | null): StepSpec => normalize({ ...cloneSpec(s), ms });
export const setDelay = (s: StepSpec, ms: number | null): StepSpec => normalize({ ...cloneSpec(s), delay: ms });
/** After previous: 같은 단계의 앞 요소들 중 가장 늦게 끝나는 것(delay + ms) 뒤로 이 요소의 지연을 채운다. 앞이 없으면 지연 없음. 숫자만 저장된다 */
export function afterPrevious(s: StepSpec, previous: readonly StepSpec[]): StepSpec {
  const end = previous.reduce((m, p) => Math.max(m, (p.delay ?? 0) + (p.ms ?? DEFAULT_MS)), 0);
  return setDelay(s, end > 0 ? end : null);
}

// ---- 직렬화와 파싱 ----
export type Serialized = { attrs: { "data-step": string | null; "data-step-out": string | null }; vars: Record<string, string | null> };
/** 속성과 인라인 변수로 쓴다. null은 지우라는 뜻이다. 기본값과 같은 변수는 쓰지 않는다 */
export function serialize(raw: StepSpec): Serialized {
  const s = normalize(raw);
  const vars: Record<string, string | null> = {};
  for (const k of AWAY_KEYS) vars[AWAY_VAR[k]] = s.away[k] ?? null;
  vars[MS_VAR] = s.ms === null ? null : `${s.ms}ms`;
  vars[DELAY_VAR] = s.delay === null ? null : `${s.delay}ms`;
  return { attrs: { "data-step": s.in === null ? null : String(s.in), "data-step-out": s.out === null ? null : String(s.out) }, vars };
}
const parseMs = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const m = /^\s*(-?\d*\.?\d+)\s*(ms|s)?\s*$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === "s" ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
};
const parseInt2 = (v: string | null | undefined): number | null => {
  if (v == null || !/^\s*\d+\s*$/.test(v)) return null;
  return stepNum(parseInt(v, 10));
};
/** 속성값과 변수값(없으면 null)에서 사양을 읽는다. data-step-effect 별칭은 변수가 없을 때만 값으로 푼다 */
export function parse(attrs: { step?: string | null; stepOut?: string | null; effect?: string | null }, vars: Record<string, string | null | undefined> = {}): StepSpec {
  const away: Partial<Away> = {};
  const alias = attrs.effect ? ALIAS[attrs.effect.trim()] : undefined;
  for (const k of AWAY_KEYS) { const v = vars[AWAY_VAR[k]]; const t = v == null ? "" : v.trim(); if (t) away[k] = t; else if (alias?.away) away[k] = alias.away[k]; }
  let ms = parseMs(vars[MS_VAR]);
  if (ms === null && alias?.ms !== undefined) ms = alias.ms;
  return normalize({ in: parseInt2(attrs.step), out: parseInt2(attrs.stepOut), ms, delay: parseMs(vars[DELAY_VAR]), away });
}
export const specEqual = (a: StepSpec, b: StepSpec) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
