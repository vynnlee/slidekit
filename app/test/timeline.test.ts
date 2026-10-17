import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { emptySpec, parse, specEqual, type StepSpec } from "../src/lib/animation-model";
import { addBar, aboveOf, barOf, moveToClick, relationOf, removeBar, setBarTime, setEffect, snap, snapTargets, timelineOf, type Res } from "../src/lib/timeline";

const S = (p: Partial<StepSpec> = {}): StepSpec => ({ ...emptySpec(), ...p });
const apply = (specs: StepSpec[], r: Res): StepSpec[] => { if (!r.ok) throw new Error(r.reason); return specs.map((s, i) => r.changed.get(i) ?? s); };
const clicks = (specs: StepSpec[]) => timelineOf(specs).clicks.map((c) => c.bars.map((b) => `${b.el}${b.kind === "in" ? "i" : "o"}@${b.start}+${b.len}`).join(" ")).join(" | ");

test("타임라인 읽기: 클릭 순위(빈 번호 압축), 구역 안 순서는 시작, 등장 먼저, 요소 순서, 구역 길이 T", () => {
  const specs = [S({ in: 3, delay: 200, ms: 500 }), S({ in: 3 }), S({ in: 7, out: 9 }), S({ out: 3, outMs: 100 })];
  const tl = timelineOf(specs);
  expect(tl.numbers).toEqual([3, 7, 9]);
  expect(clicks(specs)).toBe("1i@0+360 3o@0+100 0i@200+500 | 2i@0+360 | 2o@0+360");
  expect(tl.clicks.map((c) => c.length)).toEqual([700, 360, 360]);
  expect(barOf(tl, 2, "out")?.click).toBe(3);
});

test("퇴장 값이 없으면 등장 값을 따라가고, 있으면 따로 쓴다", () => {
  expect(clicks([S({ in: 2, out: 3, ms: 800, delay: 100 })])).toBe("0i@100+800 | 0o@100+800");
  expect(clicks([S({ in: 2, out: 3, ms: 800, delay: 100, outMs: 200, outDelay: 0 })])).toBe("0i@100+800 | 0o@0+200");
});

test("막대 추가: In은 맨 뒤의 새 클릭(자기 Out이 있으면 그 앞), Out은 맨 뒤의 새 클릭, 이미 있으면 거절", () => {
  let sp = [S(), S(), S()];
  sp = apply(sp, addBar(sp, 0, "in")); sp = apply(sp, addBar(sp, 1, "in")); sp = apply(sp, addBar(sp, 2, "in"));
  expect(sp.map((s) => s.in)).toEqual([2, 3, 4]);
  sp = apply(sp, addBar(sp, 0, "out"));
  expect(sp[0]).toMatchObject({ in: 2, out: 5 });
  expect(addBar(sp, 0, "in").ok).toBe(false);
  const only = [S({ out: 3 }), S({ in: 2 })];
  const r = apply(only, addBar(only, 0, "in")); // 자기 Out(3) 앞의 새 클릭 -> 2와 3 사이 정수 없음: 뒤를 민다
  expect(r.map((s) => [s.in, s.out])).toEqual([[3, 4], [2, null]]);
});

test("새 구역은 이웃 번호 사이의 정수를 쓰고(다른 요소를 안 씀), 정수가 없을 때만 뒤 번호를 민다", () => {
  const sp = [S({ in: 2 }), S({ in: 6 }), S({ in: 7 }), S({})];
  const mid = addBar(sp, 3, "in", { gap: 1 }); // click1(2)과 click2(6) 사이: 3
  expect(mid.ok && [...mid.changed.keys()]).toEqual([3]);
  expect(apply(sp, mid)[3].in).toBe(3);
  const tight = addBar(sp, 3, "in", { gap: 2 }); // 6과 7 사이: 정수 없음 -> 7 이상을 +1, 새 번호 7
  expect(tight.ok && [...tight.changed.keys()].sort()).toEqual([2, 3]);
  const r = apply(sp, tight); expect([r[1].in, r[2].in, r[3].in]).toEqual([6, 8, 7]);
  const front = apply([S({ in: 2 }), S({})], addBar([S({ in: 2 }), S({})], 1, "in", { gap: 0 })); // 맨 앞: 2가 이미 있어 모두 +1
  expect([front[0].in, front[1].in]).toEqual([3, 2]);
});

test("구역 이동: 있는 구역으로, 새 구역으로, 지연과 시간은 그대로, 비는 구역의 번호는 저절로 사라진다", () => {
  const sp = [S({ in: 2, delay: 300, ms: 400 }), S({ in: 3 }), S({ in: 4 })];
  const r = moveToClick(sp, { el: 0, kind: "in" }, { click: 3 });
  expect(r.ok && [...r.changed.keys()]).toEqual([0]);
  const after = apply(sp, r);
  expect(after[0]).toMatchObject({ in: 4, delay: 300, ms: 400 });
  expect(timelineOf(after).numbers).toEqual([3, 4]); // 클릭 1이 비어 사라지고 Click 순위가 당겨진다
  const nu = apply(sp, moveToClick(sp, { el: 2, kind: "in" }, { gap: 0 })); // 맨 앞의 새 구역: 2가 이미 있어 밀림
  expect(nu.map((s) => s.in)).toEqual([3, 4, 2]);
});

test("Out은 자기 In 뒤 구역만: 어기는 이동과 시간 편집은 거절", () => {
  const sp = [S({ in: 2, out: 3 }), S({ in: 4 })];
  const r = moveToClick(sp, { el: 0, kind: "out" }, { click: 1 });
  expect(r.ok).toBe(false); expect(!r.ok && r.reason).toBe("Out must come after In");
  expect(moveToClick(sp, { el: 0, kind: "in" }, { click: 3 }).ok).toBe(false); // In을 Out 뒤로
  expect(moveToClick(sp, { el: 0, kind: "out" }, { click: 2 }).ok).toBe(true);
});

test("시간 편집: 같은 값은 아무것도 쓰지 않고, 범위는 0~10000으로 맞추고, 등장을 고쳐도 퇴장은 그대로", () => {
  const sp = [S({ in: 2, out: 3, ms: 800, delay: 100 })];
  const same = setBarTime(sp, { el: 0, kind: "in" }, { start: 100, len: 800 });
  expect(same.ok && same.changed.size).toBe(0);
  const r = apply(sp, setBarTime(sp, { el: 0, kind: "in" }, { start: 250, len: 20000 }));
  expect(r[0]).toMatchObject({ delay: 250, ms: 10000, outDelay: 100, outMs: 800 }); // 퇴장은 굳어 그대로
  expect(clicks(r)).toBe("0i@250+10000 | 0o@100+800");
  const o = apply(sp, setBarTime(sp, { el: 0, kind: "out" }, { start: 0 }));
  expect(o[0]).toMatchObject({ delay: 100, ms: 800, outDelay: 0 }); // 퇴장을 고쳐도 등장은 그대로
  expect(apply(sp, setBarTime(sp, { el: 0, kind: "in" }, { start: -9 }))[0].delay).toBeNull();
});

test("효과: 등장은 --sk-away-*, 퇴장은 --sk-out-* 값을 채우고 서로 영향 없다", () => {
  const sp = [S({ in: 2, out: 3 })];
  const a = apply(sp, setEffect(sp, { el: 0, kind: "in" }, "slide"));
  expect(a[0].away.x).toBe("-32px"); expect(a[0].outAway).toEqual(expect.objectContaining({ y: "20px" })); // 퇴장은 굳힌 기본(Rise)
  const b = apply(a, setEffect(a, { el: 0, kind: "out" }, "fade"));
  expect(b[0].outAway).toEqual({ opacity: "0", x: "0px", y: "0px", scale: "1", blur: "0px" }); expect(b[0].away.x).toBe("-32px");
  expect(setEffect(sp, { el: 0, kind: "in" }, "zzz").ok).toBe(false);
});

test("삭제: 등장을 지우고 퇴장이 남으면 퇴장 값을 굳히고 등장 값을 비운다, 둘 다 없어지면 값이 모두 사라진다", () => {
  const sp = [S({ in: 2, out: 3, ms: 800, delay: 100, away: { x: "-32px" } })];
  const a = apply(sp, removeBar(sp, { el: 0, kind: "in" }));
  expect(a[0]).toMatchObject({ in: null, out: 3, ms: null, delay: null, away: {}, outMs: 800, outDelay: 100 }); expect(a[0].outAway.x).toBe("-32px");
  const b = apply(a, removeBar(a, { el: 0, kind: "out" }));
  expect(b[0]).toEqual(emptySpec());
  const c = apply(sp, removeBar(sp, { el: 0, kind: "out" }));
  expect(c[0]).toMatchObject({ in: 2, out: null, outMs: null, outDelay: null, ms: 800, delay: 100 });
});

test("관계는 숫자에서 유도한다: 같은 시작 with, 위 막대 끝 after, 클릭 즉시 click, 그 밖은 delay", () => {
  const sp = [S({ in: 2, ms: 400 }), S({ in: 2, ms: 600 }), S({ in: 2, delay: 600, ms: 360 }), S({ in: 2, delay: 2000 })];
  const c = timelineOf(sp).clicks[0];
  expect(c.bars.map((b) => b.el)).toEqual([0, 1, 2, 3]);
  expect(c.bars.map((b) => relationOf(b, aboveOf(c, b)))).toEqual(["click", "with", "after", "delay"]);
});

test("스냅: 격자 50ms, 후보(0, 다른 막대의 시작과 끝)가 threshold 안이면 당긴다", () => {
  const sp = [S({ in: 2, ms: 400 }), S({ in: 2, delay: 1000 })];
  const c = timelineOf(sp).clicks[0], tg = snapTargets(c, c.bars[1]);
  expect(snap(130, [], 60)).toEqual({ ms: 150, hit: null });
  const a = snap(430, tg, 60); expect(a.ms).toBe(400); expect(a.hit?.kind).toBe("after");
  const w = snap(40, tg, 60); expect(w.ms).toBe(0); expect(["click", "with"]).toContain(w.hit?.kind as string);
  expect(snap(700, tg, 60).hit).toBeNull();
});

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
test("퍼즈: 무작위 편집 뒤에도 불변식(퇴장 > 등장, 값 범위), 바뀌지 않은 요소는 안 쓴다, 같은 값 재편집은 변화 없음", () => {
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const R = rng(seed), int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1)), pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
    let sp: StepSpec[] = Array.from({ length: 6 }, () => S());
    for (let i = 0; i < 300; i++) {
      const el = int(0, 5), kind = pick(["in", "out"] as const), tl = timelineOf(sp), b = barOf(tl, el, kind);
      const op = pick(["add", "time", "move", "effect", "remove"] as const);
      let r: Res;
      if (op === "add") r = addBar(sp, el, kind, R() < 0.5 ? undefined : pick([{ gap: int(0, tl.clicks.length) }, ...(tl.clicks.length ? [{ click: int(1, tl.clicks.length) }] : [])]) as never);
      else if (!b) continue;
      else if (op === "time") r = setBarTime(sp, b, { start: R() < 0.7 ? int(-100, 11000) : undefined, len: R() < 0.7 ? int(-100, 11000) : undefined });
      else if (op === "move") r = moveToClick(sp, b, R() < 0.5 ? { click: int(1, tl.clicks.length) } : { gap: int(0, tl.clicks.length) });
      else if (op === "effect") r = setEffect(sp, b, pick(["fade", "rise", "slide", "scale", "blur"]));
      else r = removeBar(sp, b);
      if (!r.ok) { expect(r.reason).toMatch(/Out must come after In|Already|No such/); continue; }
      for (const [idx, s] of r.changed) expect(specEqual(s, sp[idx])).toBe(false); // 바뀐 요소만
      sp = apply(sp, r);
      for (const s of sp) {
        expect(s.out === null || s.in === null || s.out > s.in).toBe(true);
        for (const v of [s.ms, s.delay, s.outMs, s.outDelay]) expect(v === null || (v >= 0 && v <= 10000)).toBe(true);
      }
      const t2 = timelineOf(sp); // 압축된 클릭 수는 쓰인 번호의 개수와 같다
      expect(t2.clicks.length).toBe(new Set(sp.flatMap((s) => [s.in, s.out]).filter((x) => x !== null)).size);
      for (const c of t2.clicks) expect(c.bars.length).toBeGreaterThan(0);
      const any = t2.bars[0]; if (any) { const same = setBarTime(sp, any, { start: any.start, len: any.len }); expect(same.ok && same.changed.size).toBe(0); }
    }
  }
});

test("실제 덱 둘: 모든 슬라이드의 단계 속성을 타임라인으로 읽고 같은 값 재편집은 아무것도 쓰지 않는다", () => {
  for (const deck of ["vibe-coding-workshop", "slidekit-guide"]) {
    const f = new URL(`../../decks/${deck}/index.html`, import.meta.url);
    if (!existsSync(f)) continue;
    const html = readFileSync(f, "utf8");
    for (const sec of html.split(/<section\b[^>]*data-slide/).slice(1)) {
      const specs = [...sec.split("</section>")[0].matchAll(/<[a-z0-9]+\s[^>]*data-step(?:-out)?=[^>]*>/gi)].map((m) => {
        const tag = m[0], at = (n: string) => new RegExp(`\\sdata-${n}="([^"]*)"`).exec(tag)?.[1] ?? null, st = /style="([^"]*)"/.exec(tag)?.[1] ?? "", v = (n: string) => new RegExp(`${n}:\\s*([^;"]+)`).exec(st)?.[1] ?? null;
        return parse({ step: at("step"), stepOut: at("step-out"), effect: at("step-effect") }, { "--sk-step-delay": v("--sk-step-delay"), "--sk-step-ms": v("--sk-step-ms") });
      });
      const tl = timelineOf(specs);
      for (const b of tl.bars) { const r = setBarTime(specs, b, { start: b.start, len: b.len }); expect(r.ok && r.changed.size).toBe(0); }
    }
  }
});
