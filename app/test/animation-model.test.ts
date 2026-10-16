import { expect, test } from "bun:test";
import {
  QUICK, afterPrevious, buildList, edit, layout, type Entry, type Op, applyQuick, awayOf, clearAll, clearOut, emptySpec, matchQuick, normalize, parse, serialize, setAway, setDelay, setIn, setMs, setOut, shift, specEqual, stepCount, visibleAt, type StepSpec,
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

// ---- 애니메이션 목록(줄 <-> 속성) ----
const E = (...specs: Partial<StepSpec>[]): Entry[] => specs.map((p, i) => ({ id: "e" + i, spec: S(p) }));
const apply = (es: Entry[], m: Map<string, StepSpec> | null) => es.map((e) => ({ id: e.id, spec: m?.get(e.id) ?? e.spec }));
const shape = (es: Entry[]) => buildList(es).map((r) => `${r.id}.${r.kind}:${r.step}${r.start[0]}`).join(" ");

test("목록 읽기: 단계 순서, 단계의 첫 줄은 On click, 지연이 같으면 With, 더 크면 After", () => {
  const es = E({ in: 3 }, { in: 2 }, { in: 2, delay: 360 }, { in: 2, delay: 0 }, { out: 3, in: 2 });
  expect(shape(es)).toBe("e1.in:2c e3.in:2w e4.in:2w e2.in:2a e0.in:3c e4.out:3w");
});

test("읽기 -> 쓰기 -> 읽기: 연속한 단계는 한 글자도 바꾸지 않고, 빈 번호는 당겨 붙인다", () => {
  const es = E({ in: 2 }, { in: 2, delay: 360 }, { in: 3, out: 5 }, { out: 4 }, { in: 5, ms: 800, away: { y: "0px" } });
  const rows = buildList(es), same = layout(rows, rows.map((r) => r.start), new Map(es.map((e) => [e.id, e.spec])), rows);
  expect(same?.size).toBe(0);
  const gap = E({ in: 2 }, { in: 4 }, { in: 4, delay: 100 }, { in: 7 });
  const m = edit(gap, { t: "start", at: 0, start: "click" }); // 첫 줄은 이미 On click이라 할 일이 없다
  expect(m).toBeNull();
  const g2 = layout(buildList(gap), buildList(gap).map((r) => r.start), new Map(gap.map((e) => [e.id, e.spec])), buildList(gap))!;
  expect([...g2].map(([id, s]) => id + ":" + s.in)).toEqual(["e1:3", "e2:3", "e3:4"]);
  const again = apply(gap, g2);
  expect(shape(again)).toBe("e0.in:2c e1.in:3c e2.in:3a e3.in:4c");
  const r2 = buildList(again);
  expect(layout(r2, r2.map((r) => r.start), new Map(again.map((e) => [e.id, e.spec])), r2)?.size).toBe(0);
});

test("순서 바꾸기: 줄 하나가 옮겨 가고 의미(시작 방식)가 따라온다", () => {
  const es = E({ in: 2 }, { in: 3 }, { in: 4 });
  const m = edit(es, { t: "move", from: 2, to: 0 })!; // e2가 맨 위로: 모두 새 클릭 단계 유지
  expect(shape(apply(es, m))).toBe("e2.in:2c e0.in:3c e1.in:4c");
  const w = edit(es, { t: "start", at: 1, start: "with" })!; // e1을 With previous로: 같은 단계 2, e2가 3으로 당겨진다
  expect(shape(apply(es, w))).toBe("e0.in:2c e1.in:2w e2.in:3c");
});

test("With와 After 계산: With=같은 단계 같은 지연, After=앞 줄의 지연+시간, On click=새 단계", () => {
  const es = E({ in: 2, ms: 500 }, { in: 3 }, { in: 4 });
  const a = apply(es, edit(es, { t: "start", at: 1, start: "after" }));
  expect(a[1].spec).toMatchObject({ in: 2, delay: 500 });
  const b = apply(a, edit(a, { t: "start", at: 2, start: "with" }));
  expect(b[2].spec).toMatchObject({ in: 2, delay: 500 });
  const c = apply(b, edit(b, { t: "start", at: 2, start: "click" }));
  expect(c[2].spec).toMatchObject({ in: 3, delay: null });
});

test("줄 추가와 삭제: 선택한 줄 아래에 On click으로 넣고, 지우면 번호가 당겨지며 마지막 줄이면 속성이 모두 사라진다", () => {
  const es = E({ in: 2 }, { in: 3 }, {});
  const add = apply(es, edit(es, { t: "add", id: "e2", kind: "in", after: 0 }));
  expect(shape(add)).toBe("e0.in:2c e2.in:3c e1.in:4c");
  const del = apply(add, edit(add, { t: "remove", at: 0 }));
  expect(shape(del)).toBe("e2.in:2c e1.in:3c");
  expect(del[0].spec).toEqual(S()); // 안 쓰는 요소는 속성 없음
  expect(edit(es, { t: "add", id: "e0", kind: "in", after: null })).toBeNull(); // 이미 있다
});

test("한 요소의 퇴장은 항상 등장 뒤, 등장은 퇴장 앞이다", () => {
  const es = E({ in: 2 }, { in: 3, out: 4 });
  const o = apply(es, edit(es, { t: "add", id: "e0", kind: "out", after: null }));
  expect(shape(o)).toBe("e0.in:2c e1.in:3c e1.out:4c e0.out:5c"); // 퇴장 e0은 맨 아래
  expect(edit(es, { t: "move", from: 2, to: 0 })).toBeNull(); // e1 퇴장을 자기 등장 위로
  const oOnly = E({ out: 3 }, { in: 2 });
  const inn = apply(oOnly, edit(oOnly, { t: "add", id: "e0", kind: "in", after: 1 }));
  expect(shape(inn)).toBe("e1.in:2c e0.in:3c e0.out:4c");
  const withOut = edit(es, { t: "start", at: 2, start: "with" }); // e1 퇴장이 자기 등장과 같은 단계가 되면 안 된다
  expect(withOut === null || apply(es, withOut)[1].spec.out! > 3).toBe(true);
});

test("퍼즈: 무작위 목록 편집 뒤에도 불변식(등장 < 퇴장, 단계는 2부터 빠짐없이)과 읽기 쓰기 안정", () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const R = rng(seed), int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
    let es = E({}, {}, {}, {}, {}, {});
    for (let i = 0; i < 200; i++) {
      const rows = buildList(es), n = rows.length, id = "e" + int(0, 5);
      const kind = R() < 0.6 ? "in" : "out";
      const ops: Op[] = [{ t: "move", from: int(0, Math.max(0, n - 1)), to: int(0, Math.max(0, n - 1)) }, { t: "start", at: int(0, Math.max(0, n - 1)), start: (["click", "with", "after"] as const)[int(0, 2)] },
        { t: "remove", at: int(0, Math.max(0, n - 1)) }, { t: "add", id, kind, after: R() < 0.3 ? null : int(0, Math.max(0, n - 1)) }];
      es = apply(es, edit(es, ops[int(0, 3)]));
      for (const e of es) expect(e.spec.out === null || e.spec.out > (e.spec.in ?? 1)).toBe(true);
      const l = buildList(es), steps = [...new Set(l.map((r) => r.step))];
      expect(steps).toEqual(steps.map((_, k) => k + 2)); // 빈 번호가 없다
      expect(layout(l, l.map((r) => r.start), new Map(es.map((e) => [e.id, e.spec])), l)?.size).toBe(0);
    }
  }
});

test("실제 덱 둘: 모든 슬라이드의 단계 속성을 줄로 읽었다 되써도 바이트가 그대로다(바뀔 것이 없다)", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  for (const deck of ["vibe-coding-workshop", "slidekit-guide"]) {
    const f = new URL(`../../decks/${deck}/index.html`, import.meta.url);
    if (!existsSync(f)) continue;
    const html = readFileSync(f, "utf8");
    let withSteps = 0;
    for (const sec of html.split(/<section\b[^>]*data-slide/).slice(1)) {
      const entries: Entry[] = [...sec.split("</section>")[0].matchAll(/<[a-z0-9]+\s[^>]*data-step(?:-out)?=[^>]*>/gi)].map((m, i) => {
        const tag = m[0], at = (n: string) => new RegExp(`\\sdata-${n}="([^"]*)"`).exec(tag)?.[1] ?? null, v = (n: string) => new RegExp(`${n}:\\s*([^;"]+)`).exec(/style="([^"]*)"/.exec(tag)?.[1] ?? "")?.[1] ?? null;
        return { id: "x" + i, spec: parse({ step: at("step"), stepOut: at("step-out"), effect: at("step-effect") }, { "--sk-step-delay": v("--sk-step-delay"), "--sk-step-ms": v("--sk-step-ms") }) };
      });
      if (!entries.some((e) => hasAnimationSpec(e.spec))) continue;
      withSteps++;
      const l = buildList(entries), steps = [...new Set(l.map((r) => r.step))];
      if (steps.every((s, k) => s === k + 2)) expect(layout(l, l.map((r) => r.start), new Map(entries.map((e) => [e.id, e.spec])), l)?.size).toBe(0);
    }
    expect(withSteps).toBeGreaterThan(0);
  }
});
const hasAnimationSpec = (s: StepSpec) => s.in !== null || s.out !== null;
