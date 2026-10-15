// 코멘트 모드의 순수 계산: 드래그 판정, 영역 정규화, 겹치는 요소 고르기, 키보드 영역 조절, 읽어 주는 문구.
import { expect, test } from "bun:test";
import { AREA_KEYS, DRAG_MIN, MIN_SIZE, boxOf, describeRegion, fromRegion, isDrag, nudgeRegion, selectOverlaps, toRegion } from "../src/lib/comment-mode";

const slide = { x: 100, y: 50, w: 960, h: 540 }; // 화면의 슬라이드(0.5배)

test("드래그 판정: 8px 미만은 클릭, 이상은 드래그, 상자는 방향과 상관없이 같다", () => {
  expect(isDrag({ x: 0, y: 0 }, { x: DRAG_MIN - 1, y: 0 })).toBe(false);
  expect(isDrag({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true); // 대각선 8.48
  expect(boxOf({ x: 50, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, w: 40, h: 30 });
});
test("영역 정규화: 슬라이드 기준 0~1 소수 4자리, 밖은 자르고, 작거나 밖이면 null, 왕복", () => {
  expect(toRegion({ x: 100, y: 50, w: 480, h: 270 }, slide)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  expect(toRegion({ x: 580, y: 320, w: 1000, h: 1000 }, slide)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }); // 밖으로 나간 부분은 자른다
  expect(toRegion({ x: 0, y: 0, w: 50, h: 40 }, slide)).toBeNull(); // 슬라이드 밖
  expect(toRegion({ x: 200, y: 100, w: 3, h: 3 }, slide)).toBeNull(); // 0.5%보다 작다(w 3/960 = 0.31%)
  const r = toRegion({ x: 333, y: 200, w: 123, h: 77 }, slide)!;
  const back = fromRegion(r, slide);
  expect(Math.abs(back.x - 333) + Math.abs(back.y - 200) + Math.abs(back.w - 123) + Math.abs(back.h - 77)).toBeLessThan(0.5);
  expect(MIN_SIZE).toBe(0.005);
});
test("겹치는 요소: 요소의 20% 이상이 안이거나 leaf가 영역의 20% 이상을 덮으면 포함, 조상은 빼고, 큰 순서, 최대 8개", () => {
  const area = { x: 0, y: 0, w: 100, h: 100 };
  const c = (path: string, x: number, y: number, w: number, h: number, leaf = true) => ({ path, box: { x, y, w, h }, leaf });
  expect(selectOverlaps([c("h1", 10, 10, 50, 20), c("p", 10, 40, 80, 10), c("img", 500, 500, 50, 50)], area)).toEqual(["h1", "p"]);
  // 영역보다 훨씬 큰 leaf(배경 그림)도 영역의 20% 이상을 덮으면 들어간다. 조금만 걸친 요소는 빠진다
  expect(selectOverlaps([c("img", -500, -500, 1000, 1000), c("span", 95, 95, 100, 100)], area)).toEqual(["img"]);
  // 조상은 뺀다: 카드(container)와 그 안의 글은 글만
  expect(selectOverlaps([c("div:nth-of-type(1)", 0, 0, 90, 90, false), c("div:nth-of-type(1) > h2", 5, 5, 60, 10), c("div:nth-of-type(1) > p", 5, 20, 60, 10)], area)).toEqual(["div:nth-of-type(1) > h2", "div:nth-of-type(1) > p"].sort((a, b) => a.length - b.length));
  const many = Array.from({ length: 12 }, (_, i) => c(`p:nth-of-type(${i + 1})`, 0, i * 8, 100, 8));
  expect(selectOverlaps(many, area).length).toBe(8);
  expect(selectOverlaps(many, { x: 0, y: 0, w: 0, h: 0 })).toEqual([]);
});
test("키보드 영역: 방향키는 1%씩 옮기고 Shift는 크기, Alt는 1px, 슬라이드 안으로 막히고 최소 크기를 지킨다", () => {
  const r = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
  expect(nudgeRegion(r, "ArrowRight", false, false)).toEqual({ x: 0.11, y: 0.1, w: 0.3, h: 0.3 });
  expect(nudgeRegion(r, "ArrowUp", false, false).y).toBe(0.09);
  expect(nudgeRegion(r, "ArrowRight", true, false)).toEqual({ x: 0.1, y: 0.1, w: 0.31, h: 0.3 });
  expect(nudgeRegion(r, "ArrowDown", true, false).h).toBe(0.31);
  expect(nudgeRegion(r, "ArrowLeft", false, true).x).toBe(0.0995); // 1/1920 = 0.00052
  expect(nudgeRegion({ x: 0, y: 0, w: 0.5, h: 0.5 }, "ArrowLeft", false, false).x).toBe(0); // 왼쪽 끝에서 막힌다
  expect(nudgeRegion({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, "ArrowRight", false, false).x).toBe(0.7); // 오른쪽 끝에서 막힌다
  expect(nudgeRegion({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, "ArrowRight", true, false).w).toBe(0.3); // 크기도 슬라이드 안으로
  expect(nudgeRegion({ x: 0, y: 0, w: MIN_SIZE, h: 0.3 }, "ArrowLeft", true, false).w).toBe(MIN_SIZE); // 최소 크기 아래로 줄지 않는다
});
test("읽어 주는 문구는 슬라이드 1920x1080 기준 정수 픽셀이고 키 안내가 있다", () => {
  expect(describeRegion({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 })).toBe("Area 480 by 270 pixels at 960, 540.");
  expect(AREA_KEYS).toContain("Enter to confirm");
  expect(AREA_KEYS).toContain("Escape to cancel");
});
