// 단계 애니메이션의 요소 하나 값(spec/ANIMATION.md v2). DOM과 React에 의존하지 않는다.
// 파일에는 data-step, data-step-out, 인라인 style의 --sk-away-*, --sk-step-ms, --sk-step-delay, 퇴장 전용 --sk-out-*만 남는다.
// 이름 있는 효과(Fade 등)는 저장하지 않고 변수 값을 채우는 빠른 선택일 뿐이다. 번호 파싱, 시간 읽기(0~10000ms 맞춤)는 engine/anim-core.ts를 쓴다.
import { DEFAULT_MS, MAX_MS, parseStepNumber, readTime } from "../../../engine/anim-core";

export { DEFAULT_MS, MAX_MS };
export type Away = { opacity: string; x: string; y: string; scale: string; blur: string };
export type StepSpec = {
  /** 등장 번호(2 이상). null이면 처음부터 보인다 */
  in: number | null;
  /** 퇴장 번호(2 이상). null이면 끝까지 보인다 */
  out: number | null;
  /** 등장 전환 시간(ms). null이면 기본 */
  ms: number | null;
  /** 등장 지연(ms, 클릭 시점 기준). null이면 0 */
  delay: number | null;
  /** 등장 전의 벗어난 상태: 기본과 다른 값만 */
  away: Partial<Away>;
  /** 퇴장 전용 값(없으면 등장 값을 따라간다, 2.4절). 시간과 지연은 ms */
  outMs: number | null;
  outDelay: number | null;
  /** 퇴장 뒤 상태: 적힌 값만(폴백은 등장 값이라 기본값과 같다고 지우지 않는다) */
  outAway: Partial<Away>;
};

export const DEFAULT_AWAY: Away = { opacity: "0", x: "0px", y: "20px", scale: "1", blur: "0px" };
export const AWAY_KEYS = ["opacity", "x", "y", "scale", "blur"] as const;
export const AWAY_VAR: Record<keyof Away, string> = {
  opacity: "--sk-away-opacity", x: "--sk-away-x", y: "--sk-away-y", scale: "--sk-away-scale", blur: "--sk-away-blur",
};
export const OUT_VAR: Record<keyof Away, string> = {
  opacity: "--sk-out-opacity", x: "--sk-out-x", y: "--sk-out-y", scale: "--sk-out-scale", blur: "--sk-out-blur",
};
export const MS_VAR = "--sk-step-ms", DELAY_VAR = "--sk-step-delay", OUT_MS_VAR = "--sk-out-ms", OUT_DELAY_VAR = "--sk-out-delay";
export const ALL_VARS = [...Object.values(AWAY_VAR), ...Object.values(OUT_VAR), MS_VAR, DELAY_VAR, OUT_MS_VAR, OUT_DELAY_VAR];

/** 빠른 선택(Effect): 이름은 화면에만 있고 누르면 이 값이 변수로 채워진다 */
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

export const emptySpec = (): StepSpec => ({ in: null, out: null, ms: null, delay: null, away: {}, outMs: null, outDelay: null, outAway: {} });
export const cloneSpec = (s: StepSpec): StepSpec => ({ ...s, away: { ...s.away }, outAway: { ...s.outAway } });
export const hasAnimation = (s: StepSpec) => s.in !== null || s.out !== null;

const stepNum = (n: unknown): number | null => (typeof n === "number" && Number.isSafeInteger(n) && n >= 2 ? n : null);
const clampMs = (n: number) => Math.min(MAX_MS, Math.max(0, Math.round(n)));

/** 불변식을 맞춘다: 번호는 2 이상 정수, 시간은 0~10000ms 정수, 등장 값에서 기본과 같은 벗어난 상태는 지운다. 퇴장 번호가 등장 번호 이하이면 버린다 */
export function normalize(s: StepSpec): StepSpec {
  const inn = stepNum(s.in), out0 = stepNum(s.out);
  const out = out0 !== null && out0 > (inn ?? 1) ? out0 : null;
  const away: Partial<Away> = {}, outAway: Partial<Away> = {};
  for (const k of AWAY_KEYS) {
    const a = s.away[k]; if (a !== undefined && a !== "" && a !== DEFAULT_AWAY[k]) away[k] = a;
    const o = s.outAway[k]; if (o !== undefined && o !== "") outAway[k] = o;
  }
  const ms = s.ms !== null && Number.isFinite(s.ms) && s.ms !== DEFAULT_MS ? clampMs(s.ms) : null;
  const delay = s.delay !== null && Number.isFinite(s.delay) && s.delay > 0 ? clampMs(s.delay) : null;
  const outMs = s.outMs !== null && Number.isFinite(s.outMs) ? clampMs(s.outMs) : null;
  const outDelay = s.outDelay !== null && Number.isFinite(s.outDelay) ? clampMs(s.outDelay) : null;
  return { in: inn, out, ms, delay, away, outMs, outDelay, outAway };
}

export const awayOf = (s: StepSpec): Away => ({ ...DEFAULT_AWAY, ...s.away });
/** 퇴장 뒤 상태의 실제 값: 퇴장 변수, 없으면 등장 값, 없으면 기본 */
export const outAwayOf = (s: StepSpec): Away => ({ ...awayOf(s), ...s.outAway });
export const msOf = (s: StepSpec) => s.ms ?? DEFAULT_MS;
export const delayOf = (s: StepSpec) => s.delay ?? 0;
export const outMsOf = (s: StepSpec) => s.outMs ?? msOf(s);
export const outDelayOf = (s: StepSpec) => s.outDelay ?? delayOf(s);

/** 값이 어느 빠른 선택과 같은가(없으면 null) */
export function quickOf(a: Away): string | null {
  const hit = QUICK.find(([, , q]) => AWAY_KEYS.every((k) => q[k] === a[k]));
  return hit ? hit[0] : null;
}
export const matchQuick = (s: StepSpec) => quickOf(awayOf(s));

/** 퇴장 값이 따로 없는 요소의 퇴장 값을 지금 등장 값으로 굳힌다(등장 값을 고쳐도 퇴장이 따라 바뀌지 않게) */
export function freezeOut(s: StepSpec): StepSpec {
  if (s.out === null) return s;
  const t = cloneSpec(s);
  if (t.outMs === null) t.outMs = msOf(s);
  if (t.outDelay === null) t.outDelay = delayOf(s);
  const a = awayOf(s);
  for (const k of AWAY_KEYS) if (t.outAway[k] === undefined) t.outAway[k] = a[k];
  return t;
}

export const kindKeys = (kind: "in" | "out") => kind === "in"
  ? ({ step: "in", ms: "ms", delay: "delay", away: "away" } as const)
  : ({ step: "out", ms: "outMs", delay: "outDelay", away: "outAway" } as const);

// ---- 직렬화와 파싱 ----
export type Serialized = { attrs: { "data-step": string | null; "data-step-out": string | null }; vars: Record<string, string | null> };
/** 속성과 인라인 변수로 쓴다. null은 지우라는 뜻이다. 기본값과 같은 등장 변수는 쓰지 않는다 */
export function serialize(raw: StepSpec): Serialized {
  const s = normalize(raw);
  const vars: Record<string, string | null> = {};
  for (const k of AWAY_KEYS) { vars[AWAY_VAR[k]] = s.away[k] ?? null; vars[OUT_VAR[k]] = s.outAway[k] ?? null; }
  vars[MS_VAR] = s.ms === null ? null : `${s.ms}ms`;
  vars[DELAY_VAR] = s.delay === null ? null : `${s.delay}ms`;
  vars[OUT_MS_VAR] = s.outMs === null ? null : `${s.outMs}ms`;
  vars[OUT_DELAY_VAR] = s.outDelay === null ? null : `${s.outDelay}ms`;
  return { attrs: { "data-step": s.in === null ? null : String(s.in), "data-step-out": s.out === null ? null : String(s.out) }, vars };
}

const ms = (v: string | null | undefined): number | null => { const r = readTime(v); return !r || r.issue === "time-invalid" ? null : r.ms; }; // 읽을 수 없는 시간은 없는 것으로, 범위 밖은 맞춰서

/** 속성값과 변수값(없으면 null)에서 읽는다. data-step-effect 별칭은 변수가 없을 때만 값으로 푼다. 잘못된 번호는 없는 것으로 읽는다(경고는 anim-core의 rangeOf) */
export function parse(attrs: { step?: string | null; stepOut?: string | null; effect?: string | null }, vars: Record<string, string | null | undefined> = {}): StepSpec {
  const away: Partial<Away> = {}, outAway: Partial<Away> = {};
  const alias = attrs.effect ? ALIAS[attrs.effect.trim()] : undefined;
  for (const k of AWAY_KEYS) {
    const v = vars[AWAY_VAR[k]], t = v == null ? "" : v.trim();
    if (t) away[k] = t; else if (alias?.away) away[k] = alias.away[k];
    const o = vars[OUT_VAR[k]], u = o == null ? "" : o.trim(); if (u) outAway[k] = u;
  }
  let m = ms(vars[MS_VAR]);
  if (m === null && alias?.ms !== undefined) m = alias.ms;
  const a = parseStepNumber(attrs.step ?? null), b = parseStepNumber(attrs.stepOut ?? null);
  return normalize({ in: a !== null && a >= 2 ? a : null, out: b !== null && b >= 2 ? b : null, ms: m, delay: ms(vars[DELAY_VAR]), away, outMs: ms(vars[OUT_MS_VAR]), outDelay: ms(vars[OUT_DELAY_VAR]), outAway });
}
export const specEqual = (a: StepSpec, b: StepSpec) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
