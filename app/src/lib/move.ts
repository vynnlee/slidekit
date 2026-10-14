// 요소 이동(SPEC 9.2): 흐름 레이아웃을 건드리지 않고 인라인 `translate`(개별 CSS 속성)만 바꾼다.
const round = (n: number) => Math.round(n * 10) / 10;

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
  return true;
}

/** 슬라이드 안 조상들의 선형 변환(배율, 회전, 기울임)을 바깥에서 안으로 곱한 행렬. 3D 변환은 무시한다 */
function ancestorMatrix(el: HTMLElement): DOMMatrix {
  const root = el.closest("[data-slide]");
  const chain: HTMLElement[] = [];
  for (let n = el.parentElement; n && n !== root; n = n.parentElement) chain.unshift(n);
  let m = new DOMMatrix();
  for (const n of chain) {
    const t = getComputedStyle(n).transform;
    if (t && t !== "none") { const x = new DOMMatrix(t); m = m.multiply(new DOMMatrix([x.a, x.b, x.c, x.d, 0, 0])); }
  }
  return m;
}

/** 슬라이드 좌표(1920 기준)의 변화량을 요소 로컬(translate가 쓰는 좌표) 변화량으로 바꾼다. 회전한 조상도 거꾸로 돌려 준다 */
export function toLocal(el: HTMLElement, dx: number, dy: number): [number, number] {
  const m = ancestorMatrix(el);
  const det = m.a * m.d - m.b * m.c;
  if (!det) return [dx, dy];
  return [(m.d * dx - m.c * dy) / det, (-m.b * dx + m.a * dy) / det];
}

/** 자신이나 조상이 회전, 기울임인지(리사이즈는 이 경우 지원하지 않는다) */
export function skewed(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && !n.hasAttribute("data-slide"); n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.rotate && cs.rotate !== "none") return true;
    const t = cs.transform;
    if (t && t !== "none") { const x = new DOMMatrix(t); if (Math.abs(x.b) > 1e-6 || Math.abs(x.c) > 1e-6) return true; }
  }
  return false;
}

/** dx, dy(슬라이드 px)만큼 옮긴다 */
export function moveBy(el: HTMLElement, dx: number, dy: number) {
  const [x, y] = readTranslate(el);
  const [lx, ly] = toLocal(el, dx, dy);
  writeTranslate(el, x + lx, y + ly);
}

/** 크기를 인라인 px로 정할 때의 정리: 플렉스 `1 1` 채움을 풀고, 플렉스 부모 안에서는 줄어들지 않게 한다(Inspector의 Fixed 모드와 같다) */
export function fixSize(el: HTMLElement) {
  if (/^1 1/.test(el.style.flex)) el.style.removeProperty("flex");
  const parent = el.parentElement && getComputedStyle(el.parentElement).display;
  if (parent && parent.includes("flex")) el.style.flexShrink = "0";
}

/** 리사이즈 핸들을 보일 수 있는 요소인지: 이동 가능하고, viewBox 없는 svg는 제외 */
export function canResize(el: HTMLElement): boolean {
  if (!canMove(el) || skewed(el)) return false;
  return !(el instanceof SVGElement) || el.tagName.toLowerCase() !== "svg" || el.hasAttribute("viewBox");
}
