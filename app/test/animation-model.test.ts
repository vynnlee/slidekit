import { expect, test } from "bun:test";
import {
  QUICK, afterPrevious, applyQuick, awayOf, clearAll, clearOut, emptySpec, matchQuick, normalize, parse, serialize, setAway, setDelay, setIn, setMs, setOut, shift, specEqual, stepCount, visibleAt, type StepSpec,
} from "../src/lib/animation-model";

const S = (p: Partial<StepSpec> = {}): StepSpec => ({ ...emptySpec(), ...p });

test("보임 구간: N ≤ 단계 < M, 등장이 없으면 처음부터, 퇴장이 없으면 끝까지", () => {
  expect([1, 2, 3, 4].map((k) => visibleAt(S({ in: 2, out: 4 }), k))).toEqual([false, true, true, false]);
  expect([1, 2, 3].map((k) => visibleAt(S({ out: 3 }), k))).toEqual([true, true, false]);
  expect([1, 2, 5].map((k) => visibleAt(S({ in: 3 }), k))).toEqual([false, false, true]);
  expect(visibleAt(S(), 1)).toBe(true);
});

test("정규화: 2 미만과 정수가 아닌 값과 퇴장 ≤ 등장은 버린다", () => {
  expect(normalize(S({ in: 1 })).in).toBeNull();
  expect(normalize(S({ in: 2.5 })).in).toBeNull();
  expect(normalize(S({ in: 3, out: 3 })).out).toBeNull();
  expect(normalize(S({ in: 3, out: 2 })).out).toBeNull();
  expect(normalize(S({ out: 1 })).out).toBeNull();
  expect(normalize(S({ out: 2 })).out).toBe(2); // 등장 없이 퇴장만
  expect(normalize(S({ ms: 360 })).ms).toBeNull(); // 기본값은 쓰지 않는다
  expect(normalize(S({ ms: 0 })).ms).toBe(0);
  expect(normalize(S({ delay: 0 })).delay).toBeNull();
});

test("단계 수: data-steps와 모든 등장과 퇴장 중 최댓값(퇴장도 단계에 든다), 빈 슬라이드는 1", () => {
  expect(stepCount([])).toBe(1);
  expect(stepCount([S({ in: 3 }), S({ out: 5 })])).toBe(5);
  expect(stepCount([S({ in: 2 })], 6)).toBe(6);
  expect(stepCount([S({ in: 7, out: 9 })], 3)).toBe(9);
});

test("등장 이동: 1 이하는 등장 없음, 퇴장이 따라 밀려 보이는 구간을 지킨다", () => {
  expect(setIn(S({ in: 3 }), 1).in).toBeNull();
  expect(setIn(S({ in: 2, out: 4 }), 6)).toMatchObject({ in: 6, out: 7 });
  expect(setIn(S({ out: 3 }), 3)).toMatchObject({ in: 3, out: 4 });
  expect(setIn(S({ in: 4, out: 6 }), 2)).toMatchObject({ in: 2, out: 6 });
});

test("퇴장 이동: 등장 이하이면 퇴장 없음", () => {
  expect(setOut(S({ in: 3 }), 3).out).toBeNull();
  expect(setOut(S({ in: 3 }), 5).out).toBe(5);
  expect(setOut(S({ in: 3, out: 5 }), null).out).toBeNull();
  expect(clearOut(S({ in: 3, out: 5 }))).toMatchObject({ in: 3, out: null });
});

test("몸통 이동: 둘 다 같은 간격, 2 아래로 내려가지 않는다", () => {
  expect(shift(S({ in: 3, out: 5 }), 2)).toMatchObject({ in: 5, out: 7 });
  expect(shift(S({ in: 3, out: 5 }), -5)).toMatchObject({ in: 2, out: 4 });
  expect(shift(S({ out: 4 }), -9)).toMatchObject({ in: null, out: 2 });
  expect(shift(S({ in: 2 }), -1)).toMatchObject({ in: 2, out: null });
  expect(shift(S(), 3)).toEqual(S());
});

test("빠른 선택: 값을 채우고 같은 값이면 이름을 알아본다, 기본값(Rise)은 저장되지 않는다", () => {
  for (const [id, , a] of QUICK) { expect(awayOf(applyQuick(S({ in: 2 }), id))).toEqual(a); expect(matchQuick(applyQuick(S({ in: 2 }), id))).toBe(id); }
  expect(applyQuick(S({ in: 2 }), "rise").away).toEqual({}); // 기본과 같아 변수가 없다
  expect(serialize(applyQuick(S({ in: 2 }), "fade")).vars["--sk-away-y"]).toBe("0px");
  expect(matchQuick(S())).toBe("rise"); // 아무것도 없으면 기본 효과
  expect(matchQuick(setAway(S(), "x", "5px"))).toBeNull();
});

test("After previous: 같은 단계 앞 요소 중 가장 늦게 끝나는 것 뒤로 지연을 채운다(숫자만)", () => {
  expect(afterPrevious(S({ in: 2 }), [])).toMatchObject({ delay: null });
  expect(afterPrevious(S({ in: 2 }), [S({ in: 2 })]).delay).toBe(360);
  expect(afterPrevious(S({ in: 2 }), [S({ in: 2, ms: 200, delay: 100 }), S({ in: 2, ms: 500 })]).delay).toBe(500);
  expect(setDelay(setMs(S({ in: 2 }), 1000), 250)).toMatchObject({ ms: 1000, delay: 250 });
});

test("직렬화: 속성과 변수만, 기본값과 빈 값은 지우라는 null", () => {
  const sp = serialize(S({ in: 3, out: 5, ms: 500, delay: 120, away: { opacity: "0.2", x: "-32px" } }));
  expect(sp.attrs).toEqual({ "data-step": "3", "data-step-out": "5" });
  expect(sp.vars).toMatchObject({ "--sk-away-opacity": "0.2", "--sk-away-x": "-32px", "--sk-away-y": null, "--sk-step-ms": "500ms", "--sk-step-delay": "120ms" });
  const none = serialize(S());
  expect(none.attrs).toEqual({ "data-step": null, "data-step-out": null });
  expect(Object.values(none.vars).every((v) => v === null)).toBe(true);
});

test("파싱: 속성과 변수에서 읽고 s와 ms를 모두 받고 잘못된 값은 버린다", () => {
  expect(parse({ step: "3", stepOut: "5" }, { "--sk-step-ms": "0.5s", "--sk-step-delay": "200ms", "--sk-away-y": " 0px " })).toEqual(S({ in: 3, out: 5, ms: 500, delay: 200, away: { y: "0px" } }));
  expect(parse({ step: "abc", stepOut: "1" })).toEqual(S());
  expect(parse({ step: "3", stepOut: "2" }).out).toBeNull();
  expect(parse({ step: " 4 " }).in).toBe(4);
});

test("기존 별칭 data-step-effect는 변수가 없을 때만 값으로 풀리고 none은 전환 시간 0", () => {
  expect(awayOf(parse({ step: "2", effect: "left" }))).toMatchObject({ x: "-32px", y: "0px" });
  expect(parse({ step: "2", effect: "none" }).ms).toBe(0);
  expect(awayOf(parse({ step: "2", effect: "left" }, { "--sk-away-x": "10px" })).x).toBe("10px"); // 변수가 이긴다
  expect(parse({ step: "2", effect: "rise" }).away).toEqual({}); // rise는 기본과 같다
  expect(parse({ step: "2", effect: "zzz" })).toEqual(S({ in: 2 }));
});

test("같은 번호를 여럿이 쓰고(함께 일어남) 중첩 요소와 잠긴 요소도 각자의 사양이 독립이다", () => {
  const a = setIn(S(), 3), b = setIn(S(), 3), c = setIn(S(), 4);
  expect(stepCount([a, b, c])).toBe(4);
  expect([a, b, c].map((s) => visibleAt(s, 3))).toEqual([true, true, false]);
});

// 시드 고정 난수로 연산을 섞는다: 불변식과 왕복
function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
test("퍼즈: 무작위 연산 뒤에도 불변식이 유지되고 직렬화에서 파싱으로 돌아오면 같다", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const R = rng(seed), pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)], int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
    let specs: StepSpec[] = Array.from({ length: 6 }, () => S());
    for (let i = 0; i < 300; i++) {
      const j = int(0, specs.length - 1), s = specs[j];
      const op = pick(["in", "out", "shift", "clearOut", "clearAll", "quick", "away", "ms", "delay", "after"] as const);
      let t = s;
      if (op === "in") t = setIn(s, int(-1, 12));
      else if (op === "out") t = setOut(s, R() < 0.2 ? null : int(0, 14));
      else if (op === "shift") t = shift(s, int(-6, 6));
      else if (op === "clearOut") t = clearOut(s);
      else if (op === "clearAll") t = clearAll(s);
      else if (op === "quick") t = applyQuick(s, pick(QUICK)[0]);
      else if (op === "away") t = setAway(s, pick(["opacity", "x", "y", "scale", "blur"] as const), pick(["0", "0px", "20px", "-32px", "0.5", "12px"]));
      else if (op === "ms") t = setMs(s, R() < 0.3 ? null : pick([0, 120, 360, 800]));
      else if (op === "delay") t = setDelay(s, R() < 0.3 ? null : pick([0, 100, 360]));
      else t = afterPrevious(s, specs.filter((x, k) => k !== j && x.in === s.in));
      specs = specs.map((x, k) => (k === j ? t : x));
      for (const x of specs) {
        expect(x.in === null || (Number.isInteger(x.in) && x.in >= 2)).toBe(true);
        expect(x.out === null || (Number.isInteger(x.out) && x.out >= 2 && x.out > (x.in ?? 1))).toBe(true);
        const ser = serialize(x), back = parse({ step: ser.attrs["data-step"], stepOut: ser.attrs["data-step-out"] }, ser.vars);
        expect(specEqual(back, x)).toBe(true);
        expect(JSON.stringify(back)).toBe(JSON.stringify(normalize(x)));
      }
      const n = stepCount(specs);
      expect(n).toBeGreaterThanOrEqual(Math.max(1, ...specs.map((x) => Math.max(x.in ?? 1, x.out ?? 1))));
      expect(n).toBe(Math.max(1, ...specs.flatMap((x) => [x.in ?? 1, x.out ?? 1])));
      for (const x of specs) if (x.in !== null || x.out !== null) expect(Array.from({ length: n }, (_, k) => visibleAt(x, k + 1)).some(Boolean)).toBe(true); // 보이는 구간이 비지 않는다
    }
  }
});
