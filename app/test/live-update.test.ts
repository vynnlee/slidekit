import { expect, test } from "bun:test";
import { chipText, lcsPairs, mapPosition, plan, shouldAutoApply, type LiveDeck } from "../src/lib/live-update";

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const deck = (fps: string[], over: Partial<LiveDeck> = {}): LiveDeck => ({ slides: fps.map((fp) => ({ fp, html: `<section data-slide="content">${fp}</section>`, text: fp })), styles: ["s"], script: "j", meta: "m", shape: "p", legacy: fps.map(() => false), ...over });
const lcsLen = (a: string[], b: string[]) => { const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0)); for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]); return t[0][0]; };

test("lcsPairs: 오름차순이고 같은 지문끼리이며 길이가 최장이다(무작위 400개)", () => {
  const r = rng(7);
  for (let c = 0; c < 400; c++) {
    const alpha = 1 + Math.floor(r() * 6), a = Array.from({ length: Math.floor(r() * 14) }, () => String(Math.floor(r() * alpha))), b = Array.from({ length: Math.floor(r() * 14) }, () => String(Math.floor(r() * alpha)));
    const p = lcsPairs(a, b);
    expect(p.length, JSON.stringify([a, b])).toBe(lcsLen(a, b));
    p.forEach(([o, n], k) => { expect(a[o]).toBe(b[n]); if (k) { expect(o).toBeGreaterThan(p[k - 1][0]); expect(n).toBeGreaterThan(p[k - 1][1]); } });
  }
});

test("lcsPairs: 같은 목록은 전부 짝이고, 완전히 다르면 없고, 터무니없이 크면 앞뒤만", () => {
  expect(lcsPairs(["a", "b", "c"], ["a", "b", "c"]).length).toBe(3);
  expect(lcsPairs(["a", "b"], ["x", "y"]).length).toBe(0);
  expect(lcsPairs([], ["x"])).toEqual([]);
  const big = Array.from({ length: 2500 }, (_, i) => "o" + i), big2 = ["h", ...Array.from({ length: 2500 }, (_, i) => "n" + i), "t"];
  expect(lcsPairs(["h", ...big, "t"], big2).length).toBe(2);
});

test("mapPosition: 끼움, 지움, 제자리 수정, 교체, 첫 장과 마지막 장", () => {
  const m = (a: string[], b: string[], i: number) => mapPosition(lcsPairs(a, b), a.length, b.length, i);
  expect(m(["a", "b", "c"], ["x", "a", "b", "c"], 1)).toEqual({ index: 2, kept: true }); // 앞에 끼워도 같은 슬라이드
  expect(m(["a", "b", "c"], ["a", "c"], 1)).toEqual({ index: 0, kept: false }); // 현재를 지우면 앞 이웃
  expect(m(["a", "b", "c"], ["b", "c"], 0)).toEqual({ index: 0, kept: false }); // 첫 장을 지우면 새 첫 장
  expect(m(["a", "b", "c"], ["a", "B", "c"], 1)).toEqual({ index: 1, kept: true }); // 제자리에서 고침
  expect(m(["a", "b", "c", "d"], ["a", "X", "d"], 1)).toEqual({ index: 1, kept: false }); // 둘이 하나로 바뀜: 틈 안, 같은 슬라이드로 보지 않음
  expect(m(["a", "b", "c"], ["a", "b"], 2)).toEqual({ index: 1, kept: false }); // 마지막 장을 지우면 새 마지막 장
  expect(m(["a", "b"], ["x", "y", "z"], 1)).toEqual({ index: 1, kept: false }); // 전부 교체: 같은 자리
  expect(m(["a", "b", "c"], ["c", "b", "a"], 0).index).toBeLessThan(3);
});

test("mapPosition: 항상 범위 안(무작위 편집 600개)", () => {
  const r = rng(11);
  for (let c = 0; c < 600; c++) {
    const a = Array.from({ length: 1 + Math.floor(r() * 10) }, (_, i) => "s" + i);
    const b = a.filter(() => r() > 0.3).map((x) => (r() < 0.3 ? x + "'" : x));
    for (let k = 0; k < Math.floor(r() * 3); k++) b.splice(Math.floor(r() * (b.length + 1)), 0, "n" + k);
    if (!b.length) b.push("only");
    const i = Math.floor(r() * a.length), res = mapPosition(lcsPairs(a, b), a.length, b.length, i);
    expect(res.index).toBeGreaterThanOrEqual(0); expect(res.index).toBeLessThan(b.length);
    if (a[i] && b.includes(a[i])) expect(b[res.index]).toBe(a[i]); // 지문이 같은 슬라이드가 남아 있으면 그 슬라이드에 머문다(중복이 없을 때)
  }
});

test("plan: 바뀐 것이 없으면 same, 현재와 다음이 안 바뀌면 보이는 변화가 없다", () => {
  const a = deck(["a", "b", "c", "d", "e"]);
  expect(plan(a, deck(["a", "b", "c", "d", "e"]), 1).same).toBe(true);
  const far = plan(a, deck(["a", "b", "c", "d", "E"]), 1); // 4번째 뒤의 수정
  expect(far.same).toBe(false); expect(far.changed).toEqual([4]); expect(far.affectsView).toBe(false); expect(far.reload).toBe(false); expect(far.kept).toBe(true);
  expect(plan(a, deck(["a", "b", "C", "d", "e"]), 1).affectsView).toBe(true); // 다음 슬라이드(미리보기)가 바뀜
  expect(plan(a, deck(["a", "B", "c", "d", "e"]), 1).affectsView).toBe(true); // 현재가 바뀜
  expect(plan(a, deck(["a", "b", "c", "d", "e"], { styles: ["t"] }), 1).affectsView).toBe(true); // 전역 스타일
  const del = plan(a, deck(["a", "c", "d", "e"]), 1); // 현재 삭제
  expect(del.kept).toBe(false); expect(del.index).toBe(0); expect(del.removed).toBe(1); expect(del.affectsView).toBe(true);
  const ins = plan(a, deck(["a", "N", "b", "c", "d", "e"]), 2); // 현재 앞에 끼움: 현재는 그대로, 다음도 그대로
  expect(ins.kept).toBe(true); expect(ins.index).toBe(3); expect(ins.affectsView).toBe(false);
});

test("plan: 스크립트, 메타, 본문 밖, 옛 규칙 슬라이드가 바뀌면 reload", () => {
  const a = deck(["a", "b", "c"]);
  expect(plan(a, deck(["a", "b", "c"], { script: "k" }), 0).reload).toBe(true);
  expect(plan(a, deck(["a", "b", "c"], { meta: "n" }), 0).reload).toBe(true);
  expect(plan(a, deck(["a", "b", "c"], { shape: "q" }), 0).reload).toBe(true);
  expect(plan(deck(["a", "b", "c"], { legacy: [false, true, false] }), deck(["a", "B", "c"], { legacy: [false, true, false] }), 0).reload).toBe(true);
  expect(plan(a, deck(["a", "B", "c"]), 0).reload).toBe(false);
});

test("shouldAutoApply: Auto는 안 보이는 변화나 청중이 없을 때만, Ask와 Off는 안 한다", () => {
  const a = deck(["a", "b", "c", "d"]);
  const quiet = plan(a, deck(["a", "b", "c", "D"]), 0), loud = plan(a, deck(["A", "b", "c", "d"]), 0);
  expect(shouldAutoApply("auto", quiet, true)).toBe(true);
  expect(shouldAutoApply("auto", loud, true)).toBe(false);
  expect(shouldAutoApply("auto", loud, false)).toBe(true);
  expect(shouldAutoApply("ask", quiet, false)).toBe(false);
  expect(shouldAutoApply("off", quiet, false)).toBe(false);
});

test("chipText: 바뀐 슬라이드 번호와 개수", () => {
  const a = deck(["a", "b", "c", "d", "e", "f"]);
  expect(chipText(plan(a, deck(["a", "B", "c", "d", "e", "f"]), 0), 6)).toBe("Slide 2 changed");
  expect(chipText(plan(a, deck(["A", "B", "C", "D", "e", "f"]), 4), 6)).toBe("Slide 1, 2, 3 +1 changed");
  expect(chipText(plan(a, deck(["a", "b", "c", "d", "e"]), 0), 5)).toBe("1 slide removed");
  expect(chipText(plan(a, deck(["a", "b", "c", "d", "e", "f"], { script: "z" }), 0), 6)).toBe("Deck code changed");
});
