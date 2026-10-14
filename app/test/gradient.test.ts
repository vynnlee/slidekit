import { expect, test } from "bun:test";
import { addStop, parseGradient, removeStop, serializeGradient } from "../src/lib/gradient";

test("읽기: 각도, 방향 키워드, 위치 생략, 토큰 var()와 rgb() 안의 쉼표", () => {
  expect(parseGradient("linear-gradient(90deg, #fff 0%, #000 100%)")).toEqual({ angle: 90, stops: [{ color: "#fff", pos: 0 }, { color: "#000", pos: 100 }] });
  expect(parseGradient("linear-gradient(to right, red, blue)")).toEqual({ angle: 90, stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 100 }] });
  expect(parseGradient("linear-gradient(#a, #b, #c)")?.stops.map((s) => s.pos)).toEqual([0, 50, 100]);
  const g = parseGradient("linear-gradient(45deg, var(--sk-accent, #fff) 10%, rgb(1, 2, 3) 90%)")!;
  expect(g.stops.map((s) => s.color)).toEqual(["var(--sk-accent, #fff)", "rgb(1, 2, 3)"]);
});
test("읽지 못하는 것은 null: radial, px 위치, 스톱 1개, 다른 단위", () => {
  expect(parseGradient("radial-gradient(#fff, #000)")).toBeNull();
  expect(parseGradient("linear-gradient(#fff 10px, #000 90px)")).toBeNull();
  expect(parseGradient("linear-gradient(#fff)")).toBeNull();
  expect(parseGradient("linear-gradient(0.25turn, #fff, #000)")).toBeNull();
});
test("쓰기는 표준 형태이고 읽은 값과 왕복한다", () => {
  const css = "linear-gradient(135deg, var(--sk-bg) 0%, #123456 40%, rgb(1 2 3 / 0.5) 100%)";
  expect(serializeGradient(parseGradient(css)!)).toBe(css);
});
test("스톱 추가는 4개까지이고 위치순으로 정렬, 삭제는 2개를 남긴다", () => {
  let g = parseGradient("linear-gradient(180deg, #fff 0%, #000 100%)")!;
  const a = addStop(g, 30)!;
  expect(a.g.stops.map((s) => s.pos)).toEqual([0, 30, 100]);
  expect(a.selected).toBe(1);
  expect(a.g.stops[1].color).toBe("#fff"); // 가까운 쪽(0%)의 색
  g = addStop(a.g, 60)!.g;
  expect(g.stops.length).toBe(4);
  expect(addStop(g, 90)).toBeNull();
  expect(removeStop(g, 1)!.stops.length).toBe(3);
  expect(removeStop(parseGradient("linear-gradient(#fff 0%, #000 100%)")!, 0)).toBeNull();
});
