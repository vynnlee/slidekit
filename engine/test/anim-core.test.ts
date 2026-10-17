import { expect, test } from "bun:test";
import cases from "./anim-core.cases.json";
import { analyze, parseStepNumber, rangeOf, readTime, slideSteps, visibleAt } from "../anim-core";

test("단계 번호 파싱", () => { for (const [v, want] of cases.stepNumber) expect(parseStepNumber(v as string)).toBe(want as number | null); });
test("보임 구간과 문제 코드", () => {
  for (const c of cases.range) {
    const r = rangeOf(c.step, c.out);
    expect([r.n, r.m, r.issues.map((i) => i.code)]).toEqual([c.n, c.m, c.issues]);
  }
});
test("시간 읽기(ms 정규화와 0~10000 맞춤)", () => {
  for (const [v, ms, issue] of cases.time) expect(readTime(v as string)).toEqual(issue ? { ms, issue } : { ms });
  expect(readTime(null)).toBeUndefined();
});
test("압축과 단계 수", () => {
  for (const d of cases.decks) {
    const els = d.els.map(([step, stepOut]) => ({ step, stepOut }));
    const a = analyze(els);
    const s = slideSteps({ dataSteps: d.dataSteps, stepper: d.stepper, ranges: a.ranges });
    expect([d.name, s.steps, d.stepper ? undefined : a.numbers, s.dataStepsIgnored]).toEqual([d.name, d.steps, d.stepper ? undefined : d.numbers, !!d.ignored]);
  }
});
test("빈 클릭이 없다: 단계마다 보임이 바뀌는 요소가 있다(무작위 시드)", () => {
  let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let t = 0; t < 200; t++) {
    const els = Array.from({ length: 1 + rnd(8) }, () => {
      const a = rnd(4) ? String(2 + rnd(30)) : null; // 건너뛰는 번호
      const b = rnd(3) ? null : String(2 + rnd(30));
      return { step: a, stepOut: b };
    });
    const a = analyze(els);
    for (let k = 2; k <= a.steps; k++) {
      // 압축 번호 u_(k-1)가 단계 k다: 그 번호를 쓰는 등장 또는 퇴장이 있다
      const u = a.numbers[k - 2];
      expect(a.ranges.some((r) => r.n === u || r.m === u)).toBe(true);
    }
    // 번호 이름 바꾸기: 2…K로 다시 매긴 덱과 모든 단계에서 보임이 같다(메타모픽)
    const rename = new Map(a.numbers.map((v, i) => [v, i + 2]));
    const renamed = els.map((_, i) => rangeOf(a.ranges[i].n >= 2 ? String(rename.get(a.ranges[i].n)) : null, a.ranges[i].m !== null ? String(rename.get(a.ranges[i].m as number)) : null));
    const b = analyze(renamed.map((r) => ({ step: r.n >= 2 ? String(r.n) : null, stepOut: r.m !== null ? String(r.m) : null })));
    expect(b.steps).toBe(a.steps);
    for (let k = 1; k <= a.steps; k++) a.ranges.forEach((r, i) => {
      const ra = (n: number) => (n < 2 ? 1 : (rename.get(n) as number));
      const mapped = { n: ra(r.n), m: r.m === null ? null : ra(r.m), issues: [] };
      expect(visibleAt(mapped, k)).toBe(visibleAt(b.ranges[i], k));
    });
  }
});
test("항목: 클릭, 시작, 길이, 클릭 길이와 퇴장 값 폴백", () => {
  const a = analyze([
    { step: "3", stepOut: null, ms: "400ms", delay: "100ms" }, // 클릭 1
    { step: "3", stepOut: "7", ms: "200ms", delay: "0ms", outMs: "0.5s", outDelay: "50ms" }, // 등장 클릭 1, 퇴장 클릭 2
    { step: null, stepOut: "3", ms: "300ms" }, // 퇴장 클릭 1, 퇴장 값 없음 = 등장 값
  ]);
  expect(a.numbers).toEqual([3, 7]);
  expect(a.entries.map((e) => [e.el, e.kind, e.click, e.start, e.len])).toEqual([
    [1, "in", 1, 0, 200], [2, "out", 1, 0, 300], [0, "in", 1, 100, 400], [1, "out", 2, 50, 500],
  ]);
  expect(a.clickLength).toEqual([500, 550]);
  expect(analyze([{ step: "2", stepOut: null }]).entries[0]).toMatchObject({ start: 0, len: 360 });
  expect(analyze([{ step: "2", stepOut: null, ms: "abc" }]).entries[0].issues[0].code).toBe("time-invalid");
});
