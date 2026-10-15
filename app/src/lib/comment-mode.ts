// 코멘트 모드의 순수 계산(spec/COMMENT-MODE.md): 드래그 판정, 사각형 정규화, 겹치는 요소 고르기, 키보드 영역 조절, 읽어 주는 문구.
// DOM을 모르게 두어 단위 시험을 한다. 좌표는 iframe 문서의 화면 좌표(캔버스 오버레이와 같은 좌표)이고, 영역은 슬라이드 기준 0 에서 1이다.
import type { Region } from "@/lib/deck";

/** 작성창이 열릴 대상: 요소 하나 또는 영역(겹치는 요소 path 목록 포함). 없으면 선택 요소나 슬라이드 전체. */
export type CommentTarget = { el: Element } | { region: Region; overlap: string[] };

export type Box = { x: number; y: number; w: number; h: number };
export const SLIDE_W = 1920, SLIDE_H = 1080;
export const DRAG_MIN = 8; // px: 이보다 덜 움직이면 클릭이다
export const MIN_SIZE = 0.005; // 슬라이드의 0.5%: 이보다 작은 영역은 만들지 않는다
export const MAX_OVERLAP = 8;

export const isDrag = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_MIN;
/** 두 점이 이루는 상자(방향과 상관없이 w, h는 0 이상) */
export const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
export const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.w, b.x + b.w), bt = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** 화면의 상자를 슬라이드 기준 영역으로. 슬라이드 밖으로 나간 부분은 자르고, 너무 작거나 슬라이드와 겹치지 않으면 null */
export function toRegion(box: Box, slide: Box): Region | null {
  const i = intersect(box, slide);
  if (!i || slide.w <= 0 || slide.h <= 0) return null;
  const r: Region = { x: r4((i.x - slide.x) / slide.w), y: r4((i.y - slide.y) / slide.h), w: r4(i.w / slide.w), h: r4(i.h / slide.h) };
  return r.w < MIN_SIZE || r.h < MIN_SIZE ? null : r;
}
export const fromRegion = (r: Region, slide: Box): Box => ({ x: slide.x + r.x * slide.w, y: slide.y + r.y * slide.h, w: r.w * slide.w, h: r.h * slide.h });

export type Cand = { path: string; box: Box; leaf: boolean };
/** 영역과 겹치는 요소의 path를 고른다(최대 max개). 요소 면적의 20% 이상이 영역 안이면 포함하고, 가장 안쪽 단위(leaf)는 영역의 20% 이상을 덮어도 포함한다.
    다른 후보를 담고 있는 조상은 뺀다(가장 구체적인 것만). 겹친 면적이 큰 순서. */
export function selectOverlaps(cands: Cand[], region: Box, max = MAX_OVERLAP): string[] {
  const ra = area(region);
  if (ra <= 0) return [];
  const hit = cands.flatMap((c) => { const i = intersect(c.box, region); if (!i) return []; const ia = area(i), ca = area(c.box); return ca > 0 && (ia / ca >= 0.2 || (c.leaf && ia / ra >= 0.2)) ? [{ c, ia }] : []; });
  const kept = hit.filter((h) => !hit.some((o) => o !== h && o.c.path.startsWith(h.c.path === "" ? "\u0000" : h.c.path + " > "))); // 조상 제외(path는 슬라이드 아래 경로라 접두어가 조상이다)
  return kept.sort((a, b) => b.ia - a.ia || a.c.path.length - b.c.path.length).slice(0, max).map((h) => h.c.path);
}

// ---- 키보드로 영역 조절(A로 시작, 방향키 이동, Shift+방향키 크기, Alt 미세) ----
export const KEY_STEP = 0.01; // 슬라이드 폭과 높이의 1%
export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
export const isArrow = (k: string): k is ArrowKey => k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown";
/** 방향키 한 번의 변화. resize면 오른쪽 아래 모서리를 늘이고 줄인다. fine이면 1px(슬라이드 1920x1080 기준). 슬라이드 안으로 막고 최소 크기보다 작아지지 않는다. */
export function nudgeRegion(r: Region, key: ArrowKey, resize: boolean, fine: boolean): Region {
  const dx = (fine ? 1 / SLIDE_W : KEY_STEP) * (key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0);
  const dy = (fine ? 1 / SLIDE_H : KEY_STEP) * (key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0);
  if (resize) {
    const w = Math.min(1 - r.x, Math.max(MIN_SIZE, r.w + dx)), h = Math.min(1 - r.y, Math.max(MIN_SIZE, r.h + dy));
    return { x: r.x, y: r.y, w: r4(w), h: r4(h) };
  }
  return { x: r4(Math.min(1 - r.w, Math.max(0, r.x + dx))), y: r4(Math.min(1 - r.h, Math.max(0, r.y + dy))), w: r.w, h: r.h };
}

/** 스크린 리더에 읽어 줄 문구(슬라이드 1920x1080 기준 정수 픽셀) */
export const describeRegion = (r: Region) => `Area ${Math.round(r.w * SLIDE_W)} by ${Math.round(r.h * SLIDE_H)} pixels at ${Math.round(r.x * SLIDE_W)}, ${Math.round(r.y * SLIDE_H)}.`;
export const AREA_KEYS = "Arrow keys move, Shift plus arrow keys resize, Alt for fine steps, Enter to confirm, Escape to cancel.";
export const MODE_ON = "Comment mode on. Click an element or drag an area. Press Tab to move between elements, A to set an area with the keyboard, Escape to exit.";
