import { expect, test } from "bun:test";
import { anchors, gapsOf, lockAxis, snapMove, snapResize, toSlide, unionRect, type Rect } from "../src/lib/guides";

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

test("가장자리와 중앙 앵커 스냅은 임계값 안에서만 붙는다", () => {
  const t = R(100, 100, 200, 50);
  expect(snapMove(R(103, 300, 40, 40), [t], 6).dx).toBe(-3); // 왼쪽 가장자리끼리
  expect(snapMove(R(107, 300, 40, 40), [t], 6).dx).toBe(0); // 임계값(6) 밖
  expect(snapMove(R(176, 300, 48, 40), [t], 6).dx).toBe(0); // 중앙 200: 176+24=200
  expect(snapMove(R(178, 300, 48, 40), [t], 6).dx).toBe(-2); // 중앙끼리 2 차이
  expect(snapMove(R(106, 300, 40, 40), [t], 6).dx).toBe(-6); // 경계값
  expect(snapMove(R(106.01, 300, 40, 40), [t], 6).dx).toBe(0);
});

test("같은 좌표 가이드는 한 줄로 합쳐지고 범위는 합집합이다", () => {
  const a = R(100, 0, 50, 50), b = R(100, 200, 50, 50);
  const s = snapMove(R(102, 100, 50, 40), [a, b], 6);
  const g = s.guides.filter((x) => x.axis === "x" && x.pos === 100);
  expect(g.length).toBe(1);
  expect(g[0].from).toBe(0);
  expect(g[0].to).toBe(250);
});

test("lock 축 밖은 맞추지 않는다", () => {
  const t = R(100, 100, 200, 50);
  const s = snapMove(R(103, 98, 40, 40), [t], 6, { lock: "x" });
  expect(s.dx).toBe(-3);
  expect(s.dy).toBe(0);
  expect(lockAxis(10, -30)).toEqual({ dx: 0, dy: -30, axis: "y" });
  expect(lockAxis(5, 5).axis).toBe("x");
});

test("슬라이드 프레임(가장자리, 중앙)에도 붙는다", () => {
  const frame = R(0, 0, 1920, 1080);
  expect(snapMove(R(954, 300, 20, 20), [], 6, { frame }).dx).toBe(-4); // 중앙 960
  expect(snapMove(R(3, 300, 20, 20), [], 6, { frame }).dx).toBe(-3);
});

test("간격은 교차 축이 겹칠 때 양쪽 가장 가까운 이웃만", () => {
  const left = R(0, 0, 100, 100), right = R(300, 0, 100, 100), far = R(500, 0, 50, 100), below = R(0, 400, 100, 100);
  const g = gapsOf(R(150, 20, 100, 60), [left, right, far, below]);
  const xs = g.filter((x) => x.axis === "x");
  expect(xs.map((x) => x.value).sort()).toEqual([50, 50]);
  expect(g.some((x) => x.axis === "y")).toBe(false); // below는 가로로 겹치지 않는다(0..100 vs 150..250)
});

test("리사이즈: 움직이는 변만 맞추고 반대 변은 그대로", () => {
  const t = R(100, 0, 50, 50);
  const s = snapResize(R(103, 200, 197, 40), { l: true }, [t], 6);
  expect(s.rect.x).toBe(100);
  expect(s.rect.x + s.rect.w).toBe(300); // 오른쪽 변 고정
});

test("리사이즈: 비율 유지이면 한 축만 맞추고 다른 축은 비율로 따른다", () => {
  const t = R(0, 0, 100, 100);
  const s = snapResize(R(0, 200, 98, 49), { r: true, b: true }, [t], 6, { ratio: 2 });
  expect(s.rect.w / s.rect.h).toBeCloseTo(2, 5);
});

test("toSlide 변환", () => {
  expect(toSlide({ left: 150, top: 110, width: 50, height: 25 }, { left: 100, top: 10 }, 0.5)).toEqual({ x: 100, y: 200, w: 100, h: 50 });
  expect(anchors(R(10, 0, 20, 0), "x")).toEqual([10, 20, 30]);
});

test("unionRect는 여러 사각형을 감싼다", () => {
  expect(unionRect([{ x: 10, y: 20, w: 30, h: 10 }, { x: 50, y: 0, w: 10, h: 10 }])).toEqual({ x: 10, y: 0, w: 50, h: 30 });
});
