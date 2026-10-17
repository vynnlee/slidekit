import { expect, test } from "bun:test";
import {
  DEFAULT_MS, QUICK, awayOf, emptySpec, freezeOut, matchQuick, normalize, outAwayOf, outDelayOf, outMsOf, parse, quickOf, serialize, specEqual, type StepSpec,
} from "../src/lib/animation-model";

const S = (p: Partial<StepSpec> = {}): StepSpec => ({ ...emptySpec(), ...p });

test("정규화: 2 미만과 정수가 아닌 번호, 퇴장 번호 <= 등장 번호는 버린다", () => {
  expect(normalize(S({ in: 1 })).in).toBeNull();
  expect(normalize(S({ in: 2.5 })).in).toBeNull();
  expect(normalize(S({ in: 3, out: 3 })).out).toBeNull();
  expect(normalize(S({ in: 3, out: 2 })).out).toBeNull();
  expect(normalize(S({ out: 1 })).out).toBeNull();
  expect(normalize(S({ out: 2 })).out).toBe(2); // 등장 없이 퇴장만
});

test("정규화: 시간은 0~10000ms 정수로 맞추고 기본값과 같은 등장 값은 쓰지 않는다, 퇴장 값은 기본과 같아도 지키지 않고 남긴다", () => {
  expect(normalize(S({ ms: DEFAULT_MS })).ms).toBeNull();
  expect(normalize(S({ ms: 0 })).ms).toBe(0);
  expect(normalize(S({ ms: 99999 })).ms).toBe(10000);
  expect(normalize(S({ ms: 12.6 })).ms).toBe(13);
  expect(normalize(S({ delay: 0 })).delay).toBeNull();
  expect(normalize(S({ delay: -5 })).delay).toBeNull();
  expect(normalize(S({ outDelay: 0 })).outDelay).toBe(0);
  expect(normalize(S({ away: { y: "20px" } })).away).toEqual({}); // 기본(Rise)과 같다
  expect(normalize(S({ outAway: { y: "20px" } })).outAway).toEqual({ y: "20px" }); // 퇴장은 폴백이 등장 값이라 지우지 않는다
});

test("직렬화: 속성과 변수만, 기본값과 빈 값은 지우라는 null, 퇴장 전용 변수 이름은 --sk-out-*", () => {
  const sp = serialize(S({ in: 3, out: 5, ms: 500, delay: 120, away: { opacity: "0.2", x: "-32px" }, outMs: 800, outDelay: 0, outAway: { y: "0px" } }));
  expect(sp.attrs).toEqual({ "data-step": "3", "data-step-out": "5" });
  expect(sp.vars).toMatchObject({ "--sk-away-opacity": "0.2", "--sk-away-x": "-32px", "--sk-away-y": null, "--sk-step-ms": "500ms", "--sk-step-delay": "120ms", "--sk-out-ms": "800ms", "--sk-out-delay": "0ms", "--sk-out-y": "0px", "--sk-out-x": null });
  const none = serialize(S());
  expect(none.attrs).toEqual({ "data-step": null, "data-step-out": null });
  expect(Object.values(none.vars).every((v) => v === null)).toBe(true);
});

test("파싱: 속성과 변수에서 읽고 s와 ms를 모두 받는다, 읽을 수 없는 시간은 없는 값, 범위 밖은 맞춘다", () => {
  expect(parse({ step: "3", stepOut: "5" }, { "--sk-step-ms": "0.5s", "--sk-step-delay": "200ms", "--sk-away-y": " 0px ", "--sk-out-ms": "1.5s", "--sk-out-opacity": "0.5" }))
    .toEqual(S({ in: 3, out: 5, ms: 500, delay: 200, away: { y: "0px" }, outMs: 1500, outAway: { opacity: "0.5" } }));
  expect(parse({ step: "abc", stepOut: "1" })).toEqual(S());
  expect(parse({ step: "3", stepOut: "2" }).out).toBeNull();
  expect(parse({ step: " 4 " }).in).toBe(4);
  expect(parse({ step: "2" }, { "--sk-step-ms": "360" }).ms).toBeNull(); // 단위 없음 = 읽을 수 없음
  expect(parse({ step: "2" }, { "--sk-step-ms": "20000ms" }).ms).toBe(10000);
  expect(parse({ step: "2" }, { "--sk-step-delay": "-5ms" }).delay).toBeNull(); // 음수는 0으로 맞춰져 지연 없음
});

test("기존 별칭 data-step-effect는 변수가 없을 때만 값으로 풀리고 none은 전환 시간 0", () => {
  expect(awayOf(parse({ step: "2", effect: "left" }))).toMatchObject({ x: "-32px", y: "0px" });
  expect(parse({ step: "2", effect: "none" }).ms).toBe(0);
  expect(awayOf(parse({ step: "2", effect: "left" }, { "--sk-away-x": "10px" })).x).toBe("10px"); // 변수가 이긴다
  expect(parse({ step: "2", effect: "rise" }).away).toEqual({}); // rise는 기본과 같다
  expect(parse({ step: "2", effect: "zzz" })).toEqual(S({ in: 2 }));
});

test("빠른 선택: 값에서 이름을 알아보고, 퇴장 값은 없으면 등장 값을 따라간다", () => {
  for (const [id, , a] of QUICK) expect(quickOf(a)).toBe(id);
  expect(matchQuick(S())).toBe("rise"); // 아무것도 없으면 기본 효과
  expect(matchQuick(S({ away: { x: "5px" } }))).toBeNull();
  const s = S({ in: 2, out: 3, ms: 800, delay: 100, away: { x: "-32px", y: "0px" } });
  expect(outAwayOf(s)).toEqual(awayOf(s)); // 폴백
  expect([outMsOf(s), outDelayOf(s)]).toEqual([800, 100]);
  expect(outAwayOf({ ...s, outAway: { opacity: "1" } }).opacity).toBe("1");
});

test("퇴장 값 굳히기: 등장 값을 고쳐도 퇴장이 따라 바뀌지 않게 지금 값을 퇴장 변수로 적는다", () => {
  const f = freezeOut(S({ in: 2, out: 3, ms: 800, delay: 100, away: { x: "-32px" } }));
  expect(f.outMs).toBe(800); expect(f.outDelay).toBe(100); expect(f.outAway.x).toBe("-32px"); expect(f.outAway.opacity).toBe("0");
  expect(freezeOut(S({ in: 2 }))).toEqual(S({ in: 2 })); // 퇴장이 없으면 그대로
});

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
test("퍼즈: 무작위 값에서 직렬화 -> 파싱 왕복이 같고 불변식이 유지된다", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const R = rng(seed), pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)], int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
    for (let i = 0; i < 200; i++) {
      const inn = R() < 0.7 ? int(0, 9) : null, out = R() < 0.5 ? int(0, 12) : null;
      const away: StepSpec["away"] = {}, outAway: StepSpec["outAway"] = {};
      for (const k of ["opacity", "x", "y", "scale", "blur"] as const) { if (R() < 0.3) away[k] = pick(["0", "0px", "20px", "-32px", "0.5", "12px"]); if (R() < 0.3) outAway[k] = pick(["0", "0px", "20px", "1"]); }
      const x = S({ in: inn, out, ms: R() < 0.5 ? int(-50, 12000) : null, delay: R() < 0.5 ? int(-50, 12000) : null, away, outMs: R() < 0.4 ? int(0, 3000) : null, outDelay: R() < 0.4 ? int(0, 3000) : null, outAway });
      const n = normalize(x);
      expect(n.in === null || (Number.isInteger(n.in) && n.in >= 2)).toBe(true);
      expect(n.out === null || (Number.isInteger(n.out) && n.out >= 2 && n.out > (n.in ?? 1))).toBe(true);
      for (const v of [n.ms, n.delay, n.outMs, n.outDelay]) expect(v === null || (v >= 0 && v <= 10000 && Number.isInteger(v))).toBe(true);
      const ser = serialize(x), back = parse({ step: ser.attrs["data-step"], stepOut: ser.attrs["data-step-out"] }, ser.vars);
      expect(JSON.stringify(back)).toBe(JSON.stringify(n));
      expect(specEqual(back, x)).toBe(true);
    }
  }
});
