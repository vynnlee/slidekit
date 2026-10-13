// 요소 선택 규칙(Figma식 계층 선택, SPEC 9.4). DOM 없이 시험할 수 있게 필요한 속성만 가진 노드 모양으로 쓴다.
// 선택 범위(scope)는 따로 저장하지 않는다: 선택된 요소가 있으면 그 부모가, 없으면 슬라이드 루트가 범위다.
export type N = {
  tagName: string;
  parentElement: N | null;
  children: ArrayLike<N>;
  textContent: string | null;
  getAttribute?(name: string): string | null;
};

const INLINE = /^(B|I|EM|STRONG|SPAN|CODE|A|BR|SMALL|MARK|U|S|SUB|SUP|KBD)$/;
const ATOMIC = /^(IMG|SVG|VIDEO|CANVAS|INPUT|SELECT|TEXTAREA|IFRAME|OBJECT|PICTURE)$/;
const SKIP = /^(SCRIPT|STYLE|TEMPLATE)$/;
const tag = (e: N) => e.tagName.toUpperCase();

const isNotes = (e: N) => tag(e) === "ASIDE" && (e.getAttribute?.("data-notes") ?? null) !== null;
/** 편집 대상이 아닌 요소(노트, 스크립트, 스타일) */
export const selectable = (e: N) => !SKIP.test(tag(e)) && !isNotes(e);
const kids = <T extends N>(e: T) => (Array.from(e.children) as T[]).filter(selectable);

/** 글자 블록: 글이 있고 자식이 모두 인라인 요소인 요소(p, h1, 카드 안의 글 묶음 등) */
export const isTextBlock = (e: N) => !ATOMIC.test(tag(e)) && !!e.textContent?.trim() && Array.from(e.children).every((c) => INLINE.test(tag(c)));
/** 더 내려갈 수 없는 요소: 이미지, svg, 입력, 글자 블록, 자식 없는 빈 요소 */
export const isLeaf = (e: N) => ATOMIC.test(tag(e)) || isTextBlock(e) || kids(e).length === 0;

const contains = (a: N, b: N) => { for (let n: N | null = b; n; n = n.parentElement) if (n === a) return true; return false; };

/** 포인터 아래 요소(target)가 속한 선택 단위: svg는 바깥 svg, 글자 블록은 가장 바깥 블록. 루트 밖이거나 노트이면 null */
export function leafOf<T extends N>(root: T, target: T | null): T | null {
  if (!target || target === root || !contains(root, target)) return null;
  let r = target;
  for (let a: T | null = target; a && a !== root; a = a.parentElement as T | null) {
    if (isNotes(a)) return null;
    if (tag(a) === "SVG" || isTextBlock(a)) r = a;
  }
  return r;
}

/** 클릭으로 선택될 요소. sel이 있으면 그 부모의 직계 자식끼리, 범위 밖을 누르면 범위를 위로 풀어 그 단계의 요소를 고른다. deep이면 가장 안쪽 단위 */
export function pick<T extends N>(root: T, target: T | null, sel: T | null, deep = false): T | null {
  const leaf = leafOf(root, target);
  if (!leaf) return null;
  if (deep) return leaf;
  let scope: T = sel && sel !== root ? ((sel.parentElement as T | null) ?? root) : root;
  while (scope !== root && !contains(scope, leaf)) scope = (scope.parentElement as T | null) ?? root;
  let c = leaf;
  while (c.parentElement && c.parentElement !== scope) c = c.parentElement as T;
  return c;
}

/** el 안에서 target을 포함하는 직계 자식(더블클릭으로 한 단계 내려갈 때). 없으면 null */
export function childToward<T extends N>(root: T, el: T, target: T | null): T | null {
  const leaf = leafOf(root, target);
  if (!leaf || leaf === el || !contains(el, leaf)) return null;
  let c = leaf;
  while (c.parentElement && c.parentElement !== el) c = c.parentElement as T;
  return c.parentElement === el ? c : null;
}

/** 부모(슬라이드 루트 직전까지). 최상위이면 null */
export const parentOf = <T extends N>(root: T, el: T): T | null => {
  const p = el.parentElement as T | null;
  return p && p !== root ? p : null;
};

export const firstChild = <T extends N>(el: T): T | null => kids(el)[0] ?? null;

/** Tab으로 도는 같은 범위의 형제(선택이 없으면 최상위 요소) */
export const siblings = <T extends N>(root: T, sel: T | null): T[] => kids(sel && sel !== root ? ((sel.parentElement as T | null) ?? root) : root);
