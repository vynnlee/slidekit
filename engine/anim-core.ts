// 단계 애니메이션 규칙의 참조 구현(spec/ANIMATION.md v2). DOM이 없는 순수 함수라 lint, 편집기 모델, 시험이 같이 쓴다.
// 덱에는 들어가지 않는다. 브라우저 엔진(slidekit.js)은 같은 규칙을 바닐라 JS로 따로 구현하고, 시험 표(test/anim-core.cases.json)로 둘을 맞춘다.

export const DEFAULT_MS = 360;
export const MAX_MS = 10000;

export type Issue = { code: string; attr: string; value: string };
export type Range = { n: number; m: number | null; issues: Issue[] }; // n: 등장 번호(1 = 처음부터), m: 퇴장 번호

// 3.8절: 앞뒤 공백을 지우고 숫자만 있으면 정수. 4e0, 0x4, 2.5, 빈 문자열, 음수, 글자는 유효하지 않다.
export function parseStepNumber(v: string | null): number | null {
  if (v === null) return null;
  const t = v.trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

// 요소 하나의 보임 구간. 엔진의 rangeOf와 같은 규칙: 잘못된 등장은 무시(처음부터 보임), 잘못된 퇴장과 등장 이하의 퇴장은 무시.
export function rangeOf(step: string | null, stepOut: string | null): Range {
  const issues: Issue[] = [];
  let n = 1, m: number | null = null;
  if (step !== null) {
    const a = parseStepNumber(step);
    if (a !== null && a >= 2) n = a;
    else issues.push({ code: a === 1 ? "step-one" : "step-invalid", attr: "data-step", value: step });
  }
  if (stepOut !== null) {
    const b = parseStepNumber(stepOut);
    if (b === null || b < 2) issues.push({ code: "out-invalid", attr: "data-step-out", value: stepOut });
    else if (b <= n) issues.push({ code: "out-before-in", attr: "data-step-out", value: stepOut });
    else m = b;
  }
  return { n, m, issues };
}

// 시간 값("360ms", "0.4s")을 ms로. 없으면 undefined, 읽을 수 없으면(단위 없음, 글자) invalid, 0~MAX_MS로 맞춘다(엔진 CSS의 clamp와 같다).
export function readTime(v: string | null | undefined): { ms: number; issue?: string } | undefined {
  if (v === null || v === undefined || v.trim() === "") return undefined;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(ms|s)$/i.exec(v.trim());
  if (!m) return { ms: 0, issue: "time-invalid" };
  const ms = Number(m[1]) * (m[2].toLowerCase() === "s" ? 1000 : 1);
  if (ms < 0) return { ms: 0, issue: "time-negative" };
  if (ms > MAX_MS) return { ms: MAX_MS, issue: "time-range" };
  return { ms };
}

export type StepEl = {
  step: string | null; stepOut: string | null; // data-step, data-step-out
  ms?: string | null; delay?: string | null; // --sk-step-ms, --sk-step-delay
  outMs?: string | null; outDelay?: string | null; // --sk-out-ms, --sk-out-delay (없으면 등장 값)
};
export type Entry = { el: number; kind: "in" | "out"; step: number; click: number; start: number; len: number; end: number; issues: Issue[] };
export type Analysis = { ranges: Range[]; numbers: number[]; steps: number; entries: Entry[]; clickLength: number[] };

// 3.7절: 쓰인 번호의 집합을 오름차순으로 세어 클릭(단계 = 클릭 + 1). 번호가 2부터 빠짐없으면 번호 그대로다.
export function compress(ranges: readonly Range[]): { numbers: number[]; stepOf: (n: number) => number } {
  const set = new Set<number>();
  for (const r of ranges) { if (r.n >= 2) set.add(r.n); if (r.m !== null) set.add(r.m); }
  const numbers = [...set].sort((a, b) => a - b);
  const rank = new Map(numbers.map((v, i) => [v, i + 2]));
  return { numbers, stepOf: (n) => (n < 2 ? 1 : (rank.get(n) as number)) };
}

// 슬라이드의 단계 수(1부터). stepper가 등록돼 있으면 압축하지 않고 옛 규칙(data-steps와 요소 번호의 최댓값). 선언형이면 data-steps는 무시한다.
export function slideSteps(opts: { dataSteps?: number; stepper: boolean; ranges: readonly Range[] }): { steps: number; dataStepsIgnored: boolean } {
  const ds = opts.dataSteps ?? 1;
  if (opts.stepper) {
    let max = Math.max(1, ds);
    for (const r of opts.ranges) max = Math.max(max, r.n, r.m ?? 1);
    return { steps: max, dataStepsIgnored: false };
  }
  const has = opts.ranges.some((r) => r.n >= 2 || r.m !== null);
  return { steps: 1 + compress(opts.ranges).numbers.length, dataStepsIgnored: has && ds > 1 };
}

export const visibleAt = (r: Range, step: number) => step >= r.n && (r.m === null || step < r.m); // 압축 전 번호 기준

// 3.9절: 타임라인이 그릴 항목. 한 클릭 안의 순서는 (start, 등장 먼저, 요소 순서). 시간 변수가 잘못되면 전환이 없는 것으로 읽는다.
export function analyze(els: readonly StepEl[]): Analysis {
  const ranges = els.map((e) => rangeOf(e.step, e.stepOut));
  const { numbers, stepOf } = compress(ranges);
  const entries: Entry[] = [];
  els.forEach((e, el) => {
    const r = ranges[el];
    const t = (v: string | null | undefined, fallback: string | null | undefined, def: number, attr: string, issues: Issue[]) => {
      const got = readTime(v) ?? readTime(fallback);
      if (!got) return def;
      if (got.issue) issues.push({ code: got.issue, attr, value: String(v ?? fallback) });
      return got.ms;
    };
    if (r.n >= 2) {
      const issues: Issue[] = [];
      const len = t(e.ms, null, DEFAULT_MS, "--sk-step-ms", issues), start = t(e.delay, null, 0, "--sk-step-delay", issues);
      entries.push({ el, kind: "in", step: r.n, click: stepOf(r.n) - 1, start, len, end: start + len, issues });
    }
    if (r.m !== null) {
      const issues: Issue[] = [];
      const len = t(e.outMs, e.ms, DEFAULT_MS, "--sk-out-ms", issues), start = t(e.outDelay, e.delay, 0, "--sk-out-delay", issues);
      entries.push({ el, kind: "out", step: r.m, click: stepOf(r.m) - 1, start, len, end: start + len, issues });
    }
  });
  entries.sort((a, b) => a.click - b.click || a.start - b.start || (a.kind === b.kind ? 0 : a.kind === "in" ? -1 : 1) || a.el - b.el);
  const clickLength = numbers.map(() => 0);
  for (const e of entries) clickLength[e.click - 1] = Math.max(clickLength[e.click - 1], e.end);
  return { ranges, numbers, steps: 1 + numbers.length, entries, clickLength };
}
