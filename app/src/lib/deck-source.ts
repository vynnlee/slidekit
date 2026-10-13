// 덱 원문을 슬라이드 단위로 쪼개고 다시 합친다. SPEC 9절.
// 손대지 않은 슬라이드는 원문 글자 그대로 돌아온다. split 뒤 compose는 항등이어야 한다.
// gap: 앞 슬라이드 끝에서 이 슬라이드 시작까지의 원문. undefined면 기본 간격을 쓴다.
export type Unit = { key: string; gap?: string; html: string };
export type Doc = { prefix: string; suffix: string; units: Unit[] };

let seq = 0;
export const newKey = () => `u${++seq}`;

// script, style, 주석 안의 글자는 같은 길이의 공백으로 가려서 section 경계를 찾는다.
const mask = (s: string) =>
  s.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>/gi, (m) => " ".repeat(m.length));

export function splitDeck(src: string): Doc {
  const m = mask(src);
  const re = /<section\b|<\/section\s*>/gi;
  const ranges: [number, number][] = [];
  let depth = 0, start = 0, t: RegExpExecArray | null;
  while ((t = re.exec(m))) {
    if (t[0][1] !== "/") { if (depth++ === 0) start = t.index; }
    else if (depth > 0 && --depth === 0) ranges.push([start, re.lastIndex]);
  }
  const slides = ranges.filter(([a]) => /^<section\b[^>]*\bdata-slide\b/i.test(src.slice(a, a + 400)));
  if (!slides.length) throw new Error("슬라이드가 없습니다");
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
export function previewHtml(doc: Doc, units: Unit[], folder: string, opts: { embed?: boolean; thumb?: boolean }) {
  let s = compose(doc, units);
  const base = `<base href="${location.origin}/decks/${folder}/">`;
  s = s.replace(/<html\b/i, opts.embed ? "<html data-sk-embed" : "<html");
  s = s.replace(/<head[^>]*>/i, (h) => h + base);
  if (opts.thumb) {
    // 외부 글꼴 링크는 렌더를 막으므로 뺀다(썸네일은 대체 글꼴로 그린다).
    s = s.replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, "");
    // 스크립트를 쓰지 않는 정적 썸네일: 엔진 대신 무대를 직접 만든다.
    s = s.replace(/<script\b(?![^>]*application\/json)[^>]*>[\s\S]*?<\/script>/gi, "");
    s = s.replace(/<section\b/i, '<div id="sk-stage" style="transform:none"><section').replace(/<\/section>(?![\s\S]*<\/section>)/i, "</section></div>");
    s = s.replace(/<section\b([^>]*)>/i, "<section data-active $1>");
  }
  return s;
}

// 살아 있는 슬라이드를 저장용 글자로 되돌린다. 엔진과 편집기가 붙인 것을 뺀다.
export function serializeSlide(el: Element) {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("[data-active],[contenteditable],[inert]")]) {
    e.removeAttribute("data-active");
    e.removeAttribute("contenteditable");
    if (e === c) e.removeAttribute("inert");
  }
  return c.outerHTML;
}

export const newSlideHtml = () =>
  `<section data-slide="content">\n    <h2>제목</h2>\n    <p>내용</p>\n  </section>`;

export function duplicateHtml(html: string) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  const s = t.content.firstElementChild!;
  s.removeAttribute("id"); // 같은 id가 둘이 되지 않게
  s.removeAttribute("data-steps"); // stepper는 id로 붙으므로 복제본은 일반 슬라이드가 된다
  return s.outerHTML;
}

// 요소 경로: 슬라이드 아래에서 `tag:nth-of-type(n)`을 ` > `로 잇는다.
export function pathOf(slide: Element, el: Element) {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== slide; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    const same = [...(e.parentElement?.children ?? [])].filter((x) => x.tagName === e!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
  }
  return parts.join(" > ");
}
export const byPath = (slide: Element, path: string) => (path ? slide.querySelector(`:scope > ${path}`) : slide);
