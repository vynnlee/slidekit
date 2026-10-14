// 슬라이드(1920x1080 무대) 밖으로 나가거나 잘리는 요소를 찾는다. 편집기의 넘침 표시(캔버스 외곽선, Layers 경고, 필름스트립 표시)가 쓰고,
// engine의 `slidekit doctor --layout`도 이 함수의 소스를 그대로 번들 사본에 주입해 같은 기준으로 잰다.
// 그래서 이 함수는 자기 완결형이다: import, 바깥 상수, 타입 외 참조가 없고 DOM만 쓴다(함수 소스를 문자열로 떼어 써도 돈다).
// 기준: (1) 요소 상자가 슬라이드 상자를 2px 넘게 벗어난다(부모는 안에 있는데 자신만 나간 원인 요소만), (2) overflow가 hidden이나 clip인 요소의 내용이 상자보다 2px 넘게 크다(글이 잘린다).
// 노트(aside[data-notes])와 display:none, visibility:hidden은 뺀다. 단계(data-step) 요소는 보이는 상태로 잰다는 전제다(편집기는 늘 그렇다).
export type Overflow = {
  el: Element; // JSON으로 보낼 때는 뺀다
  kind: "outside" | "clipped";
  /** 슬라이드 기준(1920 단위)으로 벗어난 양. 왼쪽, 위로 나가면 음수 */
  dx: number;
  dy: number;
  /** 슬라이드에서 요소까지의 경로(`div:nth-of-type(2) > p` 꼴) */
  path: string;
  /** 요소 글자 앞부분(없으면 빈 글자) */
  text: string;
};

export function findOverflow(slide: Element): Overflow[] {
  const out: Overflow[] = [];
  const win = slide.ownerDocument.defaultView;
  if (!win) return out;
  const sr = slide.getBoundingClientRect();
  if (!sr.width) return out;
  const TOL = 2, k = 1920 / sr.width;
  // 형제가 많아도 부모마다 한 번만 센다(요소 1000개가 모두 넘칠 때 제곱으로 느려지지 않게). 자기 완결형이어야 해서 deck-source의 pathOf를 쓰지 않는다.
  const nth = new Map<Element, { n: number; of: number }>();
  const nthOf = (e: Element) => {
    let v = nth.get(e);
    if (!v) {
      const seen = new Map<string, number>(), sibs = [...(e.parentElement?.children ?? [])];
      for (const x of sibs) { const c = (seen.get(x.tagName) ?? 0) + 1; seen.set(x.tagName, c); nth.set(x, { n: c, of: 0 }); }
      for (const x of sibs) nth.get(x)!.of = seen.get(x.tagName)!;
      v = nth.get(e)!;
    }
    return v;
  };
  const pathOf = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== slide; e = e.parentElement) {
      const tag = e.tagName.toLowerCase(), v = nthOf(e);
      parts.unshift(v.of > 1 ? `${tag}:nth-of-type(${v.n})` : tag);
    }
    return parts.join(" > ");
  };
  const textOf = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const over = (r: DOMRect) => {
    const dx = r.left < sr.left - TOL ? r.left - sr.left : r.right > sr.right + TOL ? r.right - sr.right : 0;
    const dy = r.top < sr.top - TOL ? r.top - sr.top : r.bottom > sr.bottom + TOL ? r.bottom - sr.bottom : 0;
    return { dx: Math.round(dx * k), dy: Math.round(dy * k), out: dx !== 0 || dy !== 0 };
  };
  const walk = (parent: Element, parentOut: boolean) => {
    for (const el of parent.children) {
      if (/^(SCRIPT|STYLE|TEMPLATE|LINK|META|BR)$/.test(el.tagName) || el.matches("aside[data-notes]")) continue;
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) { walk(el, parentOut); continue; }
      const o = over(r);
      if (o.out && !parentOut) out.push({ el, kind: "outside", dx: o.dx, dy: o.dy, path: pathOf(el), text: textOf(el) });
      else if (!o.out && (/^(hidden|clip)$/.test(cs.overflowX) || /^(hidden|clip)$/.test(cs.overflowY))) {
        const he = el as HTMLElement;
        if (he.scrollWidth > he.clientWidth + TOL || he.scrollHeight > he.clientHeight + TOL) out.push({ el, kind: "clipped", dx: Math.round((he.scrollWidth - he.clientWidth) * k), dy: Math.round((he.scrollHeight - he.clientHeight) * k), path: pathOf(el), text: textOf(el) });
      }
      walk(el, parentOut || o.out);
    }
  };
  walk(slide, false);
  return out;
}
