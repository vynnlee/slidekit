// 요소 이동(SPEC 9.2): 흐름 레이아웃을 건드리지 않고 인라인 `translate`(개별 CSS 속성)만 바꾼다.
const round = (n: number) => Math.round(n * 10) / 10;

/** 부모의 누적 배율(화면 px / 로컬 px). 무대 축소와 중첩 transform scale이 한 번에 반영된다. */
export function localScale(el: Element): number {
  const p = el.parentElement as HTMLElement | null;
  if (!p || !p.offsetWidth) return 1;
  return p.getBoundingClientRect().width / p.offsetWidth || 1;
}

/** 현재 translate(px). 읽을 수 없는 값(%, calc 등)이면 [NaN, NaN] */
export function readTranslate(el: HTMLElement): [number, number] {
  const v = el.style.translate || getComputedStyle(el).translate;
  if (!v || v === "none") return [0, 0];
  const m = /^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?$/.exec(v.trim());
  return m ? [parseFloat(m[1]), parseFloat(m[2] ?? "0")] : [NaN, NaN];
}

/** 0, 0이면 속성을 지운다(빈 style은 저장 때 정리된다) */
export function writeTranslate(el: HTMLElement, x: number, y: number) {
  if (!round(x) && !round(y)) el.style.removeProperty("translate");
  else el.style.translate = `${round(x)}px ${round(y)}px`;
}

/** 이동할 수 있는 요소인지: translate를 읽을 수 있고, 숨김이나 크기 0이 아니고, 회전한 조상이 없다 */
export function canMove(el: HTMLElement): boolean {
  if (!readTranslate(el).every(Number.isFinite)) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || getComputedStyle(el).display === "none") return false;
  for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
    const t = getComputedStyle(n).transform;
    const m = /^matrix\(([^)]+)\)$/.exec(t);
    if (m && Math.abs(parseFloat(m[1].split(",")[1])) > 1e-6) return false; // 회전이나 기울임이 있는 조상 아래에서는 옮기지 않는다(배율만 있는 것은 허용)
  }
  return true;
}

/** dx, dy(로컬 px)만큼 옮긴다 */
export function moveBy(el: HTMLElement, dx: number, dy: number) {
  const [x, y] = readTranslate(el);
  writeTranslate(el, x + dx, y + dy);
}
