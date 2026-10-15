// 덱 원문을 슬라이드 단위로 쪼개고 다시 합친다. SPEC 9절.
// 손대지 않은 슬라이드는 원문 글자 그대로 돌아온다. split 뒤 compose는 항등이어야 한다.
// gap: 앞 슬라이드 끝에서 이 슬라이드 시작까지의 원문. undefined면 기본 간격을 쓴다.
export type Unit = { key: string; gap?: string; html: string };
export type Doc = { prefix: string; suffix: string; units: Unit[] };

let seq = 0;
export const newKey = () => `u${++seq}`;

// 작은 토크나이저로 최상위 section의 범위를 찾는다. 주석, 따옴표 속성 값, script, style, textarea, title 안의
// "<section"과 "</section>"은 경계로 보지 않는다. 최상위 section 중 data-slide 속성이 있는 것만 슬라이드다.
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes", "plaintext", "iframe"]);
function sections(src: string) {
  const out: { a: number; b: number; slide: boolean }[] = [];
  const n = src.length;
  let i = 0, depth = 0, start = 0, slide = false;
  while ((i = src.indexOf("<", i)) >= 0) {
    if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); i = e < 0 ? n : e + 3; continue; }
    const close = src[i + 1] === "/";
    const m = /^[A-Za-z][^\s/>]*/.exec(src.slice(i + (close ? 2 : 1), i + 64 + (close ? 2 : 1)));
    if (!m) { i++; continue; }
    const name = m[0].toLowerCase();
    let j = i + (close ? 2 : 1) + m[0].length, has = false;
    // 태그 끝까지: 따옴표 안의 ">"는 건너뛰고 속성 이름을 모은다
    while (j < n && src[j] !== ">") {
      const c = src[j];
      if (c === '"' || c === "'") { const e = src.indexOf(c, j + 1); j = e < 0 ? n : e + 1; continue; }
      const w = /^[^\s"'<>\/=]+/.exec(src.slice(j, j + 64));
      if (w) { if (w[0].toLowerCase() === "data-slide") has = true; j += w[0].length; } else j++;
    }
    const end = Math.min(n, j + 1);
    if (name === "section") {
      if (!close) { if (depth++ === 0) { start = i; slide = has; } }
      else if (depth > 0 && --depth === 0) out.push({ a: start, b: end, slide });
    } else if (!close && RAW.has(name)) {
      const e = new RegExp(`</${name}(?=[\\s/>])`, "i").exec(src.slice(end));
      i = e ? end + e.index : n;
      continue;
    }
    i = end;
  }
  return out;
}

export function splitDeck(src: string): Doc {
  const slides = sections(src).filter((r) => r.slide).map((r) => [r.a, r.b] as const);
  if (!slides.length) throw new Error("This deck has no slides yet.");
  const units = slides.map(([a, b], i) => ({
    key: newKey(),
    gap: i ? src.slice(slides[i - 1][1], a) : undefined,
    html: src.slice(a, b),
  }));
  return { prefix: src.slice(0, slides[0][0]), suffix: src.slice(slides.at(-1)![1]), units };
}

// gap이 없는 단위(복제, 추가, 첫 자리에서 옮겨 온 것)에는 덱에서 처음 보이는 공백 간격을 쓴다.
function defaultGap(units: Unit[]) {
  return units.slice(1).find((u) => u.gap && u.gap.trim() === "")?.gap ?? "\n";
}

export function compose(doc: Doc, units = doc.units) {
  const dg = defaultGap(units);
  return doc.prefix + units.map((u, i) => (i ? u.gap ?? dg : "") + u.html).join("") + doc.suffix;
}

// 캔버스와 썸네일용 문서. 상대 경로가 깨지지 않게 base를 넣고, 임베드 표시를 단다.
export function previewHtml(doc: Doc, units: Unit[], folder: string, opts: { embed?: boolean; thumb?: boolean; showSteps?: boolean }) {
  // 썸네일은 첫 단위만 무대에 직접 놓는다. head(prefix) 안 주석이나 style, script 글자에 든 "<section"을 슬라이드로 오인하지 않게 글자 치환이 아니라 구간으로 짠다.
  let s = opts.thumb && units[0]
    ? doc.prefix + '<div id="sk-stage" style="transform:none">' + units[0].html.replace(/^<section\b([^>]*)>/i, "<section data-active $1>") + "</div>" + doc.suffix
    : compose(doc, units);
  // 썸네일은 정지 화면이면 충분하다: sandbox로 스크립트는 못 돌지만 CSS 애니메이션은 멈춘다.
  const base = `<base href="${location.origin}/decks/${folder}/">` + (opts.thumb ? "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>" : "");
  s = s.replace(/<html\b/i, opts.embed ? (opts.showSteps ? "<html data-sk-embed data-sk-show-steps" : "<html data-sk-embed") : "<html");
  s = s.replace(/<head[^>]*>/i, (h) => h + base);
  if (opts.thumb) {
    // 외부 글꼴 링크는 렌더를 막으므로 뺀다(썸네일은 대체 글꼴로 그린다).
    s = s.replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, "");
    // 스크립트를 쓰지 않는 정적 썸네일: 엔진 대신 무대를 직접 만든다.
    s = s.replace(/<script\b(?![^>]*application\/json)[^>]*>[\s\S]*?<\/script>/gi, "");
  }
  return s;
}

// 살아 있는 슬라이드를 저장용 글자로 되돌린다. 엔진과 편집기가 붙인 것을 뺀다.
export function serializeSlide(el: Element) {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("[data-shown],[data-away],[data-step-instant],[data-step-run]")]) { for (const n of ["data-shown", "data-away", "data-step-instant", "data-step-run"]) e.removeAttribute(n); } // 재생 헤드와 미리보기가 남긴 표시
  for (const e of [c, ...c.querySelectorAll("[data-active],[contenteditable],[inert]")]) {
    e.removeAttribute("data-active");
    e.removeAttribute("contenteditable");
    if (e === c) e.removeAttribute("inert");
  }
  // 속성 값을 모두 지운 인라인 style은 빈 style=""로 남으므로(되돌리기 뒤 등) 저장 글자에서 뺀다.
  for (const e of [c, ...c.querySelectorAll('[style=""]')]) if (e.getAttribute("style") === "") e.removeAttribute("style");
  // outerHTML은 boolean 속성을 =""로 쓴다. SPEC 형태(`data-notes`)로 되돌린다.
  return c.outerHTML.replace(/(<aside\b[^>]*\sdata-notes)=""/g, "$1");
}

// 새 슬라이드 조각: 종류별 빈 구조(제목과 본문 하나)만 둔다. 레이아웃 프리셋은 없다(HTML 구조만 정해 둔다).
export const newSlideHtml = () => `<section data-slide="content">\n    <h2>제목</h2>\n    <p>내용</p>\n  </section>`;

/** 복제한 조각 안의 id를 새 값으로 바꾸고, 그 id를 가리키는 참조(url(#id), href="#id")도 함께 바꾼다(인라인 svg의 마스크와 그라디언트가 원본과 id를 나눠 쓰지 않게). 루트의 id는 호출하는 쪽이 지운다. */
export function freshIds(root: Element) {
  const map = new Map<string, string>(), tag = Math.random().toString(36).slice(2, 6);
  for (const e of root.querySelectorAll("[id]")) { const old = e.id; map.set(old, `${old}-${tag}`); e.id = `${old}-${tag}`; }
  if (!map.size) return;
  const swap = (v: string) => v.replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) => (map.has(id) ? `url(#${map.get(id)})` : m));
  for (const e of [root, ...root.querySelectorAll("*")]) {
    for (const a of [...e.attributes]) {
      if (/^(href|xlink:href)$/.test(a.name) && a.value.startsWith("#") && map.has(a.value.slice(1))) e.setAttribute(a.name, "#" + map.get(a.value.slice(1)));
      else if (/^(for|aria-labelledby|aria-controls|aria-describedby|aria-owns|aria-details)$/.test(a.name)) e.setAttribute(a.name, a.value.split(/\s+/).map((t) => map.get(t) ?? t).join(" "));
      else if (a.value.includes("url(")) e.setAttribute(a.name, swap(a.value));
    }
    if (e.tagName.toLowerCase() === "style") e.textContent = swap(e.textContent ?? "").replace(/#([A-Za-z_][\w-]*)/g, (m, id) => (map.has(id) ? `#${map.get(id)}` : m)); // 슬라이드 안 <style>의 #id 선택자도
  }
}

export function duplicateHtml(html: string) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  const s = t.content.firstElementChild!;
  s.removeAttribute("id"); // 같은 id가 둘이 되지 않게
  freshIds(s);
  if (s.getAttribute("data-slide") === "cover") s.setAttribute("data-slide", "content"); // cover는 덱에 하나만 둔다(lint 규칙)
  s.removeAttribute("data-steps"); // stepper는 id로 붙으므로 복제본은 일반 슬라이드가 된다
  return s.outerHTML;
}

// 요소 경로: 슬라이드 아래에서 `tag:nth-of-type(n)`을 ` > `로 잇는다.
// memo를 주면 같은 부모의 형제를 한 번만 센다(바뀌지 않는 DOM에서 요소 수천 개의 경로를 구할 때: 찾기, 넘침 검사).
export type PathMemo = Map<Element, { n: number; of: number }>;
export function pathOf(slide: Element, el: Element, memo?: PathMemo) {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== slide; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    let v: { n: number; of: number } | undefined = memo?.get(e);
    if (!v) {
      const seen = new Map<string, number>();
      const sibs: Element[] = [...(e.parentElement?.children ?? [])];
      for (const x of sibs) { const c = (seen.get(x.tagName) ?? 0) + 1; seen.set(x.tagName, c); if (memo) memo.set(x, { n: c, of: 0 }); else if (x === e) v = { n: c, of: 0 }; }
      if (memo) { for (const x of sibs) memo.get(x)!.of = seen.get(x.tagName)!; v = memo.get(e); } else if (v) v.of = seen.get(e.tagName)!;
      v ??= { n: 1, of: 1 }; // 부모가 없는 요소(떼어 낸 것)
    }
    parts.unshift(v.of > 1 ? `${tag}:nth-of-type(${v.n})` : tag);
  }
  return parts.join(" > ");
}
export const byPath = (slide: Element, path: string) => (path ? slide.querySelector(`:scope > ${path}`) : slide);
