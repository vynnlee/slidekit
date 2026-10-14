// 스마트 가이드 계산(슬라이드 로컬 좌표, 단위 px). DOM 없이 시험할 수 있는 순수 함수만 둔다.
export type Rect = { x: number; y: number; w: number; h: number };
export type Axis = "x" | "y";
/** axis x: 세로선 x=pos, y 범위 from..to. axis y: 가로선 y=pos, x 범위 from..to */
export type Guide = { axis: Axis; pos: number; from: number; to: number };
/** 두 rect 사이 간격. axis x: 가로 간격(from..to 구간, 세로 위치 at), axis y: 세로 간격 */
export type Gap = { axis: Axis; from: number; to: number; at: number; value: number };
export type Snap = { dx: number; dy: number; guides: Guide[]; gaps: Gap[] };
export type ResizeSnap = { rect: Rect; guides: Guide[]; gaps: Gap[] };

const lo = (r: Rect, a: Axis) => (a === "x" ? r.x : r.y);
const len = (r: Rect, a: Axis) => (a === "x" ? r.w : r.h);
/** [최소, 중앙, 최대] */
export const anchors = (r: Rect, a: Axis): [number, number, number] => [lo(r, a), lo(r, a) + len(r, a) / 2, lo(r, a) + len(r, a)];

/** DOMRect 같은 rect를 슬라이드 로컬 좌표로 바꾼다. k는 무대 배율(화면 px / 슬라이드 px) */
export const toSlide = (r: { left: number; top: number; width: number; height: number }, origin: { left: number; top: number }, k: number): Rect =>
  ({ x: (r.left - origin.left) / k, y: (r.top - origin.top) / k, w: r.width / k, h: r.height / k });

/** Shift 축 고정: 이동량이 큰 쪽 축만 남긴다(같으면 x) */
export const lockAxis = (dx: number, dy: number): { dx: number; dy: number; axis: Axis } =>
  Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0, axis: "x" } : { dx: 0, dy, axis: "y" };

// 임계값 안에서 가장 작은 보정값(t - m)을 고른다. 없으면 null.
function best(m: number[], t: number[], thr: number): number | null {
  let out: number | null = null;
  for (const a of m) for (const b of t) {
    const d = b - a;
    if (Math.abs(d) <= thr && (out === null || Math.abs(d) < Math.abs(out))) out = d;
  }
  return out;
}

// 보정 뒤 정확히 맞은(0.5 미만) 앵커 쌍을 가이드로 모은다. 같은 좌표는 한 줄로 합치고 범위는 합집합이다.
function collect(moved: Rect, targets: Rect[], axes: Axis[], only?: (a: Axis, i: number) => boolean): Guide[] {
  const map = new Map<string, Guide>();
  for (const axis of axes) {
    const cross: Axis = axis === "x" ? "y" : "x";
    const ma = anchors(moved, axis);
    for (const t of targets) {
      const ta = anchors(t, axis);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (only && !only(axis, i)) continue;
        if (Math.abs(ta[j] - ma[i]) >= 0.5) continue;
        const from = Math.min(lo(moved, cross), lo(t, cross)), to = Math.max(lo(moved, cross) + len(moved, cross), lo(t, cross) + len(t, cross));
        const key = `${axis}:${Math.round(ta[j] * 100)}`;
        const g = map.get(key);
        if (g) { g.from = Math.min(g.from, from); g.to = Math.max(g.to, to); } else map.set(key, { axis, pos: ta[j], from, to });
      }
    }
  }
  return [...map.values()];
}

/** 가장 가까운 이웃까지의 간격(교차 축 범위가 겹칠 때만, 각 방향 하나씩) */
export function gapsOf(r: Rect, targets: Rect[]): Gap[] {
  const out: Gap[] = [];
  for (const axis of ["x", "y"] as Axis[]) {
    const cross: Axis = axis === "x" ? "y" : "x";
    let before: { v: number; t: Rect } | null = null, after: { v: number; t: Rect } | null = null;
    for (const t of targets) {
      const c0 = Math.max(lo(r, cross), lo(t, cross)), c1 = Math.min(lo(r, cross) + len(r, cross), lo(t, cross) + len(t, cross));
      if (c1 <= c0) continue; // 교차 축 범위가 겹치지 않는다
      const gapBefore = lo(r, axis) - (lo(t, axis) + len(t, axis)), gapAfter = lo(t, axis) - (lo(r, axis) + len(r, axis));
      if (gapBefore >= 0 && (!before || gapBefore < before.v)) before = { v: gapBefore, t };
      if (gapAfter >= 0 && (!after || gapAfter < after.v)) after = { v: gapAfter, t };
    }
    const at = (t: Rect) => (Math.max(lo(r, cross), lo(t, cross)) + Math.min(lo(r, cross) + len(r, cross), lo(t, cross) + len(t, cross))) / 2;
    if (before) out.push({ axis, from: lo(before.t, axis) + len(before.t, axis), to: lo(r, axis), at: at(before.t), value: before.v });
    if (after) out.push({ axis, from: lo(r, axis) + len(r, axis), to: lo(after.t, axis), at: at(after.t), value: after.v });
  }
  return out;
}

/** 이동. moving은 포인터 이동을 더한 rect. dx, dy는 더해야 할 보정값. lock이 있으면 그 축으로만 움직이므로 다른 축은 맞추지 않는다 */
export function snapMove(moving: Rect, targets: Rect[], thr: number, o: { lock?: Axis; frame?: Rect } = {}): Snap {
  const all = o.frame ? [...targets, o.frame] : targets;
  const pick = (axis: Axis) => (o.lock && o.lock !== axis ? null : best(anchors(moving, axis), all.flatMap((t) => anchors(t, axis)), thr));
  const dx = pick("x") ?? 0, dy = pick("y") ?? 0;
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };
  return { dx, dy, guides: collect(moved, all, (o.lock ? [o.lock === "x" ? "y" : "x"] : ["x", "y"]) as Axis[]), gaps: gapsOf(moved, targets) };
}

/** 리사이즈. moving은 포인터를 반영한 새 rect, edges는 움직이는 변. ratio(w/h)가 있으면 더 가까운 축 하나만 맞추고 다른 축은 비율로 따른다 */
export function snapResize(moving: Rect, edges: { l?: boolean; r?: boolean; t?: boolean; b?: boolean }, targets: Rect[], thr: number, o: { ratio?: number } = {}): ResizeSnap {
  const xs = targets.flatMap((t) => anchors(t, "x")), ys = targets.flatMap((t) => anchors(t, "y"));
  const near = (v: number, to: number[]) => best([v], to, thr);
  let dxl = edges.l ? near(moving.x, xs) : null, dxr = edges.r ? near(moving.x + moving.w, xs) : null;
  let dyt = edges.t ? near(moving.y, ys) : null, dyb = edges.b ? near(moving.y + moving.h, ys) : null;
  const dX = dxl ?? dxr, dY = dyt ?? dyb;
  if (o.ratio && dX !== null && dY !== null) { // 비율 유지: 더 가까운 축 하나만
    if (Math.abs(dX) <= Math.abs(dY)) { dyt = dyb = null; } else { dxl = dxr = null; }
  }
  let r = { ...moving };
  if (dxl !== null) { r.x += dxl; r.w -= dxl; }
  if (dxr !== null) r.w += dxr;
  if (dyt !== null) { r.y += dyt; r.h -= dyt; }
  if (dyb !== null) r.h += dyb;
  if (o.ratio && (dxl !== null || dxr !== null) !== (dyt !== null || dyb !== null)) {
    if (dxl !== null || dxr !== null) { const h = r.w / o.ratio; if (edges.t) r.y += r.h - h; r.h = h; }
    else { const w = r.h * o.ratio; if (edges.l) r.x += r.w - w; r.w = w; }
  }
  const moved = (axis: Axis, i: number) => (axis === "x" ? (i === 0 && !!edges.l) || (i === 2 && !!edges.r) : (i === 0 && !!edges.t) || (i === 2 && !!edges.b));
  return { rect: r, guides: collect(r, targets, ["x", "y"], moved), gaps: gapsOf(r, targets) };
}
